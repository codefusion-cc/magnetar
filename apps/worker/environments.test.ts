import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { experimental_readRawConfig } from 'wrangler'

/**
 * Production (the top level of wrangler.jsonc), the preview Worker (`env.preview`) and its branch Previews (its
 * `previews` block) are three deployments of one Worker that must never share data or sign-in. Runs in Node: it reads
 * the config, not the Worker.
 */

interface Binding { binding?: string; name?: string; database_id?: string; namespace_id?: string; database_name?: string }
interface Deployment {
  name?: string
  vars?: Record<string, string>
  routes?: { pattern: string; custom_domain?: boolean; previews_enabled?: boolean }[]
  d1_databases?: Binding[]
  durable_objects?: { bindings: Binding[] }
  ratelimits?: Binding[]
  services?: Binding[]
  tail_consumers?: { service: string }[]
  analytics_engine_datasets?: Binding[]
  env?: Record<string, Deployment>
  previews?: Deployment
}

const read = (file: string) => experimental_readRawConfig({ config: join(import.meta.dirname, file) }).rawConfig as Deployment
const production = read('wrangler.jsonc')
const preview = production.env!.preview!
const previews = preview.previews!
const dev = production.env!.dev!

/** What a deployment binds, by kind and name: what the Worker's code can reach. */
const bindings = (d: Deployment) => [
  ...(d.d1_databases ?? []).map(b => `d1 ${b.binding}`),
  ...(d.durable_objects?.bindings ?? []).map(b => `durable object ${b.name}`),
  ...(d.ratelimits ?? []).map(b => `rate limit ${b.name}`),
  ...(d.services ?? []).map(b => `service ${b.binding}`),
].sort()

describe('the deployments of the Worker', () => {
  test('production never hands a sign-in to a Preview, and nothing but the preview Worker may', () => {
    for (const vars of [production.vars, dev.vars, previews.vars]) expect(vars).not.toHaveProperty('AUTH_PREVIEW_PARENTS')
    for (const vars of [production.vars, dev.vars, preview.vars]) expect(vars).not.toHaveProperty('GOOGLE_CALLBACK_ORIGIN')
    expect(preview.vars).toMatchObject({ APP_ENV: 'preview', AUTH_PREVIEW_PARENTS: 'enabled' })
    expect(production.vars).toMatchObject({ APP_ENV: 'production', ORIGIN: 'https://magnetar.codefusion.cc' })
    expect(previews.vars).toMatchObject({ APP_ENV: 'preview', ORIGIN: 'https://preview-origin.invalid', GOOGLE_CALLBACK_ORIGIN: preview.vars!.ORIGIN })
  })

  test("the preview Worker and its Previews sign in with one Google client of their own, never production's", () => {
    expect(previews.vars!.GOOGLE_CLIENT_ID).toBe(preview.vars!.GOOGLE_CLIENT_ID)
    expect(production.vars!.GOOGLE_CLIENT_ID).toMatch(/\.apps\.googleusercontent\.com$/)
    expect(preview.vars!.GOOGLE_CLIENT_ID).not.toBe(production.vars!.GOOGLE_CLIENT_ID)
    expect(preview.vars!.GOOGLE_CLIENT_ID).toMatch(/^[\w-]+\.apps\.googleusercontent\.com$/)
  })

  test("the preview Worker answers on its own origin's host, and Previews under it; production has no Previews", () => {
    expect(preview.routes).toEqual([{ pattern: new URL(preview.vars!.ORIGIN!).host, custom_domain: true, previews_enabled: true }])
    expect(production.routes).toEqual([{ pattern: new URL(production.vars!.ORIGIN!).host, custom_domain: true }])
    expect(preview.name).toBe(`${production.name}-preview`)
    expect(production.previews).toBeUndefined()
  })

  test('no two deployments share a database or a rate limit', () => {
    const databases = [production, dev, preview].flatMap(d => d.d1_databases!.map(b => b.database_id))
    expect(new Set(databases.filter(id => id !== production.d1_databases![0]!.database_id))).toEqual(new Set([preview.d1_databases![0]!.database_id]))
    expect(dev.d1_databases).toEqual(production.d1_databases) // `wrangler dev` keeps it local
    // Each Preview's own database replaces the placeholder (@codefusion-cc/previews); one called like the preview Worker's would be its.
    expect(previews.d1_databases).toEqual([expect.objectContaining({ binding: 'DB', database_id: '00000000-0000-0000-0000-000000000000' })])
    expect(previews.d1_databases![0]!.database_name).not.toBe(preview.d1_databases![0]!.database_name)
    const namespaces = [production, preview, previews].flatMap(d => d.ratelimits!.map(r => r.namespace_id))
    expect(new Set(namespaces).size).toBe(namespaces.length)
  })

  test('the preview Worker and every Preview bind all that production binds (environments inherit no binding)', () => {
    expect(bindings(preview)).toEqual(bindings(production))
    expect(bindings(previews)).toEqual(bindings(production))
    expect(previews.tail_consumers).toEqual(production.tail_consumers)
  })
})

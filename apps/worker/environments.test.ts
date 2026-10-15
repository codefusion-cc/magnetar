import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { experimental_readRawConfig } from 'wrangler'

/**
 * Production (wrangler.jsonc), staging and the branch Previews (wrangler.preview.jsonc) are three deployments of one
 * Worker that must never share data or sign-in. Runs in Node: it reads the configs, not the Worker.
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
const staging = read('wrangler.preview.jsonc')
const previews = staging.previews!
const dev = production.env!.dev!

/** What a deployment binds, by kind and name: what the Worker's code can reach. */
const bindings = (d: Deployment) => [
  ...(d.d1_databases ?? []).map(b => `d1 ${b.binding}`),
  ...(d.durable_objects?.bindings ?? []).map(b => `durable object ${b.name}`),
  ...(d.ratelimits ?? []).map(b => `rate limit ${b.name}`),
  ...(d.services ?? []).map(b => `service ${b.binding}`),
].sort()

describe('the deployments of the Worker', () => {
  test('production never hands a sign-in to a Preview, and nothing but staging may', () => {
    for (const vars of [production.vars, dev.vars, previews.vars]) expect(vars).not.toHaveProperty('AUTH_PREVIEW_PARENTS')
    for (const vars of [production.vars, dev.vars, staging.vars]) expect(vars).not.toHaveProperty('GOOGLE_CALLBACK_ORIGIN')
    expect(staging.vars).toMatchObject({ APP_ENV: 'staging', AUTH_PREVIEW_PARENTS: 'enabled' })
    expect(production.vars).toMatchObject({ APP_ENV: 'production', ORIGIN: 'https://magnetar.codefusion.cc' })
    expect(previews.vars).toMatchObject({ APP_ENV: 'preview', ORIGIN: 'https://preview-origin.invalid', GOOGLE_CALLBACK_ORIGIN: staging.vars!.ORIGIN })
  })

  test("staging and Previews sign in with one Google client of their own, never production's", () => {
    expect(previews.vars!.GOOGLE_CLIENT_ID).toBe(staging.vars!.GOOGLE_CLIENT_ID)
    expect(production.vars!.GOOGLE_CLIENT_ID).toMatch(/\.apps\.googleusercontent\.com$/)
    expect(staging.vars!.GOOGLE_CLIENT_ID).not.toBe(production.vars!.GOOGLE_CLIENT_ID)
    expect(staging.vars!.GOOGLE_CLIENT_ID).toMatch(/^[\w-]+\.apps\.googleusercontent\.com$/)
  })

  test("staging answers on its own origin's host, and Previews under it; production has no Previews", () => {
    expect(staging.routes).toEqual([{ pattern: new URL(staging.vars!.ORIGIN!).host, custom_domain: true, previews_enabled: true }])
    expect(production.routes).toEqual([{ pattern: new URL(production.vars!.ORIGIN!).host, custom_domain: true }])
    expect(staging.name).not.toBe(production.name)
  })

  test('no two deployments share a database or a rate limit', () => {
    const databases = [production, dev, staging].flatMap(d => d.d1_databases!.map(b => b.database_id))
    expect(new Set(databases.filter(id => id !== production.d1_databases![0]!.database_id))).toEqual(new Set([staging.d1_databases![0]!.database_id]))
    expect(dev.d1_databases).toEqual(production.d1_databases) // `wrangler dev` keeps it local
    // Each Preview's own database replaces the placeholder (@codefusion-cc/previews); one called like staging's would be its.
    expect(previews.d1_databases).toEqual([expect.objectContaining({ binding: 'DB', database_id: '00000000-0000-0000-0000-000000000000' })])
    expect(previews.d1_databases![0]!.database_name).not.toBe(staging.d1_databases![0]!.database_name)
    const namespaces = [production, staging, previews].flatMap(d => d.ratelimits!.map(r => r.namespace_id))
    expect(new Set(namespaces).size).toBe(namespaces.length)
  })

  test('staging and every Preview bind all that production binds (Previews inherit no binding)', () => {
    expect(bindings(staging)).toEqual(bindings(production))
    expect(bindings(previews)).toEqual(bindings(production))
    expect(previews.tail_consumers).toEqual(production.tail_consumers)
  })
})

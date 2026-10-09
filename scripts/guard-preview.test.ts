import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { previewProblems } from './guard-preview.ts'

const web = join(import.meta.dirname, '../apps/web')
const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A build output made of the website's own index.html and public/ files, which the real build copies unchanged. */
function output(): string {
  const dir = mkdtempSync(join(tmpdir(), 'preview-'))
  made.push(dir)
  cpSync(join(web, 'public'), dir, { recursive: true })
  cpSync(join(web, 'index.html'), join(dir, 'index.html'))
  return dir
}
const edit = (dir: string, file: string, change: (text: string) => string) =>
  writeFileSync(join(dir, file), change(readFileSync(join(dir, file), 'utf8')))

describe('previewProblems', () => {
  it('passes the repo as it is: tags in index.html, the image and robots.txt in public/', () => {
    expect(previewProblems(output())).toEqual([])
  })

  it.each([
    ['og:title', /<meta\s+property="og:title"[^>]*>/],
    ['twitter:image', /<meta\s+name="twitter:image"[^>]*>/],
    ['og:image:height', /<meta\s+property="og:image:height"[^>]*>/],
    ['description', /<meta\s+name="description"[^>]*>/],
  ] as const)('names a missing %s', (key, pattern) => {
    const dir = output()
    edit(dir, 'index.html', (html) => html.replace(pattern, ''))
    expect(previewProblems(dir)).toEqual([`index.html has no ${key}`])
  })

  it('fails an image that is not in the output, is relative, is not a JPEG or is too big', () => {
    let dir = output()
    rmSync(join(dir, 'og-v1.jpg'))
    expect(previewProblems(dir).join('\n')).toMatch(/og:image points at \/og-v1\.jpg, which is not in/)
    dir = output()
    edit(dir, 'index.html', (html) => html.replaceAll('https://magnetar.codefusion.cc/og-v1.jpg', '/og-v1.jpg'))
    expect(previewProblems(dir).join('\n')).toMatch(/og:image is not an absolute https URL/)
    dir = output()
    edit(dir, 'index.html', (html) => html.replaceAll('og-v1.jpg', 'og-v1.png'))
    expect(previewProblems(dir).join('\n')).toMatch(/not an absolute https URL of a \.jpg/)
    dir = output()
    writeFileSync(join(dir, 'og-v1.jpg'), Buffer.alloc(200_001))
    expect(previewProblems(dir).join('\n')).toMatch(/over 200000 bytes/)
  })

  it('fails a robots.txt that is missing or is the dashboard page, and a missing canonical link', () => {
    let dir = output()
    rmSync(join(dir, 'robots.txt'))
    expect(previewProblems(dir).join('\n')).toMatch(/robots\.txt is not in the output/)
    dir = output()
    writeFileSync(join(dir, 'robots.txt'), '<!doctype html><html></html>')
    expect(previewProblems(dir).join('\n')).toMatch(/not a robots file/)
    dir = output()
    edit(dir, 'index.html', (html) => html.replace(/<link rel="canonical"[^>]*>/, ''))
    expect(previewProblems(dir)).toEqual(['index.html has no https canonical link'])
  })

  it('fails a directory without index.html', () => {
    const dir = mkdtempSync(join(tmpdir(), 'preview-'))
    made.push(dir)
    mkdirSync(join(dir, 'x'))
    expect(previewProblems(dir)[0]).toMatch(/index\.html is missing/)
  })
})

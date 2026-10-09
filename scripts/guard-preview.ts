import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Checks a build of the website for what a shared link needs: scrapers (Messenger, WhatsApp, Slack) read the HTML and
 * run no JavaScript. dist/index.html needs the Open Graph and Twitter tags and a canonical link; og:image must be an
 * absolute https URL of a JPEG that is in the output and within budget; robots.txt must be a robots file, not the
 * dashboard's page (a path that is no file is answered with it). Run by `npm run build -w @magnetar/web`.
 */
const MAX_IMAGE_BYTES = 200_000
const REQUIRED: [attribute: string, key: string][] = [
  ['property', 'og:type'],
  ['property', 'og:url'],
  ['property', 'og:title'],
  ['property', 'og:description'],
  ['property', 'og:image'],
  ['property', 'og:image:width'],
  ['property', 'og:image:height'],
  ['name', 'twitter:card'],
  ['name', 'twitter:title'],
  ['name', 'twitter:description'],
  ['name', 'twitter:image'],
  ['name', 'description'],
]

function metaContent(html: string, attribute: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/g) ?? []) {
    if (new RegExp(`\\b${attribute}="${key}"`).test(tag)) return /\bcontent="([^"]*)"/.exec(tag)?.[1]
  }
  return undefined
}

/** What is wrong with a build output directory; an empty list means it is fine. */
export function previewProblems(dist: string): string[] {
  const indexPath = join(dist, 'index.html')
  if (!existsSync(indexPath)) return [`${indexPath} is missing`]
  const problems: string[] = []
  const html = readFileSync(indexPath, 'utf8')
  for (const [attribute, key] of REQUIRED) {
    if (!metaContent(html, attribute, key)) problems.push(`index.html has no ${key}`)
  }
  if (!/<link\b[^>]*rel="canonical"[^>]*href="https:\/\/[^"]+"/.test(html)) problems.push('index.html has no https canonical link')
  if (metaContent(html, 'name', 'twitter:card') !== 'summary_large_image') problems.push('twitter:card is not summary_large_image')
  for (const [attribute, key] of [['property', 'og:image'], ['name', 'twitter:image']] as const) {
    const url = metaContent(html, attribute, key)
    if (!url) continue
    if (!/^https:\/\/[^/]+\/[^?#]+\.jpg$/.test(url)) {
      problems.push(`${key} is not an absolute https URL of a .jpg: ${url}`)
      continue
    }
    const { pathname } = new URL(url)
    const file = join(dist, pathname)
    if (!existsSync(file)) problems.push(`${key} points at ${pathname}, which is not in ${dist}/`)
    else if (statSync(file).size > MAX_IMAGE_BYTES) problems.push(`${pathname} is over ${MAX_IMAGE_BYTES} bytes`)
  }
  const robots = join(dist, 'robots.txt')
  if (!existsSync(robots)) problems.push('robots.txt is not in the output (it would be answered with the dashboard page)')
  else {
    const text = readFileSync(robots, 'utf8')
    if (!/^User-agent:/im.test(text) || /<html/i.test(text)) problems.push('robots.txt is not a robots file')
  }
  return problems
}

if (import.meta.main) {
  const problems = previewProblems(process.argv[2] ?? 'dist')
  if (problems.length) {
    console.error(`guard-preview failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    process.exit(1)
  }
  console.log('guard-preview ok')
}

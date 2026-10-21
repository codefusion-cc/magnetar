/**
 * One GitHub issue per search source that stopped answering, from the daily provider check
 * (.github/workflows/provider-health.yml): opened the first day a source fails, its text kept current while it does,
 * closed the day it answers again or is no longer searched. The check's live test writes the report this reads:
 * `[{ "source": "Nyaa", "error": null }, { "source": "RARBG", "error": "HTTP 403 from therarbg.to" }]`.
 *
 *   node packages/release/provider-issues.ts <report.json>
 *
 * Needs GITHUB_TOKEN (issues: write) and GITHUB_REPOSITORY; GITHUB_SERVER_URL and GITHUB_RUN_ID link the run.
 */
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

export interface SourceCheck {
  source: string
  error: string | null
}

export interface OpenIssue {
  number: number
  title: string
}

export type Step =
  | { kind: 'open'; title: string; body: string }
  | { kind: 'update'; number: number; body: string }
  | { kind: 'close'; number: number; comment: string }

const PREFIX = 'Search source down: '

export const issueTitle = (source: string) => `${PREFIX}${source}`

/** The report as the live test writes it; anything else is refused before an issue is touched. */
export function parseReport(json: string): SourceCheck[] {
  const report: unknown = JSON.parse(json)
  const valid = Array.isArray(report) && report.length > 0 && report.every(entry =>
    typeof entry === 'object' && entry !== null && typeof entry.source === 'string' && entry.source.trim() !== ''
    && (entry.error === null || typeof entry.error === 'string'))
  if (!valid) throw new Error('The provider report is not a list of { source, error }')
  return report as SourceCheck[]
}

/** What to do with the issues, given today's report and the check's issues still open. */
export function plan(report: readonly SourceCheck[], open: readonly OpenIssue[], run: { url: string; date: string }): Step[] {
  const steps: Step[] = []
  const ours = new Map(open.filter(issue => issue.title.startsWith(PREFIX)).map(issue => [issue.title.slice(PREFIX.length), issue.number]))
  for (const { source, error } of report) {
    if (error === null) continue
    const body = [
      `Magnetar's daily check could not search ${source}. Searches show it as not answering.`,
      '',
      '```',
      error,
      '```',
      '',
      `Last failed ${run.date}: ${run.url}`,
      '',
      'Closes by itself the day it answers again.',
    ].join('\n')
    const number = ours.get(source)
    steps.push(number === undefined ? { kind: 'open', title: issueTitle(source), body } : { kind: 'update', number, body })
  }
  const searched = new Map(report.map(check => [check.source, check.error]))
  for (const [source, number] of ours) {
    if (!searched.has(source)) steps.push({ kind: 'close', number, comment: `${source} is no longer searched.` })
    else if (searched.get(source) === null) steps.push({ kind: 'close', number, comment: `${source} answers again (${run.date}): ${run.url}` })
  }
  return steps
}

type Fetch = typeof fetch

/** A GitHub REST call, tried again on 429 and 5xx answers and dropped connections. */
async function github(fetcher: Fetch, token: string, path: string, init: { method?: string; body?: unknown } = {}, waitMs = 2000): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    let response: Response | undefined
    try {
      response = await fetcher(`https://api.github.com${path}`, {
        method: init.method ?? 'GET',
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
    } catch (error) {
      if (attempt >= 4) throw error
    }
    if (response?.ok) return response.status === 204 ? null : response.json()
    if (response && response.status !== 429 && response.status < 500) {
      throw new Error(`GitHub answered ${response.status} to ${init.method ?? 'GET'} ${path}: ${await response.text()}`)
    }
    if (attempt >= 4) throw new Error(`GitHub answered ${response?.status} to ${init.method ?? 'GET'} ${path} ${attempt} times`)
    const retryAfter = Number(response?.headers.get('retry-after'))
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : waitMs * attempt)
  }
}

/** Lists the open issues the check may own and applies today's plan. Returns what it did, for the run's log. */
export async function sync(report: readonly SourceCheck[], options: { repo: string; token: string; run: { url: string; date: string }; fetch?: Fetch; waitMs?: number }): Promise<Step[]> {
  const fetcher = options.fetch ?? fetch
  const call = (path: string, init?: { method?: string; body?: unknown }) => github(fetcher, options.token, path, init, options.waitMs)
  const open: OpenIssue[] = []
  for (let page = 1; ; page++) {
    const batch = await call(`/repos/${options.repo}/issues?state=open&creator=${encodeURIComponent('github-actions[bot]')}&per_page=100&page=${page}`) as (OpenIssue & { pull_request?: unknown })[]
    open.push(...batch.filter(issue => !issue.pull_request))
    if (batch.length < 100) break
  }
  const steps = plan(report, open, options.run)
  for (const step of steps) {
    if (step.kind === 'open') await call(`/repos/${options.repo}/issues`, { method: 'POST', body: { title: step.title, body: step.body } })
    else if (step.kind === 'update') await call(`/repos/${options.repo}/issues/${step.number}`, { method: 'PATCH', body: { body: step.body } })
    else {
      await call(`/repos/${options.repo}/issues/${step.number}/comments`, { method: 'POST', body: { body: step.comment } })
      await call(`/repos/${options.repo}/issues/${step.number}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } })
    }
  }
  return steps
}

if (process.argv[1] === import.meta.filename) {
  const [path] = process.argv.slice(2)
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_SERVER_URL: server = 'https://github.com', GITHUB_RUN_ID: runId } = process.env
  if (!path || !token || !repo) throw new Error('Usage: GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node packages/release/provider-issues.ts <report.json>')
  const report = parseReport(readFileSync(path, 'utf8'))
  const run = { url: runId ? `${server}/${repo}/actions/runs/${runId}` : `${server}/${repo}/actions`, date: new Date().toISOString().slice(0, 10) }
  for (const step of await sync(report, { repo, token, run })) {
    console.log(step.kind === 'open' ? `Opened: ${step.title}` : step.kind === 'update' ? `Still failing: #${step.number}` : `Closed #${step.number}: ${step.comment}`)
  }
}

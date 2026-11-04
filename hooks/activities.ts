import type { EngineInterface } from 'claude-code'

import { getJson, HOST, readToken } from './forgejo'
import type { Activity, Followed, Forge } from './model'

const GITHUB = 'https://github.com'
const FORGEJO = `https://${HOST}`
// Per repository, the newest events read on each poll; the whole feed keeps MAX_FEED.
const PER_REPO = 50
const MAX_FEED = 300

export const followKey = (one: Followed): string => `${one.forge}:${one.repo}`.toLowerCase()

/**
 * The repository `text` names: `owner/repo` on `forge`, or a GitHub or Forgejo
 * URL, whose host decides the forge. Undefined for anything else.
 */
export function parseFollow(text: string, forge: Forge): Followed | undefined {
  const url = /^https?:\/\/([\w.-]+)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/.exec(text.trim())
  if (url?.[1]) {
    const host = url[1].toLowerCase()
    const from: Forge | undefined = host === 'github.com' ? 'github' : host === HOST ? 'forgejo' : undefined
    return from && { forge: from, repo: `${url[2]}/${url[3]}` }
  }
  const name = /^([\w.-]+)\/([\w.-]+)$/.exec(text.trim())

  return name ? { forge, repo: `${name[1]}/${name[2]}` } : undefined
}

// The fields of a GitHub event the feed reads; the public events API trims PR payloads to their number.
export type GithubEvent = {
  id: string
  type: string
  actor: { login: string } | null
  repo: { name: string }
  created_at: string
  payload: {
    action?: string
    ref?: string | null
    ref_type?: string
    head?: string
    before?: string
    number?: number
    issue?: { number: number; title: string; html_url: string; pull_request?: unknown }
    pull_request?: { number: number; title?: string; html_url?: string; merged?: boolean }
    comment?: { html_url: string }
    review?: { state: string; html_url: string }
    release?: { name: string | null; tag_name: string; html_url: string }
  }
}

const branchOf = (ref: string | null | undefined): string => (ref ?? '').replace(/^refs\/(heads|tags)\//, '')
const REVIEW_VERB: Record<string, string> = { approved: 'approved', changes_requested: 'requested changes on' }

/** One GitHub event as a feed line. */
export function fromGithub(event: GithubEvent): Activity {
  const repo = event.repo.name
  const p = event.payload
  const base = `${GITHUB}/${repo}`
  const pull = p.pull_request
  const pr = pull ? `#${pull.number}${pull.title ? ` ${pull.title}` : ''}` : ''
  const pullUrl = pull ? (pull.html_url ?? `${base}/pull/${pull.number}`) : base
  const line = (verb: string, target: string, url: string) => ({ verb, target, url })
  const shown = (() => {
    switch (event.type) {
      case 'PushEvent':
        return line('pushed to', branchOf(p.ref), p.before && p.head ? `${base}/compare/${p.before.slice(0, 12)}...${p.head.slice(0, 12)}` : base)
      case 'CreateEvent':
        return line(`created ${p.ref_type ?? ''}`.trim(), p.ref ?? repo, p.ref_type === 'tag' ? `${base}/releases/tag/${p.ref}` : `${base}/tree/${p.ref ?? ''}`)
      case 'DeleteEvent':
        return line(`deleted ${p.ref_type ?? ''}`.trim(), p.ref ?? '', base)
      case 'IssuesEvent':
        return line(`${p.action} issue`, `#${p.issue?.number} ${p.issue?.title ?? ''}`.trim(), p.issue?.html_url ?? base)
      case 'IssueCommentEvent':
        return line(`commented on ${p.issue?.pull_request ? 'PR' : 'issue'}`, `#${p.issue?.number} ${p.issue?.title ?? ''}`.trim(), p.comment?.html_url ?? base)
      case 'PullRequestEvent':
        return line(`${p.action === 'closed' && pull?.merged ? 'merged' : p.action} PR`, pr, pullUrl)
      case 'PullRequestReviewEvent':
        return line(`${REVIEW_VERB[p.review?.state ?? ''] ?? 'reviewed'} PR`, pr, p.review?.html_url ?? pullUrl)
      case 'PullRequestReviewCommentEvent':
        return line('commented on the review of PR', pr, p.comment?.html_url ?? pullUrl)
      case 'ReleaseEvent':
        return line('published release', p.release?.name || p.release?.tag_name || '', p.release?.html_url ?? base)
      default:
        return line(event.type.replace(/Event$/, '').toLowerCase(), '', base)
    }
  })()

  return { id: `github:${event.id}`, forge: 'github', repo, actor: event.actor?.login ?? '', createdAt: event.created_at, ...shown }
}

export type ForgejoActivity = {
  id: number
  op_type: string
  act_user: { login: string } | null
  repo: { full_name: string }
  ref_name: string
  content: string
  comment: { html_url: string } | null
  created: string
}

// The verb of each Forgejo operation, and whether its content names an issue (false) or a PR (true).
const FORGEJO_OPS: Record<string, [string, boolean]> = {
  create_issue: ['opened issue', false],
  close_issue: ['closed issue', false],
  reopen_issue: ['reopened issue', false],
  comment_issue: ['commented on issue', false],
  create_pull_request: ['opened PR', true],
  close_pull_request: ['closed PR', true],
  reopen_pull_request: ['reopened PR', true],
  merge_pull_request: ['merged PR', true],
  auto_merge_pull_request: ['auto-merged PR', true],
  approve_pull_request: ['approved PR', true],
  reject_pull_request: ['requested changes on PR', true],
  comment_pull: ['commented on PR', true],
  pull_review_dismissed: ['dismissed a review on PR', true],
  pull_request_ready_for_review: ['marked ready for review PR', true],
}

// Issue operations carry `["<number>","<title or comment>"]`; older servers write `<number>|<text>`.
function numberAndText(content: string): [string, string] {
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) return [String(parsed[0] ?? ''), String(parsed[1] ?? '')]
  } catch {}
  const at = content.indexOf('|')

  return at < 0 ? [content, ''] : [content.slice(0, at), content.slice(at + 1)]
}

/** One Forgejo activity as a feed line. */
export function fromForgejo(one: ForgejoActivity): Activity {
  const repo = one.repo.full_name
  const base = `${FORGEJO}/${repo}`
  const op = FORGEJO_OPS[one.op_type]
  const line = (verb: string, target: string, url: string) => ({ verb, target, url })
  const shown = (() => {
    if (op) {
      const [number, text] = numberAndText(one.content)
      const isComment = one.op_type.startsWith('comment')
      const target = isComment ? `#${number}` : `#${number} ${text}`.trim()
      return line(op[0], target, one.comment?.html_url || `${base}/${op[1] ? 'pulls' : 'issues'}/${number}`)
    }
    const ref = branchOf(one.ref_name)
    switch (one.op_type) {
      case 'commit_repo':
      case 'mirror_sync_push': {
        let compare = ''
        try { compare = (JSON.parse(one.content) as { CompareURL?: string }).CompareURL ?? '' } catch {}
        return line('pushed to', ref, compare ? `${FORGEJO}/${compare}` : `${base}/src/branch/${ref}`)
      }
      case 'push_tag':
        return line('pushed tag', ref, `${base}/releases/tag/${ref}`)
      case 'delete_branch':
        return line('deleted branch', ref, base)
      case 'delete_tag':
        return line('deleted tag', ref, base)
      case 'publish_release':
        return line('published release', ref || one.content, `${base}/releases`)
      default:
        return line(one.op_type.replaceAll('_', ' '), ref, base)
    }
  })()

  return { id: `forgejo:${one.id}`, forge: 'forgejo', repo, actor: one.act_user?.login ?? '', createdAt: one.created, ...shown }
}

/** The status, headers and body of what `gh api -i` printed. */
export function parseHttp(output: string): { status: number; headers: Record<string, string>; body: string } {
  const at = output.search(/\r?\n\r?\n/)
  const head = at < 0 ? output : output.slice(0, at)
  const body = at < 0 ? '' : output.slice(at).replace(/^\r?\n\r?\n/, '')
  const [statusLine = '', ...lines] = head.split(/\r?\n/)
  const headers: Record<string, string> = {}
  for (const one of lines) {
    const colon = one.indexOf(':')
    if (colon > 0) headers[one.slice(0, colon).trim().toLowerCase()] = one.slice(colon + 1).trim()
  }

  return { status: Number(/^HTTP\/[\d.]+ (\d+)/.exec(statusLine)?.[1] ?? 0), headers, body }
}

// Per followed repository, the feed last read and, on GitHub, the ETag that read it.
export type ActivityCache = Record<string, { etag: string; activities: Activity[] }>
type Read = { etag: string; activities: Activity[] } | 'unchanged'

/**
 * The newest events of a GitHub repository. With the ETag of the previous
 * read, an unchanged feed answers 304, which GitHub does not count against
 * the rate limit.
 */
async function readGithub($: EngineInterface, repo: string, etag: string): Promise<Read> {
  const { stdout, stderr } = await $.process.run(
    ['gh', 'api', '-i', ...(etag ? ['-H', `If-None-Match: ${etag}`] : []), `/repos/${repo}/events?per_page=${PER_REPO}`],
    { timeoutMs: 30000 },
  )
  const answer = parseHttp(stdout)
  if (answer.status === 304) return 'unchanged'
  if (answer.status !== 200) throw new Error(stderr.trim().split('\n')[0] || `HTTP ${answer.status}`)

  return { etag: answer.headers.etag ?? '', activities: (JSON.parse(answer.body) as GithubEvent[]).map(fromGithub) }
}

async function readForgejo($: EngineInterface, token: string, repo: string): Promise<Read> {
  const found = await getJson<ForgejoActivity[] | null>($, token, `/repos/${repo}/activities/feeds?limit=${PER_REPO}`)

  return { etag: '', activities: (found ?? []).map(fromForgejo) }
}

export type ActivityResult = { activities: Activity[]; cache: ActivityCache; errors: string[] }

/**
 * Reads the feed of every followed repository and merges them, newest first.
 * A repository that fails keeps the feed `cache` holds for it.
 */
export async function fetchActivities($: EngineInterface, followed: Followed[], cache: ActivityCache): Promise<ActivityResult> {
  const errors: string[] = []
  const kept: ActivityCache = {}
  const token = followed.some(one => one.forge === 'forgejo') ? await readToken($).catch(() => undefined) : undefined
  await Promise.all(
    followed.map(async one => {
      const key = followKey(one)
      const before = cache[key]
      try {
        if (one.forge === 'forgejo' && !token) throw new Error(`no ${HOST} token: run fj auth login`)
        const read = one.forge === 'github' ? await readGithub($, one.repo, before?.etag ?? '') : await readForgejo($, token ?? '', one.repo)
        if (read !== 'unchanged') kept[key] = read
        else if (before) kept[key] = before
      } catch (error) {
        errors.push(`${one.repo}: ${error instanceof Error ? error.message : String(error)}`)
        if (before) kept[key] = before
      }
    }),
  )
  const activities = Object.values(kept)
    .flatMap(one => one.activities)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_FEED)

  return { activities, cache: kept, errors }
}

/** The repository as its forge spells it, or the reason it cannot be followed. */
export async function checkRepo($: EngineInterface, one: Followed): Promise<Followed | string> {
  try {
    if (one.forge === 'github') {
      const { exitCode, stdout, stderr } = await $.process.run(['gh', 'api', `/repos/${one.repo}`, '-q', '.full_name'], { timeoutMs: 30000 })
      if (exitCode !== 0) return `${one.repo}: ${stderr.trim().split('\n')[0] || 'not found on GitHub'}`
      return { forge: 'github', repo: stdout.trim() }
    }
    const token = await readToken($)
    if (!token) return `no ${HOST} token: run fj auth login`
    const found = await getJson<{ full_name: string }>($, token, `/repos/${one.repo}`)

    return { forge: 'forgejo', repo: found.full_name }
  } catch (error) {
    return `${one.repo}: ${error instanceof Error ? error.message : String(error)}`
  }
}

import type { EngineInterface } from 'claude-code'

import type { SourceResult } from './github'
import { addMatch, CLAUSE_ROLE, getPendingMention, isAnsweredMention, itemKey, NO_REVIEW } from './model'
import type { Clause, FollowedItem, RawItem, ReviewState, Role } from './model'

export const HOST = 'hub.genro.com'
const API = `https://${HOST}/api/v1`
const KEYS = 'Library/Application Support/forgejo-cli.forgejo-cli/keys.json'
const PAGE = 50
const MAX_PAGES = 10
const PARALLEL = 6

// The Forgejo search has no boolean query: one call per clause.
export const SEARCHES: Record<Clause, string> = {
  assigned: 'type=issues&assigned=true',
  created: 'type=issues&created=true',
  prAssigned: 'type=pulls&assigned=true',
  prCreated: 'type=pulls&created=true',
  reviews: 'type=pulls&review_requested=true',
  mentioned: 'mentioned=true',
}

export type ForgejoIssue = {
  number: number
  title: string
  html_url: string
  updated_at: string
  user: { login: string } | null
  body?: string
  assignees: { login: string }[] | null
  repository: { full_name: string }
  pull_request: { draft?: boolean } | null
  state?: string
}
export type ForgejoPull = {
  mergeable: boolean
  head: { sha: string }
  requested_reviewers: { login: string }[] | null
  requested_reviewers_teams: { name: string }[] | null
}
export type ForgejoReview = { user: { login: string } | null; state: string; dismissed: boolean }
export type TimelineEvent = { type: string; body?: string; html_url?: string; user?: { login: string } | null }
export type Flags = { hasCommits: boolean; hasLinkedPr: boolean; mentionUrl: string }
// Timeline flags per item key, valid while the item's updated_at is unchanged.
export type TimelineCache = Record<string, Flags & { updatedAt: string }>

/**
 * What the timeline of `issue` says, its comments read for a mention of `me`. Forgejo answers
 * `null`, not `[]`, for an issue with no timeline events.
 */
export function flagsOf(events: TimelineEvent[] | null, issue: ForgejoIssue, me: string): Flags {
  const comments = (events ?? []).filter(event => event.type === 'comment')
  const posts = [
    { author: issue.user?.login ?? '', body: issue.body ?? '', url: issue.html_url },
    ...comments.map(one => ({ author: one.user?.login ?? '', body: one.body ?? '', url: one.html_url ?? issue.html_url })),
  ]

  return {
    hasCommits: (events ?? []).some(event => event.type === 'commit_ref'),
    hasLinkedPr: (events ?? []).some(event => event.type === 'pull_ref'),
    mentionUrl: getPendingMention(posts, me),
  }
}

/**
 * The review state of a PR: each reviewer's latest verdict counts, a request
 * for changes outweighs approvals. A commit with no status has no CI: green.
 */
export function reviewOf(pull: ForgejoPull, reviews: ForgejoReview[] | null, ciState: string): ReviewState {
  const verdicts = new Map<string, string>()
  for (const review of reviews ?? []) {
    if (!review.dismissed && (review.state === 'APPROVED' || review.state === 'REQUEST_CHANGES')) {
      verdicts.set(review.user?.login ?? '', review.state)
    }
  }
  const states = [...verdicts.values()]

  return {
    reviewDecision: states.includes('REQUEST_CHANGES') ? 'changes' : states.includes('APPROVED') ? 'approved' : 'none',
    requestedReviewers: [
      ...(pull.requested_reviewers ?? []).map(one => one.login),
      ...(pull.requested_reviewers_teams ?? []).map(one => one.name),
    ],
    isMergeable: pull.mergeable,
    isCiGreen: ciState === '' || ciState === 'success',
  }
}

function toItem(issue: ForgejoIssue, role: Role = 'author'): RawItem {
  return {
    forge: 'forgejo',
    repo: issue.repository.full_name,
    number: issue.number,
    kind: issue.pull_request ? 'pr' : 'issue',
    title: issue.title,
    url: issue.html_url,
    updatedAt: issue.updated_at,
    author: issue.user?.login ?? '',
    assignees: (issue.assignees ?? []).map(one => one.login),
    isDraft: issue.pull_request?.draft ?? false,
    ...NO_REVIEW,
    hasCommits: false,
    hasLinkedPr: false,
    mentionUrl: '',
    roles: [role],
  }
}

/**
 * Merges the clause lists into unique items, newest first, then the open
 * `followed` items. Assigned issues with a linked PR drop out, as `-linked:pr`
 * does on GitHub; drafts drop out of review requests only, answered mentions
 * out of the list. `flags` holds the timeline of every issue and of every PR
 * mentioning me or followed, `reviews` the review state of every PR.
 */
export function mergeForgejo(
  lists: Partial<Record<Clause, ForgejoIssue[]>>,
  flags: Record<string, Flags>,
  reviews: Record<string, ReviewState> = {},
  followed: ForgejoIssue[] = [],
): RawItem[] {
  const byKey = new Map<string, RawItem>()
  const add = (issue: ForgejoIssue, role: Role, clause?: Clause) => {
    const item = toItem(issue, role)
    const key = itemKey(item)
    const found =
      item.kind === 'issue'
        ? { ...item, ...flags[key] }
        : { ...item, ...reviews[key], mentionUrl: flags[key]?.mentionUrl ?? '' }
    if (clause === 'assigned' && found.hasLinkedPr) return
    if (clause === 'reviews' && found.isDraft) return
    addMatch(byKey, key, found)
  }
  for (const clause of Object.keys(SEARCHES) as Clause[]) {
    for (const issue of lists[clause] ?? []) add(issue, CLAUSE_ROLE[clause], clause)
  }
  for (const issue of followed) add(issue, 'following')

  return [...byKey.values()].filter(item => !isAnsweredMention(item)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Reads the token `fj auth` stored; it never leaves this module's calls. */
export async function readToken($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  const keys = JSON.parse(String(await $.fs.read(`${home}/${KEYS}`)))

  return keys?.hosts?.[HOST]?.token
}

export async function getJson<T>($: EngineInterface, token: string, path: string): Promise<T> {
  const res = await $.http.fetch(`${API}${path}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`${path.split('?')[0]}: HTTP ${res.status}`)

  return JSON.parse(res.text) as T
}

async function inBatches<T>(list: T[], run: (one: T) => Promise<void>): Promise<void> {
  for (let at = 0; at < list.length; at += PARALLEL) await Promise.all(list.slice(at, at + PARALLEL).map(run))
}

/** Reads the PR, its reviews and the checks on its head commit. */
async function readReview($: EngineInterface, token: string, issue: ForgejoIssue): Promise<ReviewState> {
  const path = `/repos/${issue.repository.full_name}/pulls/${issue.number}`
  const [pull, reviews] = await Promise.all([
    getJson<ForgejoPull>($, token, path),
    getJson<ForgejoReview[] | null>($, token, `${path}/reviews?limit=100`),
  ])
  const status = await getJson<{ state: string }>($, token, `/repos/${issue.repository.full_name}/commits/${pull.head.sha}/status`)

  return reviewOf(pull, reviews, status.state)
}

async function searchClause($: EngineInterface, token: string, query: string): Promise<ForgejoIssue[]> {
  const found: ForgejoIssue[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await getJson<ForgejoIssue[]>($, token, `/repos/issues/search?state=open&limit=${PAGE}&page=${page}&${query}`)
    found.push(...batch)
    if (batch.length < PAGE) break
  }

  return found
}

/**
 * Reads each followed item; those found closed go to `closed`, those that fail
 * stay followed with an error.
 */
async function readFollowed(
  $: EngineInterface,
  token: string,
  following: FollowedItem[],
  errors: string[],
): Promise<{ open: ForgejoIssue[]; closed: FollowedItem[] }> {
  const open: ForgejoIssue[] = []
  const closed: FollowedItem[] = []
  await inBatches(following, async one => {
    try {
      const issue = await getJson<ForgejoIssue>($, token, `/repos/${one.repo}/issues/${one.number}`)
      if (issue.state === 'open') open.push(issue)
      else closed.push(one)
    } catch (error) {
      errors.push(`${one.repo}#${one.number}: ${String(error)}`)
    }
  })

  return { open, closed }
}

/**
 * Queries Forgejo and reads the `following` items, reads the timeline of each
 * issue (and of each PR mentioning me or followed) whose updated_at changed
 * since `cache` and the review state of every PR, which CI can change without
 * touching updated_at. Resolves the result and the cache to keep.
 */
export async function fetchForgejo(
  $: EngineInterface,
  cache: TimelineCache,
  following: FollowedItem[] = [],
): Promise<SourceResult & { cache: TimelineCache }> {
  const errors: string[] = []
  try {
    const token = await readToken($)
    if (!token) return { me: '', items: [], errors: [`no ${HOST} token: run fj auth login`], cache, closed: [] }

    const me = (await getJson<{ login: string }>($, token, '/user')).login
    const lists: Partial<Record<Clause, ForgejoIssue[]>> = {}
    await Promise.all(
      (Object.entries(SEARCHES) as [Clause, string][]).map(async ([clause, query]) => {
        try {
          lists[clause] = await searchClause($, token, query)
        } catch (error) {
          errors.push(String(error))
        }
      }),
    )

    const followed = await readFollowed($, token, following, errors)

    // Every issue has its timeline read; a PR only when it mentions me or is followed.
    const threads = new Map<string, ForgejoIssue>()
    const pulls = new Map<string, ForgejoIssue>()
    const sources: [Clause | 'following', ForgejoIssue[]][] = [...(Object.entries(lists) as [Clause, ForgejoIssue[]][]), ['following', followed.open]]
    for (const [clause, found] of sources) {
      for (const issue of found) {
        const key = itemKey(toItem(issue))
        if (issue.pull_request) pulls.set(key, issue)
        if (!issue.pull_request || clause === 'mentioned' || clause === 'following') threads.set(key, issue)
      }
    }
    const kept: TimelineCache = {}
    const stale: [string, ForgejoIssue][] = []
    for (const [key, issue] of threads) {
      const hit = cache[key]
      if (hit && hit.updatedAt === issue.updated_at) kept[key] = hit
      else stale.push([key, issue])
    }
    await inBatches(stale, async ([key, issue]) => {
      try {
        const path = `/repos/${issue.repository.full_name}/issues/${issue.number}/timeline?limit=100`
        const events = await getJson<TimelineEvent[] | null>($, token, path)
        kept[key] = { ...flagsOf(events, issue, me), updatedAt: issue.updated_at }
      } catch (error) {
        errors.push(`${issue.repository.full_name}#${issue.number}: ${String(error)}`)
      }
    })
    const reviews: Record<string, ReviewState> = {}
    await inBatches([...pulls], async ([key, issue]) => {
      try {
        reviews[key] = await readReview($, token, issue)
      } catch (error) {
        errors.push(`${issue.repository.full_name}#${issue.number}: ${String(error)}`)
      }
    })

    return { me, items: mergeForgejo(lists, kept, reviews, followed.open), errors, cache: kept, closed: followed.closed }
  } catch (error) {
    return { me: '', items: [], errors: [...errors, String(error)], cache, closed: [] }
  }
}

import type { EngineInterface } from 'claude-code'

import type { SourceResult } from './github'
import { itemKey } from './model'
import type { RawItem } from './model'

export const HOST = 'hub.genro.com'
const API = `https://${HOST}/api/v1`
const KEYS = 'Library/Application Support/forgejo-cli.forgejo-cli/keys.json'
const PAGE = 50
const MAX_PAGES = 10
const PARALLEL = 6

// The Forgejo search has no boolean query: one call per clause.
export const SEARCHES = {
  assigned: 'type=issues&assigned=true',
  created: 'type=issues&created=true',
  prAssigned: 'type=pulls&assigned=true',
  prCreated: 'type=pulls&created=true',
  reviews: 'type=pulls&review_requested=true',
} as const
export type Clause = keyof typeof SEARCHES

export type ForgejoIssue = {
  number: number
  title: string
  html_url: string
  updated_at: string
  user: { login: string } | null
  assignees: { login: string }[] | null
  repository: { full_name: string }
  pull_request: { draft?: boolean } | null
}
export type TimelineEvent = { type: string }
export type Flags = { hasCommits: boolean; hasLinkedPr: boolean }
// Timeline flags per item key, valid while the item's updated_at is unchanged.
export type TimelineCache = Record<string, Flags & { updatedAt: string }>

export const flagsOf = (events: TimelineEvent[]): Flags => ({
  hasCommits: events.some(event => event.type === 'commit_ref'),
  hasLinkedPr: events.some(event => event.type === 'pull_ref'),
})

function toItem(issue: ForgejoIssue): RawItem {
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
    isApproved: false,
    hasCommits: false,
    hasLinkedPr: false,
  }
}

/**
 * Merges the clause lists into unique items, newest first. Assigned issues
 * with a linked PR drop out, as `-linked:pr` does on GitHub; drafts drop out
 * of review requests only. `flags` holds the timeline of every issue.
 */
export function mergeForgejo(
  lists: Partial<Record<Clause, ForgejoIssue[]>>,
  flags: Record<string, Flags>,
): RawItem[] {
  const byKey = new Map<string, RawItem>()
  for (const clause of Object.keys(SEARCHES) as Clause[]) {
    for (const issue of lists[clause] ?? []) {
      const item = toItem(issue)
      const key = itemKey(item)
      const found = { ...item, ...(item.kind === 'issue' ? flags[key] : {}) }
      if (clause === 'assigned' && found.hasLinkedPr) continue
      if (clause === 'reviews' && found.isDraft) continue
      byKey.set(key, found)
    }
  }

  return [...byKey.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Reads the token `fj auth` stored; it never leaves this module's calls. */
async function readToken($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  const keys = JSON.parse(String(await $.fs.read(`${home}/${KEYS}`)))

  return keys?.hosts?.[HOST]?.token
}

async function getJson<T>($: EngineInterface, token: string, path: string): Promise<T> {
  const res = await $.http.fetch(`${API}${path}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`${path.split('?')[0]}: HTTP ${res.status}`)

  return JSON.parse(res.text) as T
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
 * Queries Forgejo and reads the timeline of each issue whose updated_at
 * changed since `cache`. Resolves the result and the cache to keep.
 */
export async function fetchForgejo(
  $: EngineInterface,
  cache: TimelineCache,
): Promise<SourceResult & { cache: TimelineCache }> {
  const errors: string[] = []
  try {
    const token = await readToken($)
    if (!token) return { me: '', items: [], errors: [`no ${HOST} token: run fj auth login`], cache }

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

    const issues = new Map<string, ForgejoIssue>()
    for (const issue of Object.values(lists).flat()) {
      if (!issue.pull_request) issues.set(itemKey(toItem(issue)), issue)
    }
    const kept: TimelineCache = {}
    const stale: [string, ForgejoIssue][] = []
    for (const [key, issue] of issues) {
      const hit = cache[key]
      if (hit && hit.updatedAt === issue.updated_at) kept[key] = hit
      else stale.push([key, issue])
    }
    for (let at = 0; at < stale.length; at += PARALLEL) {
      await Promise.all(
        stale.slice(at, at + PARALLEL).map(async ([key, issue]) => {
          try {
            const path = `/repos/${issue.repository.full_name}/issues/${issue.number}/timeline?limit=100`
            const events = await getJson<TimelineEvent[]>($, token, path)
            kept[key] = { ...flagsOf(events), updatedAt: issue.updated_at }
          } catch (error) {
            errors.push(String(error))
          }
        }),
      )
    }

    return { me, items: mergeForgejo(lists, kept), errors, cache: kept }
  } catch (error) {
    return { me: '', items: [], errors: [...errors, String(error)], cache }
  }
}

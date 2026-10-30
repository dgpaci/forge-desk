import type { EngineInterface } from 'claude-code'

import { addMatch, CLAUSE_ROLE } from './model'
import type { Clause, RawItem } from './model'

// One search per clause of the selection, merged client-side: the plain
// search syntax is sure to work in GraphQL, the boolean one is not.
export const SEARCHES: Record<Clause, string> = {
  assigned: 'is:open is:issue assignee:@me -linked:pr',
  created: 'is:open is:issue author:@me',
  prAssigned: 'is:open is:pr assignee:@me',
  prCreated: 'is:open is:pr author:@me',
  reviews: 'is:open is:pr review-requested:@me draft:false',
}

const NODE = `nodes { __typename
  ... on Issue { number title url updatedAt repository { nameWithOwner } author { login }
    assignees(first: 10) { nodes { login } }
    timelineItems(first: 100, itemTypes: [REFERENCED_EVENT, CONNECTED_EVENT, CROSS_REFERENCED_EVENT]) {
      nodes { __typename ... on ReferencedEvent { commit { oid } }
        ... on CrossReferencedEvent { willCloseTarget source { __typename } } } } }
  ... on PullRequest { number title url updatedAt isDraft reviewDecision repository { nameWithOwner }
    author { login } assignees(first: 10) { nodes { login } } } }`

export const QUERY = `query { viewer { login } ${Object.entries(SEARCHES)
  .map(([alias, q]) => `${alias}: search(type: ISSUE, first: 100, query: "${q}") { issueCount ${NODE} }`)
  .join(' ')} }`

type Login = { login: string } | null
type TimelineNode = {
  __typename: string
  commit?: { oid: string } | null
  willCloseTarget?: boolean
  source?: { __typename: string }
}
type Node = {
  __typename: 'Issue' | 'PullRequest'
  number: number
  title: string
  url: string
  updatedAt: string
  repository: { nameWithOwner: string }
  author: Login
  assignees: { nodes: Login[] }
  timelineItems?: { nodes: TimelineNode[] }
  isDraft?: boolean
  reviewDecision?: string | null
}
type Search = { issueCount: number; nodes: Node[] }
export type GithubResponse = {
  data?: { viewer: { login: string } } & Record<string, Search | { login: string }>
  errors?: { message: string }[]
}

export type SourceResult = { me: string; items: RawItem[]; errors: string[] }

const isLinkingPr = (event: TimelineNode): boolean =>
  event.__typename === 'ConnectedEvent' ||
  (event.__typename === 'CrossReferencedEvent' &&
    event.source?.__typename === 'PullRequest' &&
    event.willCloseTarget === true)

function toItem(node: Node, clause: Clause): RawItem {
  const timeline = node.timelineItems?.nodes ?? []

  return {
    forge: 'github',
    repo: node.repository.nameWithOwner,
    number: node.number,
    kind: node.__typename === 'PullRequest' ? 'pr' : 'issue',
    title: node.title,
    url: node.url,
    updatedAt: node.updatedAt,
    author: node.author?.login ?? '',
    assignees: node.assignees.nodes.flatMap(one => (one ? [one.login] : [])),
    isDraft: node.isDraft ?? false,
    isApproved: node.reviewDecision === 'APPROVED',
    hasCommits: timeline.some(event => Boolean(event.commit)),
    hasLinkedPr: timeline.some(isLinkingPr),
    roles: [CLAUSE_ROLE[clause]],
  }
}

/** Turns the GraphQL answer into unique items, newest first. */
export function parseGithub(response: GithubResponse): SourceResult {
  const errors = (response.errors ?? []).map(error => error.message)
  const data = response.data
  if (!data) return { me: '', items: [], errors: errors.length ? errors : ['no data'] }

  const byUrl = new Map<string, RawItem>()
  for (const alias of Object.keys(SEARCHES) as Clause[]) {
    const search = data[alias] as Search | undefined
    if (!search) continue
    if (search.issueCount > search.nodes.length) {
      errors.push(`${alias}: showing ${search.nodes.length} of ${search.issueCount}`)
    }
    for (const node of search.nodes) {
      if (node?.__typename === 'Issue' || node?.__typename === 'PullRequest') {
        addMatch(byUrl, node.url, toItem(node, alias))
      }
    }
  }
  const items = [...byUrl.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  return { me: data.viewer.login, items, errors }
}

/** Queries GitHub through `gh`, which holds the user's auth. */
export async function fetchGithub($: EngineInterface): Promise<SourceResult> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(
      ['gh', 'api', 'graphql', '-f', `query=${QUERY}`],
      { timeoutMs: 60000 },
    )
    if (exitCode !== 0 && !stdout) return { me: '', items: [], errors: [stderr.trim().split('\n')[0] ?? 'gh failed'] }

    return parseGithub(JSON.parse(stdout) as GithubResponse)
  } catch (error) {
    return { me: '', items: [], errors: [String(error)] }
  }
}

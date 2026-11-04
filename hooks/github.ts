import type { EngineInterface } from 'claude-code'

import { addMatch, CLAUSE_ROLE, getPendingMention, isAnsweredMention, NO_REVIEW } from './model'
import type { Clause, RawItem, ReviewState } from './model'

// One search per clause of the selection, merged client-side: the plain
// search syntax is sure to work in GraphQL, the boolean one is not. `mentioned`
// comes last: its match, the only one carrying the thread, sets the mention.
export const SEARCHES: Record<Clause, string> = {
  assigned: 'is:open is:issue assignee:@me -linked:pr',
  created: 'is:open is:issue author:@me',
  prAssigned: 'is:open is:pr assignee:@me',
  prCreated: 'is:open is:pr author:@me',
  reviews: 'is:open is:pr review-requested:@me draft:false',
  mentioned: 'is:open mentions:@me',
}

// The thread, read only where a mention is looked for.
const THREAD = 'body comments(last: 50) { nodes { url body author { login } } }'

const node = (extra: string): string => `nodes { __typename
  ... on Issue { ${extra} number title url updatedAt repository { nameWithOwner } author { login }
    assignees(first: 10) { nodes { login } }
    timelineItems(first: 100, itemTypes: [REFERENCED_EVENT, CONNECTED_EVENT, CROSS_REFERENCED_EVENT]) {
      nodes { __typename ... on ReferencedEvent { commit { oid } }
        ... on CrossReferencedEvent { willCloseTarget source { __typename } } } } }
  ... on PullRequest { ${extra} number title url updatedAt isDraft reviewDecision mergeable repository { nameWithOwner }
    author { login } assignees(first: 10) { nodes { login } }
    reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }`

export const QUERY = `query { viewer { login } ${Object.entries(SEARCHES)
  .map(([alias, q]) => `${alias}: search(type: ISSUE, first: 100, query: "${q}") { issueCount ${node(alias === 'mentioned' ? THREAD : '')} }`)
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
  mergeable?: string
  reviewRequests?: { nodes: { requestedReviewer: { login?: string; slug?: string } | null }[] }
  commits?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] }
  body?: string
  comments?: { nodes: { url: string; body: string; author: Login }[] }
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

const DECISION: Record<string, ReviewState['reviewDecision']> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes' }

// UNKNOWN mergeability is still being computed: only a known conflict counts. No checks at all is green.
function reviewOf(node: Node): ReviewState {
  if (node.__typename !== 'PullRequest') return NO_REVIEW
  const rollup = node.commits?.nodes[0]?.commit.statusCheckRollup

  return {
    reviewDecision: DECISION[node.reviewDecision ?? ''] ?? 'none',
    requestedReviewers: (node.reviewRequests?.nodes ?? []).flatMap(({ requestedReviewer: one }) => {
      const name = one?.login ?? one?.slug
      return name ? [name] : []
    }),
    isMergeable: node.mergeable !== 'CONFLICTING',
    isCiGreen: !rollup || rollup.state === 'SUCCESS',
  }
}

// The opening post first, then the comments: whose last mention of `me` is still unanswered.
function mentionOf(node: Node, me: string): string {
  if (!node.comments) return ''
  const posts = [
    { author: node.author?.login ?? '', body: node.body ?? '', url: node.url },
    ...node.comments.nodes.map(one => ({ author: one.author?.login ?? '', body: one.body, url: one.url })),
  ]

  return getPendingMention(posts, me)
}

function toItem(node: Node, clause: Clause, me: string): RawItem {
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
    ...reviewOf(node),
    hasCommits: timeline.some(event => Boolean(event.commit)),
    hasLinkedPr: timeline.some(isLinkingPr),
    mentionUrl: mentionOf(node, me),
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
        addMatch(byUrl, node.url, toItem(node, alias, data.viewer.login))
      }
    }
  }
  const items = [...byUrl.values()].filter(item => !isAnsweredMention(item)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

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

import type { EngineInterface } from 'claude-code'

import { addMatch, CLAUSE_ROLE, getPendingMention, isAnsweredMention, NO_REVIEW } from './model'
import type { Clause, FollowedItem, RawItem, ReviewState, Role } from './model'

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

const fields = (extra: string): string => `__typename
  ... on Issue { ${extra} number title url updatedAt repository { nameWithOwner } author { login }
    assignees(first: 10) { nodes { login } }
    timelineItems(first: 100, itemTypes: [REFERENCED_EVENT, CONNECTED_EVENT, CROSS_REFERENCED_EVENT]) {
      nodes { __typename ... on ReferencedEvent { commit { oid } }
        ... on CrossReferencedEvent { willCloseTarget source { __typename } } } } }
  ... on PullRequest { ${extra} number title url updatedAt isDraft reviewDecision mergeable repository { nameWithOwner }
    author { login } assignees(first: 10) { nodes { login } }
    reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }`

const SEARCH_QUERY = Object.entries(SEARCHES)
  .map(([alias, q]) => `${alias}: search(type: ISSUE, first: 100, query: "${q}") { issueCount nodes { ${fields(alias === 'mentioned' ? THREAD : '')} } }`)
  .join(' ')

// The alias under which the query reads the followed item at `at`.
const followAlias = (at: number): string => `follow${at}`

/** One search per clause, then each followed item by number, its state and thread included. */
export function buildQuery(following: FollowedItem[] = []): string {
  const followed = following.map((one, at) => {
    const [owner, name] = one.repo.split('/')
    return `${followAlias(at)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) ` +
      `{ issueOrPullRequest(number: ${one.number}) { ${fields(`state ${THREAD}`)} } }`
  })

  return `query { viewer { login } ${[SEARCH_QUERY, ...followed].join(' ')} }`
}

export const QUERY = buildQuery()

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
  state?: string
}
type Search = { issueCount: number; nodes: Node[] }
export type GithubResponse = {
  data?: { viewer: { login: string } } & Record<string, Search | { login: string } | { issueOrPullRequest: Node | null } | null>
  errors?: { message: string }[]
}

// `closed` holds the followed items the forge found closed or merged: they leave the followed list.
export type SourceResult = { me: string; items: RawItem[]; errors: string[]; closed: FollowedItem[] }

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

function toItem(node: Node, role: Role, me: string): RawItem {
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
    roles: [role],
  }
}

/** Turns the GraphQL answer into unique items, newest first; `following` is what the query asked for. */
export function parseGithub(response: GithubResponse, following: FollowedItem[] = []): SourceResult {
  const errors = (response.errors ?? []).map(error => error.message)
  const data = response.data
  if (!data) return { me: '', items: [], errors: errors.length ? errors : ['no data'], closed: [] }

  const byUrl = new Map<string, RawItem>()
  for (const alias of Object.keys(SEARCHES) as Clause[]) {
    const search = data[alias] as Search | undefined
    if (!search) continue
    if (search.issueCount > search.nodes.length) {
      errors.push(`${alias}: showing ${search.nodes.length} of ${search.issueCount}`)
    }
    for (const node of search.nodes) {
      if (node?.__typename === 'Issue' || node?.__typename === 'PullRequest') {
        addMatch(byUrl, node.url, toItem(node, CLAUSE_ROLE[alias], data.viewer.login))
      }
    }
  }
  // A followed item the forge does not find stays followed: the error says why.
  const closed: FollowedItem[] = []
  following.forEach((one, at) => {
    const node = (data[followAlias(at)] as { issueOrPullRequest: Node | null } | null)?.issueOrPullRequest
    if (!node) return
    if (node.state !== 'OPEN') closed.push(one)
    else addMatch(byUrl, node.url, toItem(node, 'following', data.viewer.login))
  })
  const items = [...byUrl.values()].filter(item => !isAnsweredMention(item)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  return { me: data.viewer.login, items, errors, closed }
}

/** Queries GitHub through `gh`, which holds the user's auth; `following` holds the GitHub items followed. */
export async function fetchGithub($: EngineInterface, following: FollowedItem[] = []): Promise<SourceResult> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(
      ['gh', 'api', 'graphql', '-f', `query=${buildQuery(following)}`],
      { timeoutMs: 60000 },
    )
    if (exitCode !== 0 && !stdout) return { me: '', items: [], errors: [stderr.trim().split('\n')[0] ?? 'gh failed'], closed: [] }

    return parseGithub(JSON.parse(stdout) as GithubResponse, following)
  } catch (error) {
    return { me: '', items: [], errors: [String(error)], closed: [] }
  }
}

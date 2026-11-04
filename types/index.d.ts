export type Forge = 'github' | 'forgejo'
export type Kind = 'issue' | 'pr'
// Whose move it is, most urgent first: mine (ready, review, mentioned, inprogress, todo), others'
// (waiting, stalled), nobody's yet (tobeassigned).
export type Status = 'ready' | 'review' | 'mentioned' | 'inprogress' | 'todo' | 'waiting' | 'stalled' | 'tobeassigned'
export type ReviewDecision = 'approved' | 'changes' | 'none'
// Why the item is in the list: the clauses of the selection that matched it.
export type Role = 'assignee' | 'author' | 'reviewer' | 'mentioned'

// One open issue or PR, normalised across forges. `hasCommits` and
// `hasLinkedPr` come from the issue timeline; for PRs they stay false.
// The review fields are for PRs: `requestedReviewers` holds the reviews still
// pending, and `isMergeable` / `isCiGreen` stay false on issues. `mentionUrl` points at the
// latest mention of me nobody has answered with a comment of mine since; '' when there is none.
export type Item = {
  forge: Forge
  repo: string
  number: number
  kind: Kind
  title: string
  url: string
  updatedAt: string
  author: string
  assignees: string[]
  isDraft: boolean
  reviewDecision: ReviewDecision
  requestedReviewers: string[]
  isMergeable: boolean
  isCiGreen: boolean
  hasCommits: boolean
  hasLinkedPr: boolean
  mentionUrl: string
  roles: Role[]
  status: Status
}

// What the pane shows: an empty list means no restriction on that field.
export type Filter = {
  roles: Role[]
  statuses: Status[]
  forges: Forge[]
  text: string
}

// The last refresh: when it ended, what went wrong, whether one is running.
export type Meta = { refreshedAt: number; errors: string[]; isLoading: boolean }

declare module 'claude-code' {
  interface PluginState {
    'forge-desk': { items: Shaped<Item[]>; filter: Shaped<Filter>; showFilters: Shaped<boolean>; meta: Shaped<Meta> }
  }
}

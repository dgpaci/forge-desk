export type Forge = 'github' | 'forgejo'
export type Kind = 'issue' | 'pr'
// Whose move it is, most urgent first: mine (ready, review, inprogress, todo), others' (waiting,
// stalled), nobody's yet (tobeassigned).
export type Status = 'ready' | 'review' | 'inprogress' | 'todo' | 'waiting' | 'stalled' | 'tobeassigned'
export type ReviewDecision = 'approved' | 'changes' | 'none'
// Why the item is in the list: the clauses of the selection that matched it.
export type Role = 'assignee' | 'author' | 'reviewer'

// One open issue or PR, normalised across forges. `hasCommits` and
// `hasLinkedPr` come from the issue timeline; for PRs they stay false.
// The review fields are for PRs: `requestedReviewers` holds the reviews still
// pending, and `isMergeable` / `isCiGreen` stay false on issues.
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

// A repository whose activity the Activities page shows.
export type Followed = { forge: Forge; repo: string }

// One event on a followed repository, normalised across forges: `actor` did
// `verb` on `target` (an issue or PR title, a branch), `url` opens it.
export type Activity = {
  id: string
  forge: Forge
  repo: string
  actor: string
  verb: string
  target: string
  url: string
  createdAt: string
}

// The two pages of the pane.
export type Page = 'desk' | 'activities'

declare module 'claude-code' {
  interface PluginState {
    'forge-desk': {
      items: Shaped<Item[]>
      filter: Shaped<Filter>
      showFilters: Shaped<boolean>
      meta: Shaped<Meta>
      page: Shaped<Page>
      followed: Shaped<Followed[]>
      activities: Shaped<Activity[]>
      activityMeta: Shaped<Meta>
      followDraft: Shaped<Followed>
    }
  }
}

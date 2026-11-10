export type Forge = 'github' | 'forgejo'
export type Kind = 'issue' | 'pr'
// Whose move it is, most urgent first: mine (ready, review, mentioned, inprogress, todo), others'
// (waiting, stalled), nobody's yet (tobeassigned).
export type Status = 'ready' | 'review' | 'mentioned' | 'inprogress' | 'todo' | 'waiting' | 'stalled' | 'tobeassigned'
// 'required': branch protection wants an approval no one has given yet (GitHub only).
export type ReviewDecision = 'approved' | 'changes' | 'required' | 'none'
// Why the item is in the list: the clauses of the selection that matched it, or
// `following` for an item followed from the Activities page.
export type Role = 'assignee' | 'author' | 'reviewer' | 'mentioned' | 'following'

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

// A repository whose activity the Activities page shows.
export type Followed = { forge: Forge; repo: string }

// An issue or PR followed from the Activities page: the desk reads it on every refresh.
export type FollowedItem = { forge: Forge; repo: string; number: number }

// One event on a followed repository, normalised across forges: `actor` did
// `verb` on `target` (an issue or PR title, a branch), `url` opens it. `number` and
// `kind` name the issue or PR the event is about; 0 and '' when it is about none.
export type Activity = {
  id: string
  forge: Forge
  repo: string
  actor: string
  verb: string
  target: string
  url: string
  createdAt: string
  number: number
  kind: Kind | ''
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
      followedItems: Shaped<FollowedItem[]>
    }
  }
}

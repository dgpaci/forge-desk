export type Forge = 'github' | 'forgejo'
export type Kind = 'issue' | 'pr'
export type Status = 'blocked' | 'waiting' | 'inprogress' | 'todo' | 'tobeassigned'
// Why the item is in the list: the clauses of the selection that matched it.
export type Role = 'assignee' | 'author' | 'reviewer'

// One open issue or PR, normalised across forges. `hasCommits` and
// `hasLinkedPr` come from the issue timeline; for PRs they stay false.
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
  isApproved: boolean
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

declare module 'claude-code' {
  interface PluginState {
    'forge-desk': { items: Shaped<Item[]>; filter: Shaped<Filter>; meta: Shaped<Meta> }
  }
}

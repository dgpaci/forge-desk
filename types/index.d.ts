export type Forge = 'github' | 'forgejo'
export type Kind = 'issue' | 'pr'
export type Status = 'blocked' | 'waiting' | 'inprogress' | 'todo' | 'tobeassigned'

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
  status: Status
}

declare module 'claude-code' {
  interface PluginState {
    'forge-desk': { items: Shaped<Item[]> }
  }
}

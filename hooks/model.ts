import type { Item, Role } from '../types'

export type { Filter, Forge, Item, Kind, Meta, Role, Status } from '../types'

export type Clause = 'assigned' | 'created' | 'prAssigned' | 'prCreated' | 'reviews'

export const CLAUSE_ROLE: Record<Clause, Role> = {
  assigned: 'assignee',
  created: 'author',
  prAssigned: 'assignee',
  prCreated: 'author',
  reviews: 'reviewer',
}

/** Adds `item` to `byKey`, joining its roles with those of an earlier match. */
export function addMatch<T extends { roles: Role[] }>(byKey: Map<string, T>, key: string, item: T): void {
  const roles = new Set([...(byKey.get(key)?.roles ?? []), ...item.roles])
  byKey.set(key, { ...item, roles: [...roles] })
}

// What a source knows before the status is computed.
export type RawItem = Omit<Item, 'status'>

export const itemKey = (item: Pick<Item, 'forge' | 'repo' | 'number'>): string =>
  `${item.forge}:${item.repo}#${item.number}`

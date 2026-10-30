import type { Item } from '../types'

export type { Forge, Item, Kind, Status } from '../types'

// What a source knows before the status is computed.
export type RawItem = Omit<Item, 'status'>

export const itemKey = (item: Pick<Item, 'forge' | 'repo' | 'number'>): string =>
  `${item.forge}:${item.repo}#${item.number}`

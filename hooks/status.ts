import type { Item, RawItem, Status } from './model'

export const STALE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Computes the status of an item for `me` at time `now` (ms since epoch).
 * Precedence: blocked > waiting > inprogress > todo > tobeassigned.
 */
export function getStatus(item: RawItem, me: string, now: number): Status {
  const isStale = now - Date.parse(item.updatedAt) > STALE_MS
  const isOthers = item.assignees.length > 0 && !item.assignees.includes(me)

  if (item.kind === 'pr') {
    const isWaiting = !item.isDraft && !item.isApproved
    if ((isWaiting || isOthers) && isStale) return 'blocked'
    return isWaiting ? 'waiting' : 'inprogress'
  }
  if (isOthers && isStale) return 'blocked'
  if (item.assignees.length === 0) return 'tobeassigned'

  return item.hasCommits || item.hasLinkedPr ? 'inprogress' : 'todo'
}

export const withStatus = (items: RawItem[], me: string, now: number): Item[] =>
  items.map(item => ({ ...item, status: getStatus(item, me, now) }))

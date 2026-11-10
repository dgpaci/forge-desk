import type { Item, RawItem, Status } from './model'

export const STALE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Computes the status of an item for `me` at time `now` (ms since epoch): whose
 * move it is. Mine: review (requested from me), mentioned (a mention of me
 * still unanswered), ready (green, mergeable, approved or out of draft with no review asked nor required: merge it), inprogress, todo. Others': waiting, stalled once the
 * item has had no update for STALE_MS. My own idle work stays inprogress. A PR I only follow is others' work.
 */
export function getStatus(item: RawItem, me: string, now: number): Status {
  const isStale = now - Date.parse(item.updatedAt) > STALE_MS
  const isOthers = item.assignees.length > 0 && !item.assignees.includes(me)
  const onOthers: Status = isStale ? 'stalled' : 'waiting'

  if (item.kind === 'pr') {
    if (item.roles.includes('reviewer') && item.author !== me) return 'review'
    if (item.mentionUrl) return 'mentioned'
    if (isOthers || item.roles.every(role => role === 'following')) return onOthers
    if (item.isDraft) return 'inprogress'
    const isClean = item.isCiGreen && item.isMergeable
    // One approval is enough to merge: still-pending requests to other reviewers do not hold it back.
    if (item.reviewDecision === 'approved' && isClean) return 'ready'
    // A pending request outlives an earlier "changes requested": it is the re-request after the fixes.
    if (item.requestedReviewers.some(login => login !== me)) return onOthers
    // Out of draft with no review asked nor required: it is done, merge it.
    if (item.reviewDecision === 'none' && isClean) return 'ready'

    return 'inprogress'
  }
  if (item.mentionUrl) return 'mentioned'
  if (isOthers) return onOthers
  if (item.assignees.length === 0) return 'tobeassigned'

  return item.hasCommits || item.hasLinkedPr ? 'inprogress' : 'todo'
}

export const withStatus = (items: RawItem[], me: string, now: number): Item[] =>
  items.map(item => ({ ...item, status: getStatus(item, me, now) }))

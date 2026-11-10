import type { Item, Role } from '../types'

export type { Activity, Filter, Followed, FollowedItem, Forge, Item, Kind, Meta, Page, ReviewDecision, Role, Status } from '../types'

export type Clause = 'assigned' | 'created' | 'prAssigned' | 'prCreated' | 'reviews' | 'mentioned'

export const CLAUSE_ROLE: Record<Clause, Role> = {
  assigned: 'assignee',
  created: 'author',
  prAssigned: 'assignee',
  prCreated: 'author',
  reviews: 'reviewer',
  mentioned: 'mentioned',
}

/** Adds `item` to `byKey`, joining its roles with those of an earlier match. */
export function addMatch<T extends { roles: Role[] }>(byKey: Map<string, T>, key: string, item: T): void {
  const roles = new Set([...(byKey.get(key)?.roles ?? []), ...item.roles])
  byKey.set(key, { ...item, roles: [...roles] })
}

// What a source knows before the status is computed.
export type RawItem = Omit<Item, 'status'>

// What a PR's review and checks say; an issue keeps NO_REVIEW.
export type ReviewState = Pick<Item, 'reviewDecision' | 'requestedReviewers' | 'isMergeable' | 'isCiGreen'>
export const NO_REVIEW: ReviewState = { reviewDecision: 'none', requestedReviewers: [], isMergeable: false, isCiGreen: false }

export const itemKey = (item: Pick<Item, 'forge' | 'repo' | 'number'>): string =>
  `${item.forge}:${item.repo}#${item.number}`

// One post of a thread, the opening body included: who wrote it, what it says, where it is.
export type Post = { author: string; body: string; url: string }

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The url of the latest post by someone else that mentions `me` with no post of mine after it;
 * '' when every mention has had its answer. `posts` go oldest first.
 */
export function getPendingMention(posts: Post[], me: string): string {
  if (!me) return ''
  const mention = new RegExp(`@${escapeRegExp(me)}(?![\\w-])`, 'i')
  let pending = ''
  for (const post of posts) {
    if (post.author === me) pending = ''
    else if (mention.test(post.body)) pending = post.url
  }

  return pending
}

/** An item in the list only because it mentions me, and already answered: it drops out. */
export const isAnsweredMention = (item: Pick<Item, 'roles' | 'mentionUrl'>): boolean =>
  !item.mentionUrl && item.roles.every(role => role === 'mentioned')

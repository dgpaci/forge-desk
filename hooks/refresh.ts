import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { fetchForgejo } from './forgejo'
import type { TimelineCache } from './forgejo'
import { fetchGithub } from './github'
import type { Item } from './model'
import { withStatus } from './status'

const CACHE_KEY = 'forgejo-timeline-1'
// Change the tag when Item's fields change: it declines what an earlier
// version stored, which outlives a reload.
export const items = atom({ plugin: 'forge-desk', key: 'items' } as const, [], { shape: 'items-1' })

export type Refreshed = { items: Item[]; errors: string[] }

/** Queries both forges, computes the statuses and stores the list. */
export async function refresh($: EngineInterface): Promise<Refreshed> {
  const cache = ((await $.store.get(CACHE_KEY)) ?? {}) as TimelineCache
  const [github, forgejo] = await Promise.all([fetchGithub($), fetchForgejo($, cache)])
  await $.store.set(CACHE_KEY, forgejo.cache)

  const now = await $.clock.now()
  const all = [...withStatus(github.items, github.me, now), ...withStatus(forgejo.items, forgejo.me, now)]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  await update($, items, () => all)

  return {
    items: all,
    errors: [...github.errors.map(e => `github: ${e}`), ...forgejo.errors.map(e => `forgejo: ${e}`)],
  }
}

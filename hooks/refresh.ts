import type { EngineInterface } from 'claude-code'

import { fetchForgejo } from './forgejo'
import type { TimelineCache } from './forgejo'
import { fetchGithub } from './github'
import type { Forge, Item } from './model'
import { withStatus } from './status'

const CACHE_KEY = 'forgejo-timeline-1'

// `failed` names the forges that answered nothing but errors: their previous items stay.
export type Refreshed = { items: Item[]; errors: string[]; failed: Forge[] }

/** Queries both forges and computes the statuses; storing the list is the caller's. */
export async function refresh($: EngineInterface): Promise<Refreshed> {
  const cache = ((await $.store.get(CACHE_KEY)) ?? {}) as TimelineCache
  const [github, forgejo] = await Promise.all([fetchGithub($), fetchForgejo($, cache)])
  await $.store.set(CACHE_KEY, forgejo.cache)

  const now = await $.clock.now()

  return {
    items: [...withStatus(github.items, github.me, now), ...withStatus(forgejo.items, forgejo.me, now)],
    errors: [...github.errors.map(e => `github: ${e}`), ...forgejo.errors.map(e => `forgejo: ${e}`)],
    failed: (['github', 'forgejo'] as const).filter(forge => {
      const result = forge === 'github' ? github : forgejo
      return result.items.length === 0 && result.errors.length > 0
    }),
  }
}

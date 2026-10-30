import type { EngineInterface } from 'claude-code'

import { HOST as FORGEJO_HOST } from './forgejo'
import type { Forge } from './model'

const CACHE_KEY = 'checkouts-1'
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const ROOT = 'sviluppo'

const FORGE_HOST: Record<Forge, string> = { github: 'github.com', forgejo: FORGEJO_HOST }

// Local checkout per `host/owner/repo`, lower-cased.
export type CheckoutMap = Record<string, string>
type Cached = { builtAt: number; map: CheckoutMap }

export const repoKey = (forge: Forge, repo: string): string => `${FORGE_HOST[forge]}/${repo}`.toLowerCase()

/**
 * The `host/owner/repo` key of a git remote URL, in any of the forms
 * git@host:owner/repo.git, ssh://git@host[:port]/owner/repo.git and
 * https://[user@]host/owner/repo[.git]; undefined for anything else.
 */
export function getRemoteKey(url: string): string | undefined {
  const match =
    /^[\w.-]+@([\w.-]+):([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url) ??
    /^(?:ssh|https?):\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url)

  return match ? `${match[1]}/${match[2]}/${match[3]}`.toLowerCase() : undefined
}

/** The origin URL in the text of a .git/config file. */
export function getOriginUrl(config: string): string | undefined {
  const section = /\[remote "origin"\]([^[]*)/.exec(config)?.[1] ?? ''

  return /^\s*url\s*=\s*(\S+)/m.exec(section)?.[1]
}

/** Maps each `.git` directory to its checkout; the shortest path wins, as the main checkout. */
export function buildCheckoutMap(configs: { gitDir: string; config: string }[]): CheckoutMap {
  const map: CheckoutMap = {}
  for (const { gitDir, config } of configs) {
    const url = getOriginUrl(config)
    const key = url ? getRemoteKey(url) : undefined
    const checkout = gitDir.replace(/\/\.git$/, '')
    if (key && (!map[key] || checkout.length < map[key].length)) map[key] = checkout
  }

  return map
}

async function scan($: EngineInterface): Promise<CheckoutMap> {
  const home = await $.env.get('HOME')
  const { stdout } = await $.process.run([
    'find', `${home}/${ROOT}`, '-maxdepth', '5', '-name', '.git', '-type', 'd',
    '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.claude/worktrees/*', '-prune',
  ])
  const gitDirs = stdout.split('\n').filter(Boolean)
  const configs = await Promise.all(
    gitDirs.map(async gitDir => {
      try {
        return { gitDir, config: String(await $.fs.read(`${gitDir}/config`)) }
      } catch {
        return { gitDir, config: '' }
      }
    }),
  )

  return buildCheckoutMap(configs)
}

/** The local checkout of `repo`, scanning ~/sviluppo again when the cached map misses or is a day old. */
export async function findCheckout($: EngineInterface, forge: Forge, repo: string): Promise<string | undefined> {
  const key = repoKey(forge, repo)
  const now = await $.clock.now()
  const cached = (await $.store.get(CACHE_KEY)) as Cached | undefined
  if (cached && now - cached.builtAt < MAX_AGE_MS && cached.map[key]) return cached.map[key]

  const map = await scan($)
  await $.store.set(CACHE_KEY, { builtAt: now, map })

  return map[key]
}

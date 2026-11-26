import type { EngineInterface } from 'claude-code'

import { getPromptItem } from './actions'
import { getRemoteKey } from './checkouts'

// A gap between two turns longer than this is idle time, left out of the log.
export const IDLE_MS = 15 * 60 * 1000
// The day files, under the home folder; other tools read them, so their format is a contract.
const TIMELOG_DIR = '.claude/timelog'
// One key per session, so concurrent sessions never write the same one.
const SESSION_PREFIX = 'timelog-session-1:'
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** One active interval of a development session, a line of the day file. */
export type TimelogEntry = {
  start: string
  end: string
  remote: string
  ref: string | null
  kind: 'dev'
  source: 'forge-desk'
}

// What a session keeps between its turns: the item it was started on, when its last turn ended.
type SavedSession = { ref: string | null; lastEnd?: number; seenAt: number }

const pad = (n: number): string => String(Math.floor(n)).padStart(2, '0')

/** `ms` as ISO 8601 in local time with its offset: `2026-11-26T15:04:05+01:00`. */
export function toLocalIso(ms: number): string {
  const offset = -new Date(ms).getTimezoneOffset()
  const local = new Date(ms + offset * 60 * 1000).toISOString().slice(0, 19)
  const abs = Math.abs(offset)

  return `${local}${offset < 0 ? '-' : '+'}${pad(abs / 60)}:${pad(abs % 60)}`
}

/** Where the active stretch ending with a turn starts: the previous turn's end when the gap is not idle. */
export function getStretchStart(turnStart: number, lastEnd?: number): number {
  return lastEnd !== undefined && lastEnd <= turnStart && turnStart - lastEnd <= IDLE_MS ? lastEnd : turnStart
}

/** `[start, end]` cut at each local midnight, so each piece belongs to one day file. */
export function splitByDay(start: number, end: number): [number, number][] {
  const pieces: [number, number][] = []
  let from = start
  while (from < end) {
    const midnight = new Date(from)
    midnight.setHours(24, 0, 0, 0)
    const to = Math.min(end, midnight.getTime())
    pieces.push([from, to])
    from = to
  }

  return pieces
}

/** The lines of the interval `[start, end]`, grouped by the day file (`yyyy-mm-dd`) they go to. */
export function buildEntries(start: number, end: number, remote: string, ref: string | null): Record<string, TimelogEntry[]> {
  const days: Record<string, TimelogEntry[]> = {}
  for (const [from, to] of splitByDay(start, end)) {
    const entry: TimelogEntry = { start: toLocalIso(from), end: toLocalIso(to), remote, ref, kind: 'dev', source: 'forge-desk' }
    const day = entry.start.slice(0, 10)
    ;(days[day] ??= []).push(entry)
  }

  return days
}

/** The `host/owner/repo` of the session's origin; undefined outside a repository with a remote. */
async function getSessionRemote($: EngineInterface): Promise<string | undefined> {
  const repo = await $.session.repo()

  return repo?.remote ? getRemoteKey(repo.remote) : undefined
}

/**
 * At the session's first turn, keeps the issue or PR it was started on from the desk, when the
 * prompt is a session link's and the session runs in that item's repository; otherwise null.
 */
export async function startTimelog($: EngineInterface, prompt: string): Promise<void> {
  const key = SESSION_PREFIX + (await $.session.id())
  if (await $.store.get(key)) return
  const item = getPromptItem(prompt)
  const remote = item && (await getSessionRemote($))
  const ref = item && remote?.endsWith(`/${item.repo.toLowerCase()}`) ? `#${item.number}` : null
  await $.store.set(key, { ref, seenAt: await $.clock.now() } satisfies SavedSession)
}

/** Appends the active stretch that ends with this turn, lasted `durationMs`, to its day file. */
export async function recordTurn($: EngineInterface, durationMs: number): Promise<void> {
  const remote = await getSessionRemote($)
  if (!remote) return
  const key = SESSION_PREFIX + (await $.session.id())
  const saved = (await $.store.get(key)) as SavedSession | undefined
  const end = await $.clock.now()
  const start = getStretchStart(end - durationMs, saved?.lastEnd)
  await $.store.set(key, { ref: saved?.ref ?? null, lastEnd: end, seenAt: end } satisfies SavedSession)
  const dir = `${await $.env.get('HOME')}/${TIMELOG_DIR}`
  for (const [day, entries] of Object.entries(buildEntries(start, end, remote, saved?.ref ?? null))) {
    // One append per day: lines this short land whole even with several sessions writing.
    const { exitCode, stderr } = await $.process.run(['sh', '-c', 'mkdir -p "$1" && cat >> "$2"', 'sh', dir, `${dir}/${day}.jsonl`], {
      stdin: entries.map(entry => JSON.stringify(entry) + '\n').join(''),
    })
    if (exitCode !== 0) $.ui.log(`forge-desk: time log not written: ${stderr}`, { to: 'debug' })
  }
}

/** Forgets the sessions untouched for a month. */
export async function pruneTimelog($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    if (!key.startsWith(SESSION_PREFIX)) continue
    const saved = (await $.store.get(key)) as SavedSession | undefined
    if (!saved || now - saved.seenAt > SESSION_MAX_AGE_MS) await $.store.delete(key)
  }
}

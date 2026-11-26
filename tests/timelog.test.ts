import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code/testing'

import { getPromptItem, getSessionLink } from '../hooks/actions'
import type { Item } from '../hooks/model'
import { getStretchStart, IDLE_MS, splitByDay, toLocalIso } from '../hooks/timelog'

const MINUTE = 60 * 1000
// 26 November 2026, 10:00 local time.
const T0 = new Date(2026, 10, 26, 10, 0).getTime()

const ITEM: Item = {
  forge: 'forgejo', repo: 'acme/app', number: 7, kind: 'issue', title: 'Fix it', url: 'https://hub.genro.com/acme/app/issues/7',
  updatedAt: '2026-10-29T10:00:00Z', author: 'me', assignees: ['me'], isDraft: false,
  reviewDecision: 'none', requestedReviewers: [], isMergeable: false, isCiGreen: false,
  hasCommits: false, hasLinkedPr: false, mentionUrl: '', roles: ['assignee'], status: 'todo',
}

// The first prompt of the session Solve opens on ITEM.
const SOLVE_PROMPT = new URL(getSessionLink('solve', ITEM, '/h/sviluppo/acme/app')).searchParams.get('q') ?? ''

type Append = { path: string; lines: Record<string, unknown>[] }

/** A session `sid` in a checkout whose origin is `remote` (none: outside a repository); returns the appends. */
function setUp(on: On, remote: string | null, sid = 'sid-1', store: Record<string, unknown> = {}) {
  const appends: Append[] = []
  mock.store(on, store)
  const clock = mock.clock(on, { now: T0 })
  on('env.get', () => ({ value: '/h' }))
  on('session.id', () => ({ value: sid }))
  on('session.repo', () => ({ value: remote === null ? null : { root: '/h/sviluppo/acme/app', remote, internal: false, name: null } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'sh') {
      const lines = (e.init?.stdin ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
      appends.push({ path: e.argv.at(-1) ?? '', lines })
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return { appends, clock }
}

test('local timestamps carry their offset and read back as the same instant', async () => {
  const iso = toLocalIso(T0)
  expect(iso).toMatch(/^2026-11-26T10:00:00[+-]\d\d:\d\d$/)
  expect(Date.parse(iso)).toBe(T0)
})

test('a gap up to the idle threshold joins the stretch, a longer one is cut', async () => {
  expect(getStretchStart(T0, undefined)).toBe(T0)
  expect(getStretchStart(T0 + IDLE_MS, T0)).toBe(T0)
  expect(getStretchStart(T0 + IDLE_MS + 1, T0)).toBe(T0 + IDLE_MS + 1)
})

test('an interval across local midnight is split between the two days', async () => {
  const late = new Date(2026, 10, 26, 23, 50).getTime()
  const midnight = new Date(2026, 10, 27, 0, 0).getTime()
  expect(splitByDay(late, late + 20 * MINUTE)).toEqual([[late, midnight], [midnight, late + 20 * MINUTE]])
  expect(splitByDay(T0, T0)).toEqual([])
})

test('a session link prompt names the item it was clicked on', async () => {
  expect(getPromptItem(SOLVE_PROMPT)).toEqual({ repo: 'acme/app', number: 7 })
  expect(getPromptItem('fix the build\nplease')).toBeUndefined()
})

test('a session started from Solve logs its active time on the issue, idle gaps cut', async ($, on) => {
  const { appends, clock } = setUp(on, 'git@hub.genro.com:acme/app.git')
  const turn = async (id: string, text: string, minutes: number) => {
    await $.turn.start({ text, turnId: id })
    await clock.advance(minutes * MINUTE)
    await $.turn.complete({ answer: '', durationMs: minutes * MINUTE, isAborted: false, turnId: id, reason: 'answer' })
  }

  await turn('t1', SOLVE_PROMPT, 2)
  await clock.advance(5 * MINUTE)
  await turn('t2', 'go on', 1)
  await clock.advance(30 * MINUTE)
  await turn('t3', 'and now?', 1)
  // A subagent's turn runs inside one of the main loop's: it adds nothing.
  await $.turn.complete({ answer: '', durationMs: MINUTE, isAborted: false, turnId: 'a1', reason: 'answer', agentId: 'agent-1' })

  const at = (minutes: number) => toLocalIso(T0 + minutes * MINUTE)
  const line = (start: number, end: number) => ({
    start: at(start), end: at(end), remote: 'hub.genro.com/acme/app', ref: '#7', kind: 'dev', source: 'forge-desk',
  })
  expect(appends.map(one => one.path)).toEqual(Array(3).fill('/h/.claude/timelog/2026-11-26.jsonl'))
  expect(appends.flatMap(one => one.lines)).toEqual([line(0, 2), line(2, 8), line(38, 39)])
})

test('a session in another repo than the clicked item logs a null ref', async ($, on) => {
  const { appends, clock } = setUp(on, 'https://github.com/other/tool.git')
  // A Solve link opened in a checkout of another repository does not count for its issue.
  await $.turn.start({ text: SOLVE_PROMPT, turnId: 't1' })
  await clock.advance(MINUTE)
  await $.turn.complete({ answer: '', durationMs: MINUTE, isAborted: true, turnId: 't1', reason: 'aborted' })
  expect(appends.flatMap(one => one.lines)).toEqual([expect.objectContaining({ remote: 'github.com/other/tool', ref: null })])
})

test('a session outside a repository writes nothing', async ($, on) => {
  const { appends, clock } = setUp(on, null)
  await $.turn.start({ text: 'hello', turnId: 't1' })
  await clock.advance(MINUTE)
  await $.turn.complete({ answer: '', durationMs: MINUTE, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(appends).toEqual([])
})

test('the session keeps its ref and last turn across a reload of the module', async ($, on) => {
  const saved = { 'timelog-session-1:sid-1': { ref: '#7', lastEnd: T0 - 3 * MINUTE, seenAt: T0 - 3 * MINUTE } }
  const { appends, clock } = setUp(on, 'git@hub.genro.com:acme/app.git', 'sid-1', saved)
  await $.turn.start({ text: 'continue', turnId: 't9' })
  await clock.advance(MINUTE)
  await $.turn.complete({ answer: '', durationMs: MINUTE, isAborted: false, turnId: 't9', reason: 'answer' })
  expect(appends.flatMap(one => one.lines)).toEqual([
    expect.objectContaining({ start: toLocalIso(T0 - 3 * MINUTE), end: toLocalIso(T0 + MINUTE), ref: '#7' }),
  ])
})

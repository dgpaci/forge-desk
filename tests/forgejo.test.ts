import { expect, mock, test } from 'claude-code/testing'

import { mergeForgejo } from '../hooks/forgejo'
import type { ForgejoIssue } from '../hooks/forgejo'

const issue = (number: number, extra: Partial<ForgejoIssue> = {}): ForgejoIssue => ({
  number, title: `t${number}`, html_url: `https://hub.genro.com/acme/app/issues/${number}`,
  updated_at: `2026-10-${10 + number}T10:00:00Z`, user: { login: 'me' }, assignees: [{ login: 'me' }],
  repository: { full_name: 'acme/app' }, pull_request: null, ...extra,
})
const key = (number: number) => `forgejo:acme/app#${number}`

test('assigned issues with a linked PR and draft review requests drop out', async () => {
  const items = mergeForgejo(
    {
      assigned: [issue(1), issue(2)],
      created: [issue(3, { assignees: [] })],
      reviews: [issue(4, { pull_request: { draft: true } }), issue(5, { pull_request: { draft: false } })],
      prCreated: [issue(6, { pull_request: { draft: true } })],
    },
    {
      [key(1)]: { hasCommits: true, hasLinkedPr: false },
      [key(2)]: { hasCommits: false, hasLinkedPr: true },
      [key(3)]: { hasCommits: false, hasLinkedPr: false },
    },
  )

  expect(items.map(item => item.number)).toEqual([6, 5, 3, 1])
  expect(items.find(item => item.number === 1)?.hasCommits).toBe(true)
  expect(items.find(item => item.number === 6)).toMatchObject({ kind: 'pr', isDraft: true })
})

// The plugin's own `$` reaches the mocks below only through one of its hooks:
// the /forge-desk command runs a full refresh.
const CACHE_KEY = 'forgejo-timeline-1'

test('timelines are read only for issues whose update changed', async ($, on) => {
  const timelines: string[] = []
  mock.store(on, {
    [CACHE_KEY]: { [key(1)]: { hasCommits: false, hasLinkedPr: false, updatedAt: issue(1).updated_at } },
  })
  mock.clock(on)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'gh: not logged in', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.read', () => ({ value: JSON.stringify({ hosts: { 'hub.genro.com': { token: 'secret' } } }) }))
  on('http.fetch', (_, e) => {
    const reply = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    expect(e.init?.headers).toMatchObject({ Authorization: 'token secret' })
    if (e.url.endsWith('/user')) return reply({ login: 'me' })
    if (e.url.includes('type=issues&assigned=true')) return reply([issue(1), issue(2, { updated_at: '2026-10-30T10:00:00Z' })])
    if (e.url.includes('/timeline')) {
      timelines.push(e.url)
      return reply([{ type: 'commit_ref' }])
    }
    return reply([])
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const { text } = await $.command.run({
    command: 'forge-desk',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

  expect(timelines).toEqual(['https://hub.genro.com/api/v1/repos/acme/app/issues/2/timeline?limit=100'])
  expect(text).toBe('2 open issues and PRs.\ngithub: gh: not logged in')
})

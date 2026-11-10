import { expect, mock, test } from 'claude-code/testing'

import { flagsOf, mergeForgejo, reviewOf } from '../hooks/forgejo'
import type { ForgejoIssue, ForgejoPull } from '../hooks/forgejo'

const issue = (number: number, extra: Partial<ForgejoIssue> = {}): ForgejoIssue => ({
  number, title: `t${number}`, html_url: `https://hub.genro.com/acme/app/issues/${number}`,
  updated_at: `2026-10-${10 + number}T10:00:00Z`, user: { login: 'me' }, assignees: [{ login: 'me' }],
  repository: { full_name: 'acme/app' }, pull_request: null, ...extra,
})
const key = (number: number) => `forgejo:acme/app#${number}`

test('a followed item joins the list with the following role, beside its other roles', async () => {
  const items = mergeForgejo(
    { created: [issue(1)] },
    {},
    {},
    [issue(1), issue(2, { user: { login: 'bob' }, assignees: [] })],
  )

  expect(items.map(item => [item.number, item.roles])).toEqual([[2, ['following']], [1, ['author', 'following']]])
})

test('assigned issues with a linked PR and draft review requests drop out', async () => {
  const items = mergeForgejo(
    {
      assigned: [issue(1), issue(2)],
      created: [issue(3, { assignees: [] })],
      reviews: [issue(4, { pull_request: { draft: true } }), issue(5, { pull_request: { draft: false } })],
      prCreated: [issue(6, { pull_request: { draft: true } })],
    },
    {
      [key(1)]: { hasCommits: true, hasLinkedPr: false, mentionUrl: '' },
      [key(2)]: { hasCommits: false, hasLinkedPr: true, mentionUrl: '' },
      [key(3)]: { hasCommits: false, hasLinkedPr: false, mentionUrl: '' },
    },
  )

  expect(items.map(item => item.number)).toEqual([6, 5, 3, 1])
  expect(items.find(item => item.number === 1)?.hasCommits).toBe(true)
  expect(items.find(item => item.number === 6)).toMatchObject({ kind: 'pr', isDraft: true })
})

test('a mention unanswered stays, one answered drops out, on issues and PRs', async () => {
  const comment = (login: string, body: string, n: number) => ({ type: 'comment', body, user: { login }, html_url: `c${n}` })
  const open = issue(8, { user: { login: 'bob' }, assignees: [] })
  expect(flagsOf([comment('ann', 'what do you think @me?', 1)], open, 'me').mentionUrl).toBe('c1')
  expect(flagsOf([comment('ann', '@me?', 1), comment('me', 'fine', 2)], open, 'me').mentionUrl).toBe('')
  expect(flagsOf(null, { ...open, body: 'ping @me' }, 'me').mentionUrl).toBe(open.html_url)

  const items = mergeForgejo(
    { mentioned: [open, issue(9, { assignees: [] }), issue(10, { pull_request: { draft: false } })] },
    {
      [key(8)]: { hasCommits: false, hasLinkedPr: false, mentionUrl: 'c1' },
      [key(9)]: { hasCommits: false, hasLinkedPr: false, mentionUrl: '' },
      [key(10)]: { hasCommits: true, hasLinkedPr: false, mentionUrl: 'c5' },
    },
  )
  expect(items.map(item => [item.number, item.mentionUrl])).toEqual([[10, 'c5'], [8, 'c1']])
  expect(items[0]).toMatchObject({ kind: 'pr', hasCommits: false, roles: ['mentioned'] })
})

const PULL: ForgejoPull = { mergeable: true, head: { sha: 'abc' }, requested_reviewers: null, requested_reviewers_teams: null }
const review = (login: string, state: string, dismissed = false) => ({ user: { login }, state, dismissed })

test('each reviewer\'s latest verdict counts, and no CI is green', async () => {
  expect(reviewOf(PULL, null, '')).toEqual({ reviewDecision: 'none', requestedReviewers: [], isMergeable: true, isCiGreen: true })
  expect(reviewOf(PULL, [review('bob', 'REQUEST_CHANGES'), review('bob', 'APPROVED')], 'success').reviewDecision).toBe('approved')
  expect(reviewOf(PULL, [review('bob', 'APPROVED'), review('ann', 'REQUEST_CHANGES')], 'success').reviewDecision).toBe('changes')
  expect(reviewOf(PULL, [review('ann', 'REQUEST_CHANGES', true), review('bob', 'COMMENT')], 'success').reviewDecision).toBe('none')
  const pending = reviewOf({ ...PULL, mergeable: false, requested_reviewers: [{ login: 'bob' }], requested_reviewers_teams: [{ name: 'core' }] }, [], 'failure')
  expect(pending).toEqual({ reviewDecision: 'none', requestedReviewers: ['bob', 'core'], isMergeable: false, isCiGreen: false })
})

test('the review state lands on PRs only', async () => {
  const state = { reviewDecision: 'approved', requestedReviewers: [], isMergeable: true, isCiGreen: true } as const
  const items = mergeForgejo({ prCreated: [issue(6, { pull_request: { draft: false } })] }, {}, { [key(6)]: state })

  expect(items[0]).toMatchObject({ kind: 'pr', ...state })
})

// The plugin's own `$` reaches the mocks below only through one of its hooks:
// the /forge-desk command runs a full refresh.
const CACHE_KEY = 'forgejo-timeline-2'

test('timelines are read only for issues whose update changed, an empty one included', async ($, on) => {
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
    if (e.url.includes('type=issues&assigned=true')) {
      return reply([issue(1), issue(2, { updated_at: '2026-10-30T10:00:00Z' }), issue(3, { updated_at: '2026-10-01T10:00:00Z' })])
    }
    if (e.url.includes('/timeline')) {
      timelines.push(e.url)
      return reply(e.url.includes('/issues/3/') ? null : [{ type: 'commit_ref' }])
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

  expect(timelines.sort()).toEqual([
    'https://hub.genro.com/api/v1/repos/acme/app/issues/2/timeline?limit=100',
    'https://hub.genro.com/api/v1/repos/acme/app/issues/3/timeline?limit=100',
  ])
  expect(text).toBe('3 open issues and PRs.\ngithub: gh: not logged in')
})

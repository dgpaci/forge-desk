import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { buildPrompt, getActions, getPromptTitle, getSessionLink, getSessionTitle } from '../hooks/actions'
import type { ForgejoIssue } from '../hooks/forgejo'
import type { Item } from '../hooks/model'

const ITEM: Item = {
  forge: 'forgejo', repo: 'acme/app', number: 7, kind: 'issue', title: 'Fix it', url: 'https://hub.genro.com/acme/app/issues/7',
  updatedAt: '2026-10-29T10:00:00Z', author: 'me', assignees: ['bob'], isDraft: false, isApproved: false,
  hasCommits: false, hasLinkedPr: false, roles: ['author'], status: 'blocked',
}

test('issues offer Solve, others\' PRs Review, my PRs Work on it', async () => {
  expect(getActions(ITEM)).toEqual(['solve', 'update', 'nudge'])
  expect(getActions({ ...ITEM, kind: 'pr', roles: ['reviewer'] })[0]).toBe('review')
  expect(getActions({ ...ITEM, kind: 'pr', roles: ['author', 'assignee'] })[0]).toBe('work')
})

test('the session actions start a child session in the checkout, or ask to clone', async () => {
  const solve = buildPrompt('solve', ITEM, '/h/sviluppo/acme/app')
  expect(solve).toContain('cwd "/h/sviluppo/acme/app"')
  expect(solve).toContain('resolve issue https://hub.genro.com/acme/app/issues/7')
  expect(solve).toContain('assignment check')
  const review = buildPrompt('review', { ...ITEM, kind: 'pr' }, '/h/sviluppo/acme/app')
  expect(review).toContain('code-review skill')
  expect(review).toContain('no review comment without my explicit OK')
  expect(buildPrompt('solve', ITEM)).toContain('No local checkout of acme/app')
})

test('an update is read only and a nudge waits for my OK', async () => {
  expect(buildPrompt('update', ITEM)).toContain('Read only')
  const nudge = buildPrompt('nudge', ITEM)
  expect(nudge).toContain('only after my explicit OK')
  expect(nudge).toContain('whoever it is waiting on')
  expect(buildPrompt('nudge', { ...ITEM, kind: 'pr', status: 'waiting' })).toContain('the requested reviewers')
})

// A Forgejo issue acme/app#7 with its checkout on disk, the pane open on it.
async function pressSolve(
  $: Parameters<TestBody>[0], on: Parameters<TestBody>[1], onRun: (argv: readonly string[]) => number | undefined,
) {
  const issue: ForgejoIssue = {
    number: 7, title: 'Fix it', html_url: ITEM.url, updated_at: ITEM.updatedAt, user: { login: 'me' },
    assignees: [{ login: 'me' }], repository: { full_name: 'acme/app' }, pull_request: null,
  }
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('process.run', (_, e) => {
    const out = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    const exit = onRun(e.argv)
    if (exit !== undefined) return out('', exit)
    return e.argv[0] === 'find' ? out('/h/sviluppo/acme/app/.git\n') : out('', 1)
  })
  on('fs.read', (_, e) =>
    e.path.endsWith('/.git/config')
      ? { value: '[remote "origin"]\n\turl = git@hub.genro.com:acme/app.git\n' }
      : { value: JSON.stringify({ hosts: { 'hub.genro.com': { token: 't' } } }) },
  )
  on('http.fetch', (_, e) => {
    const reply = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    if (e.url.endsWith('/user')) return reply({ login: 'me' })
    if (e.url.includes('type=issues&assigned=true')) return reply([issue])
    return reply(e.url.includes('/timeline') ? [] : [])
  })

  await $.command.run({
    command: 'forge-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
  })
  const ui = await $.ui.mount({
    plugin: 'forge-desk', component: 'Pane', requestId: 'forge-desk', surface: 'desktop',
    props: { title: 'Forge desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  await ui.press({ key: 'solve:forgejo:acme/app#7' })
  await ui.unmount()
}

test('each action names its session after the action, the kind and the short repo', async () => {
  const pr: Item = { ...ITEM, kind: 'pr', number: 99 }
  expect(getSessionTitle('solve', ITEM)).toBe('Work on issue app#7')
  expect(getSessionTitle('work', pr)).toBe('Work on PR app#99')
  expect(getSessionTitle('review', pr)).toBe('Review PR app#99')
  expect(getSessionTitle('update', ITEM)).toBe('Update issue app#7')
  expect(getSessionTitle('nudge', pr)).toBe('Nudge PR app#99')
})

test('a session link\'s prompt carries the title on its first line, the request in this session none', async () => {
  const q = new URL(getSessionLink('review', { ...ITEM, kind: 'pr' }, '/h/sviluppo/acme/app')).searchParams.get('q') ?? ''
  expect(q.split('\n')[0]).toBe('Review PR app#7')
  expect(getPromptTitle(q)).toBe('Review PR app#7')
  expect(getPromptTitle(buildPrompt('update', ITEM))).toBeUndefined()
  expect(getPromptTitle('Fix the login\nplease')).toBeUndefined()
  expect(buildPrompt('solve', ITEM, '/h/sviluppo/acme/app')).toContain('title "Work on issue app#7"')
})

test('the prompt of a session link names its session', async ($, on) => {
  on('classic.UserPromptSubmit', () => ({}))
  const q = new URL(getSessionLink('solve', ITEM, '/h/sviluppo/acme/app')).searchParams.get('q') ?? ''
  expect((await $.classic.UserPromptSubmit({ prompt: q })).sessionTitle).toBe('Work on issue app#7')
  expect((await $.classic.UserPromptSubmit({ prompt: buildPrompt('update', ITEM) })).sessionTitle).toBeUndefined()
})

test('the session link opens Desktop in the checkout with the task', async () => {
  const link = new URL(getSessionLink('solve', ITEM, '/h/sviluppo/acme/app'))
  expect(`${link.protocol}//${link.host}${link.pathname}`).toBe('claude://code/new')
  expect(link.searchParams.get('folder')).toBe('/h/sviluppo/acme/app')
  const q = link.searchParams.get('q') ?? ''
  expect(q).toContain('resolve issue https://hub.genro.com/acme/app/issues/7')
  expect(q).toContain('follow its CLAUDE.md')
  expect(link.search).not.toContain('+')
  const update = new URL(getSessionLink('update', ITEM))
  expect(update.searchParams.get('folder')).toBeNull()
  expect(update.searchParams.get('q')).toContain('Read only')
})

// The process runs of a Solve press: `open` answers with `openExit`.
async function pressWith($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], openExit: number) {
  const prompts: string[] = []
  const opened: string[] = []
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  await pressSolve($, on, argv => {
    if (argv[0] !== 'open') return undefined
    opened.push(argv[1])
    return openExit
  })

  return { prompts, opened }
}

test('pressing Solve opens the Desktop link, sending nothing here', async ($, on) => {
  const { prompts, opened } = await pressWith($, on, 0)

  expect(prompts).toEqual([])
  expect(opened).toHaveLength(1)
  expect(opened[0]).toStartWith('claude://code/new?')
  expect(new URL(opened[0]).searchParams.get('q')).toStartWith('Work on issue app#7\n[forge-desk]')
})

test('without the Desktop app, pressing Solve asks Claude here instead', async ($, on) => {
  const { prompts } = await pressWith($, on, 1)

  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('cwd "/h/sviluppo/acme/app"')
})

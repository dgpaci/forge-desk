import { expect, mock, test } from 'claude-code/testing'

import { buildPrompt } from '../hooks/actions'
import type { ForgejoIssue } from '../hooks/forgejo'
import type { Item } from '../hooks/model'

const ITEM: Item = {
  forge: 'forgejo', repo: 'acme/app', number: 7, kind: 'issue', title: 'Fix it', url: 'https://hub.genro.com/acme/app/issues/7',
  updatedAt: '2026-10-29T10:00:00Z', author: 'me', assignees: ['bob'], isDraft: false, isApproved: false,
  hasCommits: false, hasLinkedPr: false, roles: ['author'], status: 'blocked',
}

test('work on it starts a child session in the checkout, or asks to clone', async () => {
  const work = buildPrompt('work', ITEM, '/h/sviluppo/acme/app')
  expect(work).toContain('cwd "/h/sviluppo/acme/app"')
  expect(work).toContain('assignment check')
  expect(buildPrompt('work', ITEM)).toContain('No local checkout of acme/app')
})

test('an update is read only and a nudge waits for my OK', async () => {
  expect(buildPrompt('update', ITEM)).toContain('Read only')
  const nudge = buildPrompt('nudge', ITEM)
  expect(nudge).toContain('only after my explicit OK')
  expect(nudge).toContain('whoever it is waiting on')
  expect(buildPrompt('nudge', { ...ITEM, kind: 'pr', status: 'waiting' })).toContain('the requested reviewers')
})

test('pressing Work on it sends the prompt with the checkout found on disk', async ($, on) => {
  const prompts: string[] = []
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
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })

  await $.command.run({
    command: 'forge-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
  })
  const ui = await $.ui.mount({
    plugin: 'forge-desk', component: 'Pane', requestId: 'forge-desk', surface: 'desktop',
    props: { title: 'Forge desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  await ui.press({ key: 'work:forgejo:acme/app#7' })

  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('cwd "/h/sviluppo/acme/app"')
  await ui.unmount()
})

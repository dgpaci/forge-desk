import { expect, mock, test } from 'claude-code/testing'

import type { ForgejoIssue } from '../hooks/forgejo'

const issue = (number: number, extra: Partial<ForgejoIssue> = {}): ForgejoIssue => ({
  number, title: `title ${number}`, html_url: `https://hub.genro.com/acme/app/issues/${number}`,
  updated_at: '2026-10-29T10:00:00Z', user: { login: 'me' }, assignees: [{ login: 'me' }],
  repository: { full_name: 'acme/app' }, pull_request: null, ...extra,
})

const PANE = {
  plugin: 'forge-desk',
  component: 'Pane',
  requestId: 'forge-desk',
  props: {
    title: 'Forge desk',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('the pane opens on Focus and the views switch the list', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: 'gh: offline', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.read', () => ({ value: JSON.stringify({ hosts: { 'hub.genro.com': { token: 't' } } }) }))
  on('http.fetch', (_, e) => {
    const reply = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    if (e.url.endsWith('/user')) return reply({ login: 'me' })
    if (e.url.includes('type=issues&assigned=true')) return reply([issue(1)])
    if (e.url.includes('type=issues&created=true')) return reply([issue(2, { assignees: [] })])
    if (e.url.includes('review_requested=true')) {
      return reply([issue(3, { pull_request: { draft: false }, user: { login: 'bob' }, assignees: [] })])
    }
    return reply([])
  })

  await $.command.run({
    command: 'forge-desk',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // A Link's text joins its href and its label.
  const titles = async () => (await ui.findAll({ type: 'Link' })).map(link => link.text.slice(link.text.indexOf('title')))

  expect(await titles()).toEqual(['title 3', 'title 1'])
  expect((await ui.find({ type: 'Text', text: /gh: offline/ }))?.text).toBe('github: gh: offline')

  await ui.press({ key: 'view-unassigned' })
  expect(await titles()).toEqual(['title 2'])

  await ui.press({ key: 'view-all' })
  await ui.input({ key: 'text', text: 'title 1' })
  expect(await titles()).toEqual(['title 1'])
  await ui.unmount()
})

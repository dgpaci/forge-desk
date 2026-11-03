import { expect, mock, test } from 'claude-code/testing'

import type { Item } from '../hooks/model'

const item = (forge: Item['forge'], number: number): Item => ({
  forge, repo: 'acme/app', number, kind: 'issue', title: `title ${number}`, url: `https://x/${number}`,
  updatedAt: '2026-10-29T10:00:00Z', author: 'me', assignees: ['me'], isDraft: false,
  reviewDecision: 'none', requestedReviewers: [], isMergeable: false, isCiGreen: false,
  hasCommits: false, hasLinkedPr: false, roles: ['assignee'], status: 'todo',
})

test('offline, the pane keeps the saved list and retries every 5 minutes', async ($, on) => {
  let ghCalls = 0
  mock.store(on, { 'items-cache-2': { savedAt: 0, items: [item('github', 1), item('forgejo', 2)] } })
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'forge-desk' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => {
    ghCalls++
    return { value: { exitCode: 1, stdout: '', stderr: 'offline', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('env.get', () => ({ value: '/h' }))
  on('fs.read', () => ({ value: JSON.stringify({ hosts: {} }) }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)
  const ui = await $.ui.mount({
    plugin: 'forge-desk', component: 'Pane', requestId: 'forge-desk', surface: 'desktop',
    props: { title: 'Forge desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  const titles = async () => (await ui.findAll({ type: 'Link' })).map(link => link.text.slice(link.text.indexOf('title')))

  expect(await titles()).toEqual(['title 1', 'title 2'])
  expect((await ui.find({ type: 'Text', text: /github: offline/ }))?.text).toBe('github: offline')
  const before = ghCalls
  await clock.advance(5 * 60 * 1000)
  expect(ghCalls).toBe(before + 1)
  await ui.unmount()
})

test('a command run during a refresh reports the list as it stands', async ($, on) => {
  let release = () => {}
  const offline = new Promise<void>(resolve => { release = resolve })
  mock.store(on, { 'items-cache-2': { savedAt: 0, items: [item('github', 1), item('forgejo', 2)] } })
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'forge-desk' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', async () => {
    await offline
    return { value: { exitCode: 1, stdout: '', stderr: 'offline', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('env.get', () => ({ value: '/h' }))
  on('fs.read', () => ({ value: JSON.stringify({ hosts: {} }) }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const { text } = await $.command.run({
    command: 'forge-desk', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
  })
  release()
  // Let the session-start refresh end before the test does.
  await clock.advance(1000)

  expect(text).toBe('2 open issues and PRs.\na refresh is running: the pane updates when it ends')
})

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

test('Open in browser writes the board and opens it', async ($, on) => {
  const written: string[] = []
  const opened: string[] = []
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.read', () => ({ value: JSON.stringify({ hosts: {} }) }))
  on('fs.write', (_, e) => {
    written.push(e.path)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    if (e.argv[0] === 'open') opened.push(e.argv[1])
    return { value: { exitCode: e.argv[0] === 'open' ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  const ui = await $.ui.mount({
    plugin: 'forge-desk', component: 'Pane', requestId: 'forge-desk', surface: 'desktop',
    props: { title: 'Forge desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  await ui.press({ key: 'browser' })
  await ui.unmount()

  expect(written).toContain('/h/.claude/forge-desk/desk.html')
  expect(opened).toEqual(['/h/.claude/forge-desk/desk.html'])
})

test('the Activities page follows a repository and shows its feed', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'forge-desk' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/h' }))
  on('fs.read', () => ({ value: JSON.stringify({ hosts: { 'hub.genro.com': { token: 't' } } }) }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: 'gh: offline', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('http.fetch', (_, e) => {
    const reply = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    if (e.url.endsWith('/repos/anaci/anaci')) return reply({ full_name: 'anaci/anaci' })
    if (e.url.includes('/repos/anaci/anaci/activities/feeds')) {
      return reply([{ id: 1, op_type: 'merge_pull_request', act_user: { login: 'bob' }, repo: { full_name: 'anaci/anaci' },
        ref_name: '', content: '["522","title login"]', comment: null, created: '2026-11-03T10:00:00Z' }])
    }
    if (e.url.endsWith('/user')) return reply({ login: 'me' })
    return reply([])
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', text: '⚡' }))?.text).toBe('⚡')
  await ui.press({ key: 'page' })
  expect((await ui.find({ type: 'Text', text: /No repository followed/ }))?.text).toBe('No repository followed yet.')
  expect((await ui.find({ type: 'Button', text: '📋' }))?.text).toBe('📋')

  await ui.input({ key: 'follow-repo', text: 'https://hub.genro.com/anaci/anaci' })
  const links = (await ui.findAll({ type: 'Link' })).map(link => link.text)
  expect(links.some(text => text.includes('#522 title login'))).toBe(true)
  expect((await ui.find({ type: 'Button', text: /anaci\/anaci/ }))?.text).toBe('× FJ anaci/anaci')

  await ui.press({ key: 'unfollow-forgejo:anaci/anaci' })
  expect((await ui.findAll({ type: 'Link' })).length).toBe(0)
  await ui.press({ key: 'page' })
  expect(await ui.find({ type: 'Text', text: /No repository followed/ })).toBeUndefined()
  await ui.unmount()
})

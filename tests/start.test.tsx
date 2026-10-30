import { expect, mock, test } from 'claude-code/testing'

test('after session start the pane is on Focus', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'forge-desk' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: 'gh: offline', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.read', () => ({ value: JSON.stringify({ hosts: {} }) }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'forge-desk', component: 'Pane', requestId: 'forge-desk', surface: 'desktop',
    props: { title: 'Forge desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  const variant = async (key: string) => (await ui.find({ key }))?.props.variant

  expect(await variant('view-focus')).toBe('primary')
  expect(await variant('role-assignee')).toBe('primary')
  expect(await variant('view-all')).toBe('secondary')
  await ui.unmount()
})

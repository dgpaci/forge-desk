import type { Register } from 'claude-code'

import type { Status } from './model'
import { refresh } from './refresh'

const ORDER: Status[] = ['blocked', 'waiting', 'inprogress', 'todo', 'tobeassigned']

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'forge-desk',
      description: 'Refresh open issues and PRs from GitHub and Forgejo',
    })

    return next(e)
  })

  // Until the pane exists, the command reports the counts per forge and status.
  on('command.run', { command: 'forge-desk' }, async $ => {
    const { items, errors } = await refresh($)
    const lines = (['github', 'forgejo'] as const).map(forge => {
      const mine = items.filter(item => item.forge === forge)
      const counts = ORDER.map(status => `${status} ${mine.filter(item => item.status === status).length}`)
      return `${forge}: ${mine.length} (${counts.join(', ')})`
    })

    return { text: [...lines, ...errors].join('\n') }
  })
}

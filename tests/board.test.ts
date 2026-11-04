import { expect, test } from 'claude-code/testing'

import { getRows, renderBoard } from '../hooks/board'
import type { Item } from '../hooks/model'

const ITEM: Item = {
  forge: 'forgejo', repo: 'acme/app', number: 7, kind: 'issue', title: 'Breaks on </script>', url: 'https://hub.genro.com/acme/app/issues/7',
  updatedAt: '2026-10-29T10:00:00Z', author: 'me', assignees: ['me'], isDraft: false,
  reviewDecision: 'none', requestedReviewers: [], isMergeable: false, isCiGreen: false,
  hasCommits: false, hasLinkedPr: false, mentionUrl: '', roles: ['assignee'], status: 'todo',
}
const INPUT = {
  items: [ITEM, { ...ITEM, repo: 'acme/other', number: 1 }],
  checkouts: { 'hub.genro.com/acme/app': '/h/sviluppo/app' },
  refreshedAt: Date.parse('2026-10-30T10:00:00Z'),
  errors: [],
  activities: [],
  followed: [],
  activityErrors: [],
}

test('each row links its actions to Desktop, in the checkout when there is one', async () => {
  const [inCheckout, without] = getRows(INPUT)

  expect(inCheckout.age).toBe('24h')
  expect(inCheckout.actions.map(action => action.label)).toEqual(['Solve', 'Get an update', 'Nudge'])
  expect(new URL(inCheckout.actions[0].href).searchParams.get('folder')).toBe('/h/sviluppo/app')
  expect(new URL(without.actions[0].href).searchParams.get('folder')).toBeNull()
  expect(new URL(inCheckout.actions[1].href).searchParams.get('q')).toStartWith('Update issue app#7\n')
})

test('a title cannot close the data element of the page', async () => {
  const html = renderBoard(INPUT)

  expect(html).not.toContain('Breaks on </script>')
  expect(html).toContain('Breaks on \\u003c/script>')
})

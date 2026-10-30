import { expect, test } from 'claude-code/testing'

import { applyFilter, getAge, getStatusCounts, toggle, VIEWS } from '../hooks/filter'
import type { Item } from '../hooks/model'

const item = (number: number, change: Partial<Item>): Item => ({
  forge: 'github', repo: 'acme/app', number, kind: 'issue', title: `title ${number}`, url: 'u',
  updatedAt: `2026-10-${10 + number}T10:00:00Z`, author: 'me', assignees: ['me'], isDraft: false,
  isApproved: false, hasCommits: false, hasLinkedPr: false, roles: ['assignee'], status: 'todo', ...change,
})

const ITEMS: Item[] = [
  item(1, {}),
  item(2, { status: 'blocked', roles: ['reviewer'], kind: 'pr' }),
  item(3, { status: 'tobeassigned', roles: ['author'], assignees: [] }),
  item(4, { status: 'inprogress', forge: 'forgejo', repo: 'acme/site', roles: ['assignee', 'author'] }),
  item(5, { status: 'todo', roles: ['author'], assignees: ['bob'] }),
]

test('focus keeps what is mine to do, most urgent first', async () => {
  expect(applyFilter(ITEMS, VIEWS.focus).map(one => one.number)).toEqual([2, 4, 1])
})

test('unassigned keeps the issues I created with nobody on them', async () => {
  expect(applyFilter(ITEMS, VIEWS.unassigned).map(one => one.number)).toEqual([3])
})

test('all keeps everything', async () => {
  expect(applyFilter(ITEMS, VIEWS.all)).toHaveLength(5)
})

test('forge and text narrow the list', async () => {
  expect(applyFilter(ITEMS, { ...VIEWS.all, forges: ['forgejo'] }).map(one => one.number)).toEqual([4])
  expect(applyFilter(ITEMS, { ...VIEWS.all, text: 'SITE' }).map(one => one.number)).toEqual([4])
  expect(applyFilter(ITEMS, { ...VIEWS.all, text: 'app#5' }).map(one => one.number)).toEqual([5])
})

test('status counts ignore the status filter itself', async () => {
  const counts = getStatusCounts(ITEMS, { ...VIEWS.focus, statuses: ['blocked'] })
  expect(counts).toEqual({ blocked: 1, waiting: 0, inprogress: 1, todo: 1, tobeassigned: 0 })
})

test('toggle and age', async () => {
  expect(toggle(['a', 'b'], 'a')).toEqual(['b'])
  expect(toggle(['b'], 'a')).toEqual(['b', 'a'])
  const now = Date.parse('2026-10-30T12:00:00Z')
  expect([getAge('2026-10-30T11:48:00Z', now), getAge('2026-10-30T07:00:00Z', now), getAge('2026-10-27T12:00:00Z', now)])
    .toEqual(['12m', '5h', '3d'])
})

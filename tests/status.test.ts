import { expect, test } from 'claude-code/testing'

import type { RawItem } from '../hooks/model'
import { getStatus } from '../hooks/status'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const FRESH = '2026-10-29T12:00:00Z'
const OLD = '2026-10-20T12:00:00Z'

const base: RawItem = {
  forge: 'github', repo: 'acme/app', number: 1, kind: 'issue', title: 't', url: 'u',
  updatedAt: FRESH, author: 'me', assignees: ['me'], isDraft: false, isApproved: false,
  hasCommits: false, hasLinkedPr: false,
}

const CASES: [string, Partial<RawItem>, string][] = [
  ['issue assigned to me, nothing done', {}, 'todo'],
  ['issue assigned to me, old and untouched', { updatedAt: OLD }, 'todo'],
  ['issue with a commit referencing it', { hasCommits: true }, 'inprogress'],
  ['issue with a linked PR', { hasLinkedPr: true }, 'inprogress'],
  ['issue I created, nobody assigned', { assignees: [] }, 'tobeassigned'],
  ['issue assigned to someone else, fresh', { assignees: ['bob'] }, 'todo'],
  ['issue assigned to someone else, stale', { assignees: ['bob'], updatedAt: OLD }, 'blocked'],
  ['PR awaiting review', { kind: 'pr' }, 'waiting'],
  ['PR awaiting review, stale', { kind: 'pr', updatedAt: OLD }, 'blocked'],
  ['draft PR', { kind: 'pr', isDraft: true }, 'inprogress'],
  ['draft PR, stale', { kind: 'pr', isDraft: true, updatedAt: OLD }, 'inprogress'],
  ['approved PR', { kind: 'pr', isApproved: true }, 'inprogress'],
  ['draft PR assigned to someone else, stale', { kind: 'pr', isDraft: true, assignees: ['bob'], updatedAt: OLD }, 'blocked'],
]

test('the status follows the precedence table', async () => {
  for (const [name, change, status] of CASES) {
    expect([name, getStatus({ ...base, ...change }, 'me', NOW)]).toEqual([name, status])
  }
})

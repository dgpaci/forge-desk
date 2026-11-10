import { expect, test } from 'claude-code/testing'

import type { RawItem } from '../hooks/model'
import { getStatus } from '../hooks/status'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const FRESH = '2026-10-29T12:00:00Z'
const OLD = '2026-10-20T12:00:00Z'

const base: RawItem = {
  forge: 'github', repo: 'acme/app', number: 1, kind: 'issue', title: 't', url: 'u',
  updatedAt: FRESH, author: 'me', assignees: ['me'], isDraft: false,
  reviewDecision: 'none', requestedReviewers: [], isMergeable: false, isCiGreen: false,
  hasCommits: false, hasLinkedPr: false, mentionUrl: '', roles: ['assignee'],
}

const PR: Partial<RawItem> = { kind: 'pr', roles: ['author'] }
const GREEN: Partial<RawItem> = { ...PR, reviewDecision: 'approved', isCiGreen: true, isMergeable: true }

const CASES: [string, Partial<RawItem>, string][] = [
  ['issue assigned to me, nothing done', {}, 'todo'],
  ['issue assigned to me, old and untouched', { updatedAt: OLD }, 'todo'],
  ['issue with a commit referencing it', { hasCommits: true }, 'inprogress'],
  ['issue with a linked PR, stale', { hasLinkedPr: true, updatedAt: OLD }, 'inprogress'],
  ['issue I created, nobody assigned', { assignees: [] }, 'tobeassigned'],
  ['issue assigned to someone else, fresh', { assignees: ['bob'] }, 'waiting'],
  ['issue assigned to someone else, stale', { assignees: ['bob'], updatedAt: OLD }, 'stalled'],
  ['PR approved, CI green, mergeable', GREEN, 'ready'],
  ['PR approved, CI red', { ...GREEN, isCiGreen: false }, 'inprogress'],
  ['PR approved, with conflicts', { ...GREEN, isMergeable: false }, 'inprogress'],
  ['PR approved, assigned to someone else', { ...GREEN, assignees: ['bob'] }, 'waiting'],
  ['PR approved, review still requested from others', { ...GREEN, requestedReviewers: ['bob'] }, 'ready'],
  ['PR approved, CI red, review still requested from others', { ...GREEN, isCiGreen: false, requestedReviewers: ['bob'] }, 'waiting'],
  ['someone else\'s PR, review requested from me', { kind: 'pr', author: 'bob', roles: ['reviewer'] }, 'review'],
  ['PR with review requested from others', { ...PR, requestedReviewers: ['bob'] }, 'waiting'],
  ['PR with review requested from others, stale', { ...PR, requestedReviewers: ['bob'], updatedAt: OLD }, 'stalled'],
  ['PR re-requested after changes', { ...PR, reviewDecision: 'changes', requestedReviewers: ['bob'] }, 'waiting'],
  ['PR with changes requested', { ...PR, reviewDecision: 'changes' }, 'inprogress'],
  ['PR with no reviewer requested, stale', { ...PR, updatedAt: OLD }, 'inprogress'],
  ['PR out of draft, no review asked, green, mergeable', { ...PR, isCiGreen: true, isMergeable: true }, 'ready'],
  ['PR out of draft, no review asked, CI red', { ...PR, isCiGreen: false, isMergeable: true }, 'inprogress'],
  ['PR out of draft, green, review required by protection', { ...PR, reviewDecision: 'required', isCiGreen: true, isMergeable: true }, 'inprogress'],
  ['PR with changes requested, green', { ...PR, reviewDecision: 'changes', isCiGreen: true, isMergeable: true }, 'inprogress'],
  ['draft PR, stale', { ...PR, isDraft: true, requestedReviewers: ['bob'], updatedAt: OLD }, 'inprogress'],
  ['someone else\'s PR I only follow, approved and green', { ...GREEN, author: 'bob', assignees: [], roles: ['following'] }, 'waiting'],
  ['issue I only follow, nobody assigned', { author: 'bob', assignees: [], roles: ['following'] }, 'tobeassigned'],
  ['draft PR assigned to someone else, stale', { ...PR, isDraft: true, assignees: ['bob'], updatedAt: OLD }, 'stalled'],
]

test('the status follows the precedence table', async () => {
  for (const [name, change, status] of CASES) {
    expect([name, getStatus({ ...base, ...change }, 'me', NOW)]).toEqual([name, status])
  }
})

test('an unanswered mention is my move, unless a review is', async () => {
  const mention = { mentionUrl: 'u#c1' }
  expect(getStatus({ ...base, ...mention, assignees: ['bob'] }, 'me', NOW)).toBe('mentioned')
  expect(getStatus({ ...base, ...mention, roles: ['mentioned'], assignees: [] }, 'me', NOW)).toBe('mentioned')
  expect(getStatus({ ...base, ...GREEN, ...mention }, 'me', NOW)).toBe('mentioned')
  expect(getStatus({ ...base, ...mention, kind: 'pr', roles: ['reviewer'], author: 'bob' }, 'me', NOW)).toBe('review')
})

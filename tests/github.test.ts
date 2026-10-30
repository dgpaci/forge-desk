import { expect, test } from 'claude-code/testing'

import { parseGithub, QUERY } from '../hooks/github'
import type { GithubResponse } from '../hooks/github'

const issue = (number: number, timeline: object[], updatedAt = '2026-10-29T10:00:00Z') => ({
  __typename: 'Issue', number, title: `issue ${number}`, url: `https://github.com/acme/app/issues/${number}`,
  updatedAt, repository: { nameWithOwner: 'acme/app' }, author: { login: 'me' },
  assignees: { nodes: [{ login: 'me' }] }, timelineItems: { nodes: timeline },
})
const pr = {
  __typename: 'PullRequest', number: 9, title: 'pr', url: 'https://github.com/acme/app/pull/9',
  updatedAt: '2026-10-28T10:00:00Z', isDraft: false, reviewDecision: 'APPROVED',
  repository: { nameWithOwner: 'acme/app' }, author: { login: 'me' }, assignees: { nodes: [] },
}
const search = (nodes: object[], issueCount = nodes.length) => ({ issueCount, nodes })

test('the query carries one search per clause', async () => {
  for (const alias of ['assigned', 'created', 'prAssigned', 'prCreated', 'reviews']) {
    expect(QUERY.includes(`${alias}: search(`)).toBe(true)
  }
})

test('items are merged across clauses and their timeline read', async () => {
  const response = {
    data: {
      viewer: { login: 'me' },
      assigned: search([issue(1, [{ __typename: 'ReferencedEvent', commit: { oid: 'abc' } }])]),
      created: search([
        issue(1, [{ __typename: 'ReferencedEvent', commit: { oid: 'abc' } }]),
        issue(2, [{ __typename: 'CrossReferencedEvent', willCloseTarget: true, source: { __typename: 'PullRequest' } }], '2026-10-30T10:00:00Z'),
        issue(3, [{ __typename: 'CrossReferencedEvent', willCloseTarget: false, source: { __typename: 'PullRequest' } }]),
      ], 120),
      prAssigned: search([]),
      prCreated: search([pr]),
      reviews: search([]),
    },
  } as unknown as GithubResponse

  const { me, items, errors } = parseGithub(response)

  expect(me).toBe('me')
  expect(items.map(item => item.number)).toEqual([2, 1, 3, 9])
  expect(items.find(item => item.number === 1)?.hasCommits).toBe(true)
  expect(items.find(item => item.number === 2)?.hasLinkedPr).toBe(true)
  expect(items.find(item => item.number === 3)?.hasLinkedPr).toBe(false)
  expect(items.find(item => item.number === 9)).toMatchObject({ kind: 'pr', isApproved: true })
  expect(errors).toEqual(['created: showing 3 of 120'])
})

test('a GraphQL error comes back as an error, not a crash', async () => {
  expect(parseGithub({ errors: [{ message: 'Bad credentials' }] })).toEqual({ me: '', items: [], errors: ['Bad credentials'] })
})

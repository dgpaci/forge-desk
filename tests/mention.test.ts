import { expect, test } from 'claude-code/testing'

import { getPendingMention, isAnsweredMention } from '../hooks/model'

const post = (author: string, body: string, url: string) => ({ author, body, url })

test('the last mention by someone else counts until I post after it', async () => {
  expect(getPendingMention([post('bob', 'hi @me, thoughts?', 'u0')], 'me')).toBe('u0')
  expect(getPendingMention([post('bob', '@me?', 'u0'), post('me', 'yes', 'u1')], 'me')).toBe('')
  expect(getPendingMention([post('bob', '@me?', 'u0'), post('me', 'yes', 'u1'), post('ann', 'and @ME again', 'u2')], 'me')).toBe('u2')
  expect(getPendingMention([post('me', 'ask @me', 'u0')], 'me')).toBe('')
})

test('a longer login is not a mention of mine', async () => {
  expect(getPendingMention([post('bob', 'cc @me-team and @meow', 'u0')], 'me')).toBe('')
  expect(getPendingMention([post('bob', 'cc @d.paci', 'u0')], 'd.paci')).toBe('u0')
  expect(getPendingMention([post('bob', 'cc @dXpaci', 'u0')], 'd.paci')).toBe('')
})

test('an item there only for an answered mention drops out', async () => {
  expect(isAnsweredMention({ roles: ['mentioned'], mentionUrl: '' })).toBe(true)
  expect(isAnsweredMention({ roles: ['mentioned'], mentionUrl: 'u0' })).toBe(false)
  expect(isAnsweredMention({ roles: ['mentioned', 'author'], mentionUrl: '' })).toBe(false)
})

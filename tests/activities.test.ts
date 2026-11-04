import { expect, mock, test } from 'claude-code/testing'

import { fromForgejo, fromGithub, parseFollow, parseHttp } from '../hooks/activities'
import type { ForgejoActivity, GithubEvent } from '../hooks/activities'

const ghEvent = (id: string, type: string, payload: GithubEvent['payload'], at = '2026-11-02T10:00:00Z'): GithubEvent => ({
  id, type, actor: { login: 'ann' }, repo: { name: 'acme/app' }, created_at: at, payload,
})
const fjActivity = (id: number, op_type: string, content: string, extra: Partial<ForgejoActivity> = {}): ForgejoActivity => ({
  id, op_type, act_user: { login: 'bob' }, repo: { full_name: 'acme/lib' }, ref_name: '', content, comment: null,
  created: '2026-11-03T10:00:00Z', ...extra,
})

test('a repository is named as owner/repo or by its URL, whose host decides the forge', async () => {
  expect(parseFollow(' anaci/anaci ', 'forgejo')).toEqual({ forge: 'forgejo', repo: 'anaci/anaci' })
  expect(parseFollow('https://github.com/genropy/genropy/pulls', 'forgejo')).toEqual({ forge: 'github', repo: 'genropy/genropy' })
  expect(parseFollow('https://hub.genro.com/anaci/anaci.git', 'github')).toEqual({ forge: 'forgejo', repo: 'anaci/anaci' })
  expect(parseFollow('https://gitlab.com/a/b', 'github')).toBeUndefined()
  expect(parseFollow('anaci', 'github')).toBeUndefined()
})

test('GitHub events read as feed lines, PRs linked by number when the payload is trimmed', async () => {
  const merged = fromGithub(ghEvent('1', 'PullRequestEvent', { action: 'closed', pull_request: { number: 7, merged: true } }))
  expect(merged).toMatchObject({ id: 'github:1', actor: 'ann', verb: 'merged PR', target: '#7', url: 'https://github.com/acme/app/pull/7' })

  const push = fromGithub(ghEvent('2', 'PushEvent', { ref: 'refs/heads/develop', before: 'a'.repeat(40), head: 'b'.repeat(40) }))
  expect(push).toMatchObject({ verb: 'pushed to', target: 'develop', url: `https://github.com/acme/app/compare/${'a'.repeat(12)}...${'b'.repeat(12)}` })

  const comment = fromGithub(ghEvent('3', 'IssueCommentEvent', {
    issue: { number: 5, title: 'Broken', html_url: 'https://github.com/acme/app/pull/5', pull_request: {} },
    comment: { html_url: 'https://github.com/acme/app/pull/5#c1' },
  }))
  expect(comment).toMatchObject({ verb: 'commented on PR', target: '#5 Broken', url: 'https://github.com/acme/app/pull/5#c1' })

  expect(fromGithub(ghEvent('4', 'PullRequestReviewEvent', { pull_request: { number: 9 }, review: { state: 'approved', html_url: 'u' } })).verb)
    .toBe('approved PR')
})

test('Forgejo activities read as feed lines, in both content formats', async () => {
  expect(fromForgejo(fjActivity(1, 'merge_pull_request', '["522","Login opens the convegno window"]'))).toMatchObject({
    id: 'forgejo:1', actor: 'bob', verb: 'merged PR', target: '#522 Login opens the convegno window',
    url: 'https://hub.genro.com/acme/lib/pulls/522',
  })
  expect(fromForgejo(fjActivity(2, 'create_issue', '527|New day in the programme')).target).toBe('#527 New day in the programme')
  const comment = fromForgejo(fjActivity(3, 'comment_issue', '["325","A long comment"]', { comment: { html_url: 'https://hub.genro.com/acme/lib/issues/325#c9' } }))
  expect(comment).toMatchObject({ verb: 'commented on issue', target: '#325', url: 'https://hub.genro.com/acme/lib/issues/325#c9' })
  const push = fromForgejo(fjActivity(4, 'commit_repo', '{"Commits":[],"CompareURL":"acme/lib/compare/a...b"}', { ref_name: 'refs/heads/develop' }))
  expect(push).toMatchObject({ verb: 'pushed to', target: 'develop', url: 'https://hub.genro.com/acme/lib/compare/a...b' })
})

test('gh api -i output splits into status, headers and body', async () => {
  const answer = parseHttp('HTTP/2.0 200 OK\r\nEtag: W/"x"\r\nX-Poll-Interval: 60\r\n\r\n[1]')
  expect(answer).toEqual({ status: 200, headers: { etag: 'W/"x"', 'x-poll-interval': '60' }, body: '[1]' })
  expect(parseHttp('HTTP/2.0 304 Not Modified\nEtag: W/"x"\n').status).toBe(304)
})

test('an unchanged GitHub feed is not read again, a failing repository keeps its feed', async ($, on) => {
  const sent: (readonly string[])[] = []
  const old = fromGithub(ghEvent('1', 'IssuesEvent', { action: 'opened', issue: { number: 1, title: 'old one', html_url: 'https://github.com/acme/app/issues/1' } }, '2026-11-01T10:00:00Z'))
  const lib = fromForgejo(fjActivity(2, 'create_issue', '["2","lib one"]'))
  mock.store(on, {
    'followed-1': [{ forge: 'github', repo: 'acme/app' }, { forge: 'forgejo', repo: 'acme/lib' }],
    'activity-cache-1': {
      savedAt: 0,
      cache: { 'github:acme/app': { etag: 'W/"e"', activities: [old] }, 'forgejo:acme/lib': { etag: '', activities: [lib] } },
    },
  })
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'forge-desk' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    sent.push(e.argv)
    const stdout = e.argv.includes('-i') ? 'HTTP/2.0 304 Not Modified\n\n' : ''
    return { value: { exitCode: 1, stdout, stderr: 'offline', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('env.get', () => ({ value: '/h' }))
  on('fs.read', () => ({ value: JSON.stringify({ hosts: { 'hub.genro.com': { token: 't' } } }) }))
  on('fs.write', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: { status: 500, ok: false, headers: {}, text: '' } }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)
  const ui = await $.ui.mount({
    plugin: 'forge-desk', component: 'Pane', requestId: 'forge-desk', surface: 'desktop',
    props: { title: 'Forge desk', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  await ui.press({ key: 'page-activities' })
  const links = (await ui.findAll({ type: 'Link' })).map(link => link.text)

  expect(sent.find(argv => argv.includes('-i'))).toContain('If-None-Match: W/"e"')
  expect(links.findIndex(text => text.includes('lib one'))).toBeLessThan(links.findIndex(text => text.includes('old one')))
  expect((await ui.find({ type: 'Text', text: /acme\/lib:/ }))?.text).toBe('acme/lib: /repos/acme/lib/activities/feeds: HTTP 500')

  const before = sent.length
  await clock.advance(2 * 60 * 1000)
  expect(sent.length).toBeGreaterThan(before)
  await ui.unmount()
})

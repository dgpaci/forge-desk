import { expect, test } from 'claude-code/testing'

import { buildCheckoutMap, getOriginUrl, getRemoteKey, repoKey } from '../hooks/checkouts'

test('every remote form maps to host/owner/repo', async () => {
  expect([
    getRemoteKey('git@github.com:genropy/genropy.git'),
    getRemoteKey('git@hub.genro.com:softwell/gnrcomm.git'),
    getRemoteKey('ssh://git@hub.genro.com/anaci/anaci_mobile_app.git'),
    getRemoteKey('ssh://git@hub.genro.com:2222/softwell/demetra'),
    getRemoteKey('https://dgpaci@github.com/genropy/recipy.git'),
    getRemoteKey('https://github.com/Acme/My.Repo/'),
    getRemoteKey('/some/local/path'),
  ]).toEqual([
    'github.com/genropy/genropy',
    'hub.genro.com/softwell/gnrcomm',
    'hub.genro.com/anaci/anaci_mobile_app',
    'hub.genro.com/softwell/demetra',
    'github.com/genropy/recipy',
    'github.com/acme/my.repo',
    undefined,
  ])
  expect(repoKey('forgejo', 'Softwell/GnrComm')).toBe('hub.genro.com/softwell/gnrcomm')
})

test('the origin URL is read from its own section only', async () => {
  const config = '[core]\n\tbare = false\n[remote "upstream"]\n\turl = git@github.com:up/x.git\n[remote "origin"]\n\turl = git@github.com:me/x.git\n\tfetch = +refs/heads/*\n'
  expect(getOriginUrl(config)).toBe('git@github.com:me/x.git')
  expect(getOriginUrl('[core]\n')).toBeUndefined()
})

test('the shortest checkout wins for a repo cloned twice', async () => {
  const origin = '[remote "origin"]\n\turl = git@github.com:acme/app.git\n'
  expect(
    buildCheckoutMap([
      { gitDir: '/h/sviluppo/acme/app-copy/app/.git', config: origin },
      { gitDir: '/h/sviluppo/acme/app/.git', config: origin },
      { gitDir: '/h/sviluppo/other/.git', config: '' },
    ]),
  ).toEqual({ 'github.com/acme/app': '/h/sviluppo/acme/app' })
})

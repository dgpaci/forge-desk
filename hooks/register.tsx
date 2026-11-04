import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { ACTION_LABEL, getActions, getPromptTitle, runAction } from './actions'
import { checkRepo, fetchActivities, followKey, parseFollow } from './activities'
import type { ActivityCache } from './activities'
import { renderBoard } from './board'
import { getCheckoutMap } from './checkouts'
import { applyFilter, getActiveView, getAge, getStatusCounts, STATUS_ORDER, toggle, VIEWS } from './filter'
import type { ViewName } from './filter'
import { itemKey } from './model'
import type { Activity, Followed, Forge, Item, Page, Role, Status } from './model'
import { refresh } from './refresh'

const PANE = 'forge-desk'
const TITLE = 'Forge desk'
const MAX_ROWS = 200
const LIST_KEY = 'items-cache-2'
const REFRESH_MS = 5 * 60 * 1000
const FOLLOWED_KEY = 'followed-1'
const ACTIVITY_KEY = 'activity-cache-1'
const ACTIVITY_MS = 2 * 60 * 1000
const MAX_EVENTS = 100
// The browser board, under the home folder.
const BOARD_PATH = '.claude/forge-desk/desk.html'

// Change a tag when its value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const items = atom({ plugin: 'forge-desk', key: 'items' } as const, [], { shape: 'items-3' })
const filter = atom({ plugin: 'forge-desk', key: 'filter' } as const, VIEWS.focus, { shape: 'filter-2' })
// Whether the role, status and forge filters are shown; the views alone decide most of the time.
const showFilters = atom({ plugin: 'forge-desk', key: 'showFilters' } as const, false, { shape: 'show-filters-1' })
const meta = atom(
  { plugin: 'forge-desk', key: 'meta' } as const,
  { refreshedAt: 0, errors: [], isLoading: false },
  { shape: 'meta-1' },
)

const page = atom({ plugin: 'forge-desk', key: 'page' } as const, 'desk', { shape: 'page-1' })
const followed = atom({ plugin: 'forge-desk', key: 'followed' } as const, [], { shape: 'followed-1' })
const activities = atom({ plugin: 'forge-desk', key: 'activities' } as const, [], { shape: 'activities-1' })
const activityMeta = atom(
  { plugin: 'forge-desk', key: 'activityMeta' } as const,
  { refreshedAt: 0, errors: [], isLoading: false },
  { shape: 'activity-meta-1' },
)
const followDraft = atom({ plugin: 'forge-desk', key: 'followDraft' } as const, { forge: 'forgejo', repo: '' }, { shape: 'follow-draft-1' })

// One glyph each, so the switch fits beside Open in browser.
const PAGE_ICON: Record<Page, string> = { desk: '📋', activities: '⚡' }
const ROLE_LABEL: Record<Role, string> = { assignee: 'assigned to me', author: 'created by me', reviewer: 'review requested' }
const VIEW_LABEL: Record<ViewName, string> = { focus: 'Focus', unassigned: 'To assign', all: 'All' }
const STATUS_COLOR: Record<Status, string> = {
  ready: 'green', review: 'blue', inprogress: 'cyan', todo: 'white', waiting: 'yellow', stalled: 'red', tobeassigned: 'magenta',
}
const FORGE_LABEL: Record<Forge, string> = { github: 'GH', forgejo: 'FJ' }

// The last list fetched, kept across sessions so the pane opens full.
type SavedList = { savedAt: number; items: Item[] }
// The feeds last read, kept across sessions like the list.
type SavedActivity = { savedAt: number; cache: ActivityCache }

// The automatic refreshes; a reload of the module starts new ones.
let timer: Timer | undefined
let activityTimer: Timer | undefined

const getBoardPath = async ($: EngineInterface): Promise<string> => `${await $.env.get('HOME')}/${BOARD_PATH}`

/** Rewrites the browser board from the list as it stands. */
async function writeBoard($: EngineInterface): Promise<void> {
  const state = await read($, meta)
  const feed = await read($, activityMeta)
  const board = renderBoard({
    items: await read($, items), checkouts: await getCheckoutMap($), refreshedAt: state.refreshedAt, errors: state.errors,
    activities: await read($, activities), followed: await read($, followed), activityErrors: feed.errors,
  })
  await $.fs.write(await getBoardPath($), board)
}

/** Opens the browser board, written afresh first. */
async function openBoard($: EngineInterface): Promise<void> {
  await writeBoard($)
  const { exitCode, stderr } = await $.process.run(['open', await getBoardPath($)])
  if (exitCode !== 0) $.ui.log(`forge-desk: the board did not open: ${stderr}`)
}

/** Refreshes the list; while a refresh is already running, reports the list as it stands. */
async function reload($: EngineInterface): Promise<{ count: number; errors: string[] }> {
  if ((await read($, meta)).isLoading) {
    return { count: (await read($, items)).length, errors: ['a refresh is running: the pane updates when it ends'] }
  }
  await update($, meta, now => ({ ...now, isLoading: true }))
  try {
    const found = await refresh($)
    const kept = (await read($, items)).filter(item => found.failed.includes(item.forge))
    const list = [...found.items, ...kept]
    await update($, items, () => list)
    const refreshedAt = await $.clock.now()
    await $.store.set(LIST_KEY, { savedAt: refreshedAt, items: list } satisfies SavedList)
    await update($, meta, () => ({ refreshedAt, errors: found.errors, isLoading: false }))
    // The pane holds the list either way: a board that fails to write waits for the next refresh.
    await writeBoard($).catch(error => $.ui.log(`forge-desk: board not written: ${String(error)}`, { to: 'debug' }))

    return { count: list.length, errors: found.errors }
  } catch (error) {
    await update($, meta, now => ({ ...now, errors: [String(error)], isLoading: false }))

    return { count: 0, errors: [String(error)] }
  }
}

/** Reads the feeds of the followed repositories; a poll that finds one running skips. */
async function reloadActivities($: EngineInterface): Promise<void> {
  if ((await read($, activityMeta)).isLoading) return
  await update($, activityMeta, now => ({ ...now, isLoading: true }))
  try {
    const saved = (await $.store.get(ACTIVITY_KEY)) as SavedActivity | undefined
    const found = await fetchActivities($, await read($, followed), saved?.cache ?? {})
    const refreshedAt = await $.clock.now()
    await $.store.set(ACTIVITY_KEY, { savedAt: refreshedAt, cache: found.cache } satisfies SavedActivity)
    await update($, activities, () => found.activities)
    await update($, activityMeta, () => ({ refreshedAt, errors: found.errors, isLoading: false }))
    await writeBoard($).catch(error => $.ui.log(`forge-desk: board not written: ${String(error)}`, { to: 'debug' }))
  } catch (error) {
    await update($, activityMeta, now => ({ ...now, errors: [String(error)], isLoading: false }))
  }
}

async function saveFollowed($: EngineInterface, list: Followed[]): Promise<void> {
  await update($, followed, () => list)
  await $.store.set(FOLLOWED_KEY, list)
}

/** Follows the repository the draft names, once its forge confirms it exists. */
async function follow($: EngineInterface): Promise<void> {
  const draft = await read($, followDraft)
  const parsed = parseFollow(draft.repo, draft.forge)
  const fail = (error: string) => update($, activityMeta, now => ({ ...now, errors: [error] }))
  if (!parsed) return void (await fail(`"${draft.repo}": write owner/repo or paste the repository URL`))
  const checked = await checkRepo($, parsed)
  if (typeof checked === 'string') return void (await fail(checked))
  const list = await read($, followed)
  if (!list.some(one => followKey(one) === followKey(checked))) await saveFollowed($, [...list, checked])
  await update($, followDraft, now => ({ ...now, repo: '' }))
  await reloadActivities($)
}

async function unfollow($: EngineInterface, one: Followed): Promise<void> {
  await saveFollowed($, (await read($, followed)).filter(other => followKey(other) !== followKey(one)))
  await update($, activities, list => list.filter(event => followKey(event) !== followKey(one)))
  await writeBoard($).catch(error => $.ui.log(`forge-desk: board not written: ${String(error)}`, { to: 'debug' }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'forge-desk', description: 'Open the pane of your issues and PRs' })
    await update($, filter, () => VIEWS.focus)
    // A reload of the module mid-refresh would leave the flag set for good.
    await update($, meta, now => ({ ...now, isLoading: false }))
    const saved = (await $.store.get(LIST_KEY)) as SavedList | undefined
    if (saved && (await read($, items)).length === 0) {
      await update($, items, () => saved.items)
      await update($, meta, now => ({ ...now, refreshedAt: saved.savedAt }))
    }
    void $.ui.open({ id: PANE, title: TITLE })
    await update($, activityMeta, now => ({ ...now, isLoading: false }))
    const kept = ((await $.store.get(FOLLOWED_KEY)) ?? []) as Followed[]
    await update($, followed, () => kept)
    const feed = (await $.store.get(ACTIVITY_KEY)) as SavedActivity | undefined
    if (feed && (await read($, activities)).length === 0) {
      const keys = new Set(kept.map(followKey))
      const list = Object.entries(feed.cache).filter(([key]) => keys.has(key)).flatMap(([, one]) => one.activities)
      await update($, activities, () => list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      await update($, activityMeta, now => ({ ...now, refreshedAt: feed.savedAt }))
    }
    void reload($)
    void reloadActivities($)
    timer?.cancel()
    timer = $.clock.every(REFRESH_MS, () => void reload($))
    activityTimer?.cancel()
    activityTimer = $.clock.every(ACTIVITY_MS, () => void reloadActivities($))

    return next(e)
  })

  // The desktop app attaches after session.start: seat the pane there if it still waits.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    const pane = (await $.ui.panes()).find(open => open.id === PANE)
    if (!pane?.isPlaced) {
      const opened = await $.ui.open({ id: PANE, title: TITLE })
      if (!opened.isPlaced) $.ui.log(`forge-desk: pane not placed on ${e.surface}: ${opened.reason}`, { to: 'debug' })
    }

    return result
  })

  // A session opened by a session link takes the title its prompt carries, not one guessed from the text.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    const sessionTitle = getPromptTitle(e.prompt)

    return sessionTitle ? { ...result, sessionTitle } : result
  })

  on('command.run', { command: 'forge-desk' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    const { count, errors } = await reload($)

    return { text: [`${count} open issues and PRs.`, ...errors].join('\n') }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Link } = elements
    const current = await read($, page)
    const now = await $.clock.now()
    // The page's own controls on the left, the page switch and the board on the right.
    const header = (left: JSX.Element) => (
      <Box key="header" flexDirection="row" justifyContent="space-between" columnGap={1}>
        {left}
        <Box flexDirection="row" columnGap={1}>
          {(Object.keys(PAGE_ICON) as Page[]).map(name => (
            <Button key={`page-${name}`} variant={name === current ? 'primary' : 'secondary'} onPress={() => void update($, page, () => name)}>
              {PAGE_ICON[name]}
            </Button>
          ))}
          <Button key="browser" variant="secondary" onPress={() => void openBoard($)}>Open in browser</Button>
        </Box>
      </Box>
    )

    if (current === 'activities') {
      const list = await read($, followed)
      const feed = await read($, activities)
      const feedState = await read($, activityMeta)
      const draft = await read($, followDraft)

      return (
        <Box flexDirection="column" gap={1}>
          {header(
            <Button key="activity-refresh" variant="secondary" onPress={() => void reloadActivities($)}>
              {feedState.isLoading ? 'Refreshing…' : 'Refresh'}
            </Button>,
          )}
          {// mobile draws no Input nor Select: the followed list is edited on desktop
          }
          {'Input' in elements && 'Select' in elements && (
            <Box flexDirection="row" columnGap={1}>
              <elements.Select
                key="follow-forge"
                options={[{ value: 'forgejo', label: 'Forgejo' }, { value: 'github', label: 'GitHub' }]}
                value={draft.forge}
                onSelect={(value: string) => void update($, followDraft, now => ({ ...now, forge: value as Forge }))}
              />
              <elements.Input
                key="follow-repo"
                placeholder="owner/repo or URL"
                value={draft.repo}
                onInput={(value: string) => void update($, followDraft, now => ({ ...now, repo: value }))}
                onSubmit={(value: string) => void update($, followDraft, now => ({ ...now, repo: value })).then(() => follow($))}
              />
              <Button key="follow" variant="secondary" onPress={() => void follow($)}>Follow</Button>
            </Box>
          )}
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {list.length === 0 && <Text dimColor>No repository followed yet.</Text>}
            {list.map(one => (
              <Button key={`unfollow-${followKey(one)}`} plain onPress={() => void unfollow($, one)}>
                {`× ${FORGE_LABEL[one.forge]} ${one.repo}`}
              </Button>
            ))}
          </Box>
          {feedState.errors.map(error => (
            <Text color="red" wrap="truncate-end">{error}</Text>
          ))}
          <Text dimColor>
            {`${feed.length} events` + (feedState.refreshedAt ? ` · updated ${getAge(new Date(feedState.refreshedAt).toISOString(), now)} ago` : '')}
          </Text>
          <Box flexDirection="column" gap={1}>
            {feed.slice(0, MAX_EVENTS).map((event: Activity) => (
              <Box key={event.id} flexDirection="column">
                <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                  <Text bold>{event.actor}</Text>
                  <Text>{event.verb}</Text>
                  <Link href={event.url}>{event.target || event.repo}</Link>
                </Box>
                <Text dimColor wrap="truncate-end">{`${FORGE_LABEL[event.forge]} ${event.repo} · ${getAge(event.createdAt, now)}`}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )
    }

    const all = await read($, items)
    const chosen = await read($, filter)
    const state = await read($, meta)
    const shown = applyFilter(all, chosen)
    const counts = getStatusCounts(all, chosen)
    const active = getActiveView(chosen)
    const isOpen = await read($, showFilters)
    // A filter that is no view stays visible as a hint while the rows are folded.
    const filtersLabel = `${isOpen ? '▾' : '▸'} Filters${!isOpen && !active ? ' · custom' : ''}`
    const setFilter = (change: Partial<typeof chosen>) => void update($, filter, now => ({ ...now, ...change }))

    return (
      <Box flexDirection="column" gap={1}>
        {header(
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {(Object.keys(VIEWS) as ViewName[]).map(view => (
            <Button
              key={`view-${view}`}
              variant={view === active ? 'primary' : 'secondary'}
              onPress={() => setFilter(VIEWS[view])}
            >
              {VIEW_LABEL[view]}
            </Button>
          ))}
          <Button key="refresh" variant="secondary" onPress={() => void reload($)}>
            {state.isLoading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </Box>,
        )}
        <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
          <Button key="filters" plain onPress={() => void update($, showFilters, now => !now)}>{filtersLabel}</Button>
          {// mobile draws no Input: the text filter stays out there
          }
          {'Input' in elements && (
          <elements.Input
            key="text"
            placeholder="Filter by repo or title"
            value={chosen.text}
            onInput={(value: string) => setFilter({ text: value })}
            onSubmit={(value: string) => setFilter({ text: value })}
          />
          )}
        </Box>
        {isOpen && (
        <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {(Object.keys(ROLE_LABEL) as Role[]).map(role => (
            <Button
              key={`role-${role}`}
              variant={chosen.roles.includes(role) ? 'primary' : 'secondary'}
              onPress={() => setFilter({ roles: toggle(chosen.roles, role) })}
            >
              {ROLE_LABEL[role]}
            </Button>
          ))}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {STATUS_ORDER.map(status => (
            <Button
              key={`status-${status}`}
              variant={chosen.statuses.includes(status) ? 'primary' : 'secondary'}
              onPress={() => setFilter({ statuses: toggle(chosen.statuses, status) })}
            >
              {`${status} ${counts[status]}`}
            </Button>
          ))}
        </Box>
        {// mobile draws no Select: the forge filter stays out there
        }
        {'Select' in elements && (
          <elements.Select
            key="forge"
            options={[
              { value: 'all', label: 'All forges' },
              { value: 'github', label: 'GitHub' },
              { value: 'forgejo', label: 'Forgejo' },
            ]}
            value={chosen.forges.length === 1 ? chosen.forges[0] : 'all'}
            onSelect={(value: string) => setFilter({ forges: value === 'all' ? [] : [value as Forge] })}
          />
        )}
        </Box>
        )}
        {state.errors.map(error => (
          <Text color="red" wrap="truncate-end">{error}</Text>
        ))}
        <Text dimColor>
          {state.isLoading && all.length === 0
            ? 'Loading…'
            : `${shown.length} of ${all.length}` + (state.refreshedAt ? ` · updated ${getAge(new Date(state.refreshedAt).toISOString(), now)} ago` : '')}
        </Text>
        <Box flexDirection="column" gap={1}>
          {shown.slice(0, MAX_ROWS).map(item => (
            <Box key={itemKey(item)} flexDirection="column">
              <Box flexDirection="row" columnGap={1}>
                <Text color={STATUS_COLOR[item.status]} bold={item.status === 'ready'} mono>{item.status.padEnd(12)}</Text>
                <Link href={item.url}>{item.title}</Link>
              </Box>
              <Text dimColor wrap="truncate-end">
                {`${FORGE_LABEL[item.forge]} ${item.repo}#${item.number} · ${item.kind} · ${getAge(item.updatedAt, now)} · ${item.assignees.join(', ') || 'unassigned'}`}
              </Text>
              <Box flexDirection="row" columnGap={2}>
                {getActions(item).map(action => (
                  <Button key={`${action}:${itemKey(item)}`} plain onPress={() => void runAction($, action, item)}>
                    {ACTION_LABEL[action]}
                  </Button>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { ACTION_LABEL, getActions, getPromptTitle, runAction } from './actions'
import { renderBoard } from './board'
import { getCheckoutMap } from './checkouts'
import { applyFilter, getActiveView, getAge, getStatusCounts, STATUS_ORDER, toggle, VIEWS } from './filter'
import type { ViewName } from './filter'
import { itemKey } from './model'
import type { Forge, Item, Role, Status } from './model'
import { refresh } from './refresh'

const PANE = 'forge-desk'
const TITLE = 'Forge desk'
const MAX_ROWS = 200
const LIST_KEY = 'items-cache-1'
const REFRESH_MS = 5 * 60 * 1000
// The browser board, under the home folder.
const BOARD_PATH = '.claude/forge-desk/desk.html'

// Change a tag when its value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const items = atom({ plugin: 'forge-desk', key: 'items' } as const, [], { shape: 'items-2' })
const filter = atom({ plugin: 'forge-desk', key: 'filter' } as const, VIEWS.focus, { shape: 'filter-1' })
// Whether the role, status and forge filters are shown; the views alone decide most of the time.
const showFilters = atom({ plugin: 'forge-desk', key: 'showFilters' } as const, false, { shape: 'show-filters-1' })
const meta = atom(
  { plugin: 'forge-desk', key: 'meta' } as const,
  { refreshedAt: 0, errors: [], isLoading: false },
  { shape: 'meta-1' },
)

const ROLE_LABEL: Record<Role, string> = { assignee: 'assigned to me', author: 'created by me', reviewer: 'review requested' }
const VIEW_LABEL: Record<ViewName, string> = { focus: 'Focus', unassigned: 'To assign', all: 'All' }
const STATUS_COLOR: Record<Status, string> = {
  blocked: 'red', waiting: 'yellow', inprogress: 'cyan', todo: 'white', tobeassigned: 'magenta',
}
const FORGE_LABEL: Record<Forge, string> = { github: 'GH', forgejo: 'FJ' }

// The last list fetched, kept across sessions so the pane opens full.
type SavedList = { savedAt: number; items: Item[] }

// The automatic refresh; a reload of the module starts a new one.
let timer: Timer | undefined

const getBoardPath = async ($: EngineInterface): Promise<string> => `${await $.env.get('HOME')}/${BOARD_PATH}`

/** Rewrites the browser board from the list as it stands. */
async function writeBoard($: EngineInterface): Promise<void> {
  const state = await read($, meta)
  const board = renderBoard({
    items: await read($, items), checkouts: await getCheckoutMap($), refreshedAt: state.refreshedAt, errors: state.errors,
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
    void reload($)
    timer?.cancel()
    timer = $.clock.every(REFRESH_MS, () => void reload($))

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
    const all = await read($, items)
    const chosen = await read($, filter)
    const state = await read($, meta)
    const now = await $.clock.now()
    const shown = applyFilter(all, chosen)
    const counts = getStatusCounts(all, chosen)
    const active = getActiveView(chosen)
    const isOpen = await read($, showFilters)
    // A filter that is no view stays visible as a hint while the rows are folded.
    const filtersLabel = `${isOpen ? '▾' : '▸'} Filters${!isOpen && !active ? ' · custom' : ''}`
    const setFilter = (change: Partial<typeof chosen>) => void update($, filter, now => ({ ...now, ...change }))

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
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
        </Box>
        <Button key="browser" variant="secondary" onPress={() => void openBoard($)}>Open in browser</Button>
        </Box>
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
                <Text color={STATUS_COLOR[item.status]} mono>{item.status.padEnd(12)}</Text>
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

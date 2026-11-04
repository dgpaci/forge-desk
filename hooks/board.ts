import { ACTION_LABEL, getActions, getSessionLink } from './actions'
import type { CheckoutMap } from './checkouts'
import { repoKey } from './checkouts'
import { getAge, STATUS_ORDER, VIEWS } from './filter'
import { itemKey } from './model'
import type { Activity, Followed, Item } from './model'

// The page reloads itself to pick up the file the next refresh writes.
const RELOAD_MS = 60 * 1000

export type BoardInput = {
  items: Item[]
  checkouts: CheckoutMap
  refreshedAt: number
  errors: string[]
  activities: Activity[]
  followed: Followed[]
  activityErrors: string[]
}

// One row as the page draws it: ages and links worked out here, so the page only filters.
type Row = Item & { key: string; age: string; actions: { label: string; href: string }[] }

/** The rows of the page, each with its Desktop links. */
export function getRows({ items, checkouts, refreshedAt }: BoardInput): Row[] {
  return items.map(item => {
    const checkout = checkouts[repoKey(item.forge, item.repo)]

    return {
      ...item,
      key: itemKey(item),
      age: getAge(item.updatedAt, refreshedAt),
      actions: getActions(item).map(action => ({ label: ACTION_LABEL[action], href: getSessionLink(action, item, checkout) })),
    }
  })
}

// JSON inside a <script> element: nothing in it may close the element.
const embed = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c')

/** The whole board as one self-contained HTML page: the same grid, views and filters as the pane. */
export function renderBoard(input: BoardInput): string {
  const data = {
    rows: getRows(input),
    views: VIEWS,
    statuses: STATUS_ORDER,
    refreshedAt: new Date(input.refreshedAt).toISOString(),
    errors: input.errors,
    reloadMs: RELOAD_MS,
    activities: input.activities.map(event => ({ ...event, age: getAge(event.createdAt, input.refreshedAt) })),
    followed: input.followed,
    activityErrors: input.activityErrors,
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forge desk</title>
<style>${STYLE}</style>
</head>
<body>
<div class="top">
  <div class="bar" id="views"></div>
  <nav class="bar" id="pages"></nav>
</div>
<section id="desk">
<header>
  <div class="bar">
    <button class="plain" id="toggle"></button>
    <input id="text" type="search" placeholder="Filter by repo or title">
  </div>
  <div id="more">
    <div class="bar" id="roles"></div>
    <div class="bar" id="statuses"></div>
    <div class="bar">
      <select id="forge"><option value="all">All forges</option><option value="github">GitHub</option><option value="forgejo">Forgejo</option></select>
    </div>
  </div>
  <div id="errors"></div>
  <p class="dim" id="summary"></p>
</header>
<table>
  <thead><tr><th>Status</th><th>Forge</th><th>Repo</th><th>Title</th><th>Updated</th><th>Assignee</th><th></th></tr></thead>
  <tbody id="rows"></tbody>
</table>
</section>
<section id="activities">
  <p class="dim" id="followed"></p>
  <div id="activity-errors"></div>
  <table>
    <thead><tr><th>When</th><th>Forge</th><th>Repo</th><th>Who</th><th>What</th></tr></thead>
    <tbody id="events"></tbody>
  </table>
</section>
<script type="application/json" id="data">${embed(data)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`
}

const STYLE = `
:root { --bg: #ffffff; --fg: #1f2328; --dim: #656d76; --line: #d0d7de; --chip: #f6f8fa; --on: #0969da; --on-fg: #ffffff;
  --ready: #1a7f37; --review: #bc4c00; --mentioned: #bf3989; --inprogress: #0969da; --todo: #1f2328; --waiting: #9a6700; --stalled: #cf222e;
  --tobeassigned: #8250df; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0d1117; --fg: #e6edf3; --dim: #8d96a0;
  --line: #30363d; --chip: #161b22; --on: #2f81f7; --on-fg: #ffffff; --ready: #3fb950; --review: #f0883e; --mentioned: #db61a2;
  --inprogress: #58a6ff; --todo: #e6edf3; --waiting: #d29922; --stalled: #f85149; --tobeassigned: #bc8cff; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.45 -apple-system, system-ui, sans-serif; }
/* The page switch at the top right, beside the desk's views. */
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
nav { margin-left: auto; }
.bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
button { border: 1px solid var(--line); background: var(--chip); color: var(--fg); border-radius: 999px; padding: 3px 10px; font: inherit; cursor: pointer; }
button.on { background: var(--on); border-color: var(--on); color: var(--on-fg); }
button.plain { border: 0; background: none; color: var(--dim); padding: 3px 4px; }
select, input { border: 1px solid var(--line); background: var(--bg); color: var(--fg); border-radius: 6px; padding: 4px 8px; font: inherit; }
input { flex: 1; min-width: 160px; }
.dim { color: var(--dim); }
#errors div, #activity-errors div { color: var(--stalled); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--dim); font-weight: 500; }
td.status { font-family: ui-monospace, monospace; white-space: nowrap; }
td.ready { font-weight: 700; }
a { color: var(--on); text-decoration: none; }
a:hover { text-decoration: underline; }
td.actions a { margin-right: 10px; white-space: nowrap; }
@media (max-width: 720px) { thead { display: none; } tr { display: block; border-bottom: 1px solid var(--line); padding: 6px 0; }
  td { display: inline-block; border: 0; padding: 2px 6px; } }
`

// The pane's filters, applied in the page; the filter lives in the URL hash so a reload keeps it.
const SCRIPT = `
const data = JSON.parse(document.getElementById('data').textContent)
const ROLE_LABEL = { assignee: 'assigned to me', author: 'created by me', reviewer: 'review requested', mentioned: 'mentions me' }
const VIEW_LABEL = { focus: 'Focus', unassigned: 'To assign', all: 'All' }
const FORGE_LABEL = { github: 'GH', forgejo: 'FJ' }
let filter = data.views.focus
try { if (location.hash) filter = JSON.parse(decodeURIComponent(location.hash.slice(1))) } catch {}
// Whether the role, status and forge filters are shown: a convenience of this browser alone.
let isOpen = false
try { isOpen = localStorage.getItem('forge-desk.showFilters') === '1' } catch {}
const PAGE_ICON = { desk: '📋', activities: '⚡' }
const PAGE_LABEL = { desk: 'Forge desk', activities: 'Activities' }
let page = 'desk'
try { page = localStorage.getItem('forge-desk.page') === 'activities' ? 'activities' : 'desk' } catch {}

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}
const allows = (chosen, value) => chosen.length === 0 || chosen.includes(value)
const toggle = (list, value) => list.includes(value) ? list.filter(one => one !== value) : [...list, value]
const sameSet = (a, b) => a.length === b.length && a.every(one => b.includes(one))
const matchesExceptStatus = row => {
  const text = filter.text.trim().toLowerCase()
  return (filter.roles.length === 0 || row.roles.some(role => filter.roles.includes(role))) &&
    allows(filter.forges, row.forge) &&
    (!text || (row.repo + '#' + row.number + ' ' + row.title).toLowerCase().includes(text))
}
const set = change => { filter = { ...filter, ...change }; history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(filter))); draw() }
const chip = (label, isOn, onclick) => el('button', { className: isOn ? 'on' : '', onclick, textContent: label })

function drawActivities() {
  document.getElementById('followed').textContent = data.followed.length
    ? 'Following ' + data.followed.map(one => FORGE_LABEL[one.forge] + ' ' + one.repo).join(', ')
    : 'No repository followed yet: add one from the Activities page of the pane.'
  document.getElementById('activity-errors').replaceChildren(...data.activityErrors.map(error => el('div', { textContent: error })))
  document.getElementById('events').replaceChildren(...data.activities.map(event => el('tr', {},
    el('td', { className: 'dim', textContent: event.age }),
    el('td', { textContent: FORGE_LABEL[event.forge] }),
    el('td', { textContent: event.repo }),
    el('td', { textContent: event.actor }),
    el('td', {}, el('span', { textContent: event.verb + ' ' }), el('a', { href: event.url, target: '_blank', rel: 'noopener', textContent: event.target || event.repo })),
  )))
}

function drawPages() {
  document.getElementById('pages').replaceChildren(...Object.keys(PAGE_ICON).map(name => {
    const button = chip(PAGE_ICON[name], name === page, () => {
      page = name
      try { localStorage.setItem('forge-desk.page', name) } catch {}
      drawPages()
    })
    button.title = PAGE_LABEL[name]
    button.setAttribute('aria-label', PAGE_LABEL[name])
    return button
  }))
  document.getElementById('desk').hidden = page !== 'desk'
  document.getElementById('views').hidden = page !== 'desk'
  document.getElementById('activities').hidden = page !== 'activities'
}

function draw() {
  const active = Object.keys(data.views).find(name => { const v = data.views[name]
    return sameSet(v.roles, filter.roles) && sameSet(v.statuses, filter.statuses) && sameSet(v.forges, filter.forges) && v.text === filter.text.trim() })
  document.getElementById('views').replaceChildren(...Object.keys(data.views).map(name =>
    chip(VIEW_LABEL[name], name === active, () => set(data.views[name]))))
  document.getElementById('roles').replaceChildren(...Object.keys(ROLE_LABEL).map(role =>
    chip(ROLE_LABEL[role], filter.roles.includes(role), () => set({ roles: toggle(filter.roles, role) }))))
  const counts = Object.fromEntries(data.statuses.map(status => [status, 0]))
  for (const row of data.rows) if (matchesExceptStatus(row)) counts[row.status]++
  document.getElementById('statuses').replaceChildren(...data.statuses.map(status =>
    chip(status + ' ' + counts[status], filter.statuses.includes(status), () => set({ statuses: toggle(filter.statuses, status) }))))
  document.getElementById('more').hidden = !isOpen
  document.getElementById('toggle').textContent = (isOpen ? '▾' : '▸') + ' Filters' + (!isOpen && !active ? ' · custom' : '')
  document.getElementById('forge').value = filter.forges.length === 1 ? filter.forges[0] : 'all'
  const text = document.getElementById('text'); if (document.activeElement !== text) text.value = filter.text
  document.getElementById('errors').replaceChildren(...data.errors.map(error => el('div', { textContent: error })))
  const shown = data.rows.filter(row => matchesExceptStatus(row) && allows(filter.statuses, row.status))
    .sort((a, b) => data.statuses.indexOf(a.status) - data.statuses.indexOf(b.status) || b.updatedAt.localeCompare(a.updatedAt))
  document.getElementById('summary').textContent = shown.length + ' of ' + data.rows.length + ' · updated ' + new Date(data.refreshedAt).toLocaleString()
  document.getElementById('rows').replaceChildren(...shown.map(row => el('tr', {},
    el('td', { className: 'status ' + row.status, style: 'color: var(--' + row.status + ')', textContent: row.status }),
    el('td', { textContent: FORGE_LABEL[row.forge] }),
    el('td', { textContent: row.repo + '#' + row.number }),
    el('td', {}, el('a', { href: row.url, target: '_blank', rel: 'noopener', textContent: row.title }), el('span', { className: 'dim', textContent: ' · ' + row.kind })),
    el('td', { className: 'dim', textContent: row.age }),
    el('td', { textContent: row.assignees.join(', ') || 'unassigned' }),
    el('td', { className: 'actions' }, ...row.actions.map(action => el('a', { href: action.href, textContent: action.label }))),
  )))
}

document.getElementById('toggle').onclick = () => {
  isOpen = !isOpen
  try { localStorage.setItem('forge-desk.showFilters', isOpen ? '1' : '0') } catch {}
  draw()
}
document.getElementById('forge').onchange = event => set({ forges: event.target.value === 'all' ? [] : [event.target.value] })
document.getElementById('text').oninput = event => set({ text: event.target.value })
drawPages()
drawActivities()
draw()
// No reload while the text filter is being typed.
setInterval(() => { if (document.activeElement?.id !== 'text') location.reload() }, data.reloadMs)
`

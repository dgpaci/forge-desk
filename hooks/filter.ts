import type { Filter, Item, Status } from './model'

export const STATUS_ORDER: Status[] = ['blocked', 'waiting', 'inprogress', 'todo', 'tobeassigned']

export type ViewName = 'focus' | 'unassigned' | 'all'

// Ready-made filters, one click each in the pane.
export const VIEWS: Record<ViewName, Filter> = {
  focus: { roles: ['assignee', 'reviewer'], statuses: ['blocked', 'waiting', 'inprogress', 'todo'], forges: [], text: '' },
  unassigned: { roles: ['author'], statuses: ['tobeassigned'], forges: [], text: '' },
  all: { roles: [], statuses: [], forges: [], text: '' },
}

const allows = <T>(chosen: T[], value: T): boolean => chosen.length === 0 || chosen.includes(value)

/** Every restriction of `filter` except the statuses, so counts show what a status click would add. */
export function matchesExceptStatus(item: Item, filter: Filter): boolean {
  const text = filter.text.trim().toLowerCase()

  return (
    (filter.roles.length === 0 || item.roles.some(role => filter.roles.includes(role))) &&
    allows(filter.forges, item.forge) &&
    (!text || `${item.repo}#${item.number} ${item.title}`.toLowerCase().includes(text))
  )
}

/** The items `filter` keeps, most urgent status first, then newest. */
export function applyFilter(items: Item[], filter: Filter): Item[] {
  return items
    .filter(item => matchesExceptStatus(item, filter) && allows(filter.statuses, item.status))
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.updatedAt.localeCompare(a.updatedAt),
    )
}

/** How many items each status would show under the rest of `filter`. */
export function getStatusCounts(items: Item[], filter: Filter): Record<Status, number> {
  const counts = Object.fromEntries(STATUS_ORDER.map(status => [status, 0])) as Record<Status, number>
  for (const item of items) if (matchesExceptStatus(item, filter)) counts[item.status]++

  return counts
}

/** Adds `value` to `list` when missing, removes it when present. */
export const toggle = <T>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter(one => one !== value) : [...list, value]

/** Compact age of an ISO date at `now`: 12m, 5h, 3d. */
export function getAge(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`

  return `${Math.round(minutes / 1440)}d`
}

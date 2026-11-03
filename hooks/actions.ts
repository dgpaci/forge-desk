import type { EngineInterface } from 'claude-code'

import { findCheckout } from './checkouts'
import type { Item } from './model'

export type Action = 'solve' | 'review' | 'work' | 'update' | 'nudge'

export const ACTION_LABEL: Record<Action, string> = {
  solve: 'Solve',
  review: 'Review',
  work: 'Work on it',
  update: 'Get an update',
  nudge: 'Nudge',
}

type SessionAction = 'solve' | 'review' | 'work'

const isSessionAction = (action: Action): action is SessionAction =>
  action === 'solve' || action === 'review' || action === 'work'

// What the child session started in the local checkout is asked to do.
const SESSION_TASK: Record<SessionAction, (item: Item) => string> = {
  solve: item =>
    `resolve issue ${item.url}, beginning with the assignment check of my workflow rules`,
  review: item =>
    `review PR ${item.url} and report the findings to me (on GitHub with the code-review skill on the PR ` +
    'number, on Forgejo from the diff the API returns); post no review comment without my explicit OK in chat',
  work: item =>
    `carry PR ${item.url} forward: read the review comments and CI state, then address them`,
}

const FORGE_TOOLS = 'Use gh for github.com and the Forgejo API with the fj token for hub.genro.com.'

/** The actions a row offers: Solve on issues, Review on others' PRs, Work on it on mine. */
export function getActions(item: Item): Action[] {
  const main: Action = item.kind === 'issue' ? 'solve' : item.roles.includes('author') ? 'work' : 'review'

  return [main, 'update', 'nudge']
}

// Opens the line describing the click; on a session link's second line, it marks the first as the title.
const MARKER = '[forge-desk]'

const TITLE_VERB: Record<Action, string> = { solve: 'Work on', work: 'Work on', review: 'Review', update: 'Update', nudge: 'Nudge' }

/** The name of the session `action` opens on `item`, the repo without its owner: `Review PR app#12`. */
export function getSessionTitle(action: Action, item: Item): string {
  return `${TITLE_VERB[action]} ${item.kind === 'pr' ? 'PR' : 'issue'} ${item.repo.split('/').pop()}#${item.number}`
}

/** The title a session link's prompt carries on its first line; undefined for any other prompt. */
export function getPromptTitle(prompt: string): string | undefined {
  const [first, second] = prompt.split('\n', 2)

  return second?.startsWith(MARKER) ? first : undefined
}

const describe = (item: Item, action: Action): string =>
  `${MARKER} I clicked "${ACTION_LABEL[action]}" on ${item.kind} ${item.repo}#${item.number} ` +
  `"${item.title}" (${item.url}), status ${item.status}, assignees: ${item.assignees.join(', ') || 'none'}.`

/** What `action` asks of Claude, past the line describing the click. */
function getTask(action: Action, item: Item): string {
  if (isSessionAction(action)) return `Task: ${SESSION_TASK[action](item)}. ${FORGE_TOOLS}`
  if (action === 'update') {
    return (
      'Summarize where it stands in a few lines: latest activity and comments, linked PRs and commits, ' +
      `review and CI state, who it is waiting on. Read only: post, assign or change nothing. ${FORGE_TOOLS}`
    )
  }
  const target = item.kind === 'pr' && item.requestedReviewers.length > 0 ? 'the requested reviewers' : 'whoever it is waiting on'

  return (
    `Draft a short, polite comment asking ${target} for news, in the project's language. ` +
    `Show me the draft and post it only after my explicit OK in chat; otherwise post nothing. ${FORGE_TOOLS}`
  )
}

const NO_CHECKOUT = (item: Item): string =>
  `No local checkout of ${item.repo} was found under ~/sviluppo. Tell me, and ask whether and where to clone it.`

/** The request a click sends to Claude in this session; `checkout` is the local clone for the session actions. */
export function buildPrompt(action: Action, item: Item, checkout?: string): string {
  const head = describe(item, action)
  if (!isSessionAction(action)) return `${head}\n${getTask(action, item)}`
  if (!checkout) return `${head}\n${NO_CHECKOUT(item)}`

  return (
    `${head}\nThis click is my go-ahead: start a child session in ${checkout} ` +
    `(start_session, initiation "user_asked", cwd "${checkout}", context "fresh", ` +
    `title "${getSessionTitle(action, item)}") whose brief is to ` +
    `${SESSION_TASK[action](item)}. Do not do the work in this session.`
  )
}

const DEEP_LINK = 'claude://code/new'

/**
 * The Claude Desktop link that opens a new session on `action`: in `checkout` when there is one,
 * Desktop asking first to adopt the folder. The prompt's first line is the session's title.
 */
export function getSessionLink(action: Action, item: Item, checkout?: string): string {
  const where = checkout
    ? `You run in the local checkout of ${item.repo}: follow its CLAUDE.md. Before creating a branch, ask me ` +
      'whether I want a worktree or a plain branch.'
    : NO_CHECKOUT(item)
  const q = `${getSessionTitle(action, item)}\n${describe(item, action)}\n${where}\n${getTask(action, item)}`
  const params = new URLSearchParams({ q })
  if (checkout) params.set('folder', checkout)

  return `${DEEP_LINK}?${params.toString().replaceAll('+', '%20')}`
}

/**
 * Runs `action` on `item`: a session action opens a new Desktop session in the local checkout,
 * the others are a request to Claude here, as a turn of its own once the session is idle.
 */
export async function runAction($: EngineInterface, action: Action, item: Item): Promise<void> {
  if (!isSessionAction(action)) {
    await $.prompt.submit({ text: buildPrompt(action, item) })
    return
  }
  const checkout = await findCheckout($, item.forge, item.repo)
  if (checkout) {
    const { exitCode, stderr } = await $.process.run(['open', getSessionLink(action, item, checkout)])
    if (exitCode === 0) return
    $.ui.log(`forge-desk: the Claude Desktop link did not open: ${stderr}`)
  }
  // No checkout, or no Desktop app to take the link: Claude here takes it from the request.
  await $.prompt.submit({ text: buildPrompt(action, item, checkout) })
}

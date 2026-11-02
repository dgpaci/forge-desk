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

// The Desktop app's MCP server that starts sessions.
const SESSION_SERVER = 'ccd_session'

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

const describe = (item: Item, action: Action): string =>
  `[forge-desk] I clicked "${ACTION_LABEL[action]}" on ${item.kind} ${item.repo}#${item.number} ` +
  `"${item.title}" (${item.url}), status ${item.status}, assignees: ${item.assignees.join(', ') || 'none'}.`

/** The request a click sends to Claude; `checkout` is the local clone for the session actions. */
export function buildPrompt(action: Action, item: Item, checkout?: string): string {
  const head = describe(item, action)
  if (isSessionAction(action)) {
    if (!checkout) {
      return `${head}\nNo local checkout of ${item.repo} was found under ~/sviluppo. Tell me, and ask whether and where to clone it.`
    }
    return (
      `${head}\nThis click is my go-ahead: start a child session in ${checkout} ` +
      `(start_session, initiation "user_asked", cwd "${checkout}", context "fresh") whose brief is to ` +
      `${SESSION_TASK[action](item)}. Do not do the work in this session.`
    )
  }
  if (action === 'update') {
    return (
      `${head}\nSummarize where it stands in a few lines: latest activity and comments, linked PRs and commits, ` +
      `review and CI state, who it is waiting on. Read only: post, assign or change nothing. ${FORGE_TOOLS}`
    )
  }
  const target = item.kind === 'pr' && item.status !== 'blocked' ? 'the requested reviewers' : 'whoever it is waiting on'

  return (
    `${head}\nDraft a short, polite comment asking ${target} for news, in the project's language. ` +
    `Show me the draft and post it only after my explicit OK in chat; otherwise post nothing. ${FORGE_TOOLS}`
  )
}

/** The arguments of the Desktop app's start_session for a session action, run in `checkout`. */
export function getSessionArgs(action: SessionAction, item: Item, checkout: string): Record<string, unknown> {
  return {
    initiation: 'user_asked',
    context: 'fresh',
    cwd: checkout,
    use_worktree: false,
    title: `${ACTION_LABEL[action]} ${item.repo}#${item.number}`.slice(0, 59),
    prompt: `${describe(item, action)}\nTask: ${SESSION_TASK[action](item)}.`,
    background:
      `Started from the forge-desk pane, a grid of my open issues and PRs, by a click on ${ACTION_LABEL[action]}. ` +
      `You run in the local checkout of ${item.repo}: follow its CLAUDE.md. Before creating a branch, ask me whether ` +
      `I want a worktree or a plain branch. ${FORGE_TOOLS}`,
  }
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
    try {
      const result = await $.mcp.call(SESSION_SERVER, 'start_session', getSessionArgs(action, item, checkout))
      if (!result.isError) return
      $.ui.log(`forge-desk: start_session refused: ${JSON.stringify(result.content)}`)
    } catch (error) {
      $.ui.log(`forge-desk: start_session failed: ${String(error)}`)
    }
  }
  // No checkout, or no Desktop app to start the session: Claude here takes it from the request.
  await $.prompt.submit({ text: buildPrompt(action, item, checkout) })
}

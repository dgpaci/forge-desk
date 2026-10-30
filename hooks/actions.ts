import type { EngineInterface } from 'claude-code'

import { findCheckout } from './checkouts'
import type { Item } from './model'

export type Action = 'work' | 'update' | 'nudge'

export const ACTION_LABEL: Record<Action, string> = { work: 'Work on it', update: 'Get an update', nudge: 'Nudge' }

const FORGE_TOOLS = 'Use gh for github.com and the Forgejo API with the fj token for hub.genro.com.'

const describe = (item: Item, action: Action): string =>
  `[forge-desk] I clicked "${ACTION_LABEL[action]}" on ${item.kind} ${item.repo}#${item.number} ` +
  `"${item.title}" (${item.url}), status ${item.status}, assignees: ${item.assignees.join(', ') || 'none'}.`

/** The request a click sends to Claude; `checkout` is the local clone for `work`. */
export function buildPrompt(action: Action, item: Item, checkout?: string): string {
  const head = describe(item, action)
  if (action === 'work') {
    if (!checkout) {
      return `${head}\nNo local checkout of ${item.repo} was found under ~/sviluppo. Tell me, and ask whether and where to clone it.`
    }
    return (
      `${head}\nThis click is my go-ahead: start a child session in ${checkout} ` +
      `(start_session, initiation "user_asked", cwd "${checkout}", context "fresh"). ` +
      `Its brief names the ${item.kind} and its URL, and says to begin with the assignment check of my workflow rules. ` +
      'Do not do the work in this session.'
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

/** Sends the request for `action` on `item` to Claude, as a turn of its own once the session is idle. */
export async function runAction($: EngineInterface, action: Action, item: Item): Promise<void> {
  const checkout = action === 'work' ? await findCheckout($, item.forge, item.repo) : undefined
  await $.prompt.submit({ text: buildPrompt(action, item, checkout) })
}

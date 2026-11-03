# forge-desk

A side pane for the Claude Desktop Code tab that lists, in one grid, your open issues and pull
requests across **GitHub** and **Forgejo** (`hub.genro.com`).

Columns: forge, repo, title, last update, assignee, status.

Statuses say whose move it is, most urgent first:

| Status | Meaning |
|---|---|
| `ready` | your PR is approved, CI green, no conflicts: merge it |
| `review` | someone else's PR, review requested from you |
| `inprogress` | your move: draft PR, changes requested, PR with no reviewer asked, approved PR with red CI or conflicts; issue with a commit or a linked PR. Idle work of yours stays here |
| `todo` | issue assigned to you, no commit and no linked PR |
| `waiting` | others' move: PR with a review pending from someone else, item assigned to someone else |
| `stalled` | waiting with no update for 7+ days: nudge it |
| `tobeassigned` | issue you created, nobody assigned |

A pending review request wins over an earlier "changes requested": it is the re-request after the
fixes. CI counts as green when the head commit has no checks at all.

Actions per row, each a request to Claude:
- **Solve** on issues, **Review** on other people's PRs, **Work on it** on your own PRs: a new
  Claude Desktop session in the local checkout (found by scanning git remotes under `~/sviluppo`),
  opened through the `claude://code/new` link; Review posts nothing without your OK;
- **Get an update**: a read-only summary;
- **Nudge**: drafts a comment, posts only after your OK.

**Open in browser**, at the top of the pane, opens the same board as a local page,
`~/.claude/forge-desk/desk.html`, rewritten on every refresh. There every action, Get an update and
Nudge included, opens a new Desktop session. The page holds no token.

Status: under development.

## Development

The repository root is the plugin. Data layer: `hooks/github.ts` (one `gh api graphql` call, one
search per clause), `hooks/forgejo.ts` (REST, one search per clause, one cached timeline call
per issue, and per PR its detail, reviews and head-commit status), `hooks/status.ts` (whose move it is). Pane: `hooks/register.tsx`, filters and views in
`hooks/filter.ts` (Focus, the default: assigned to me and review requests, without `tobeassigned`).

To load it in every session, name the repository in the `env` block of `~/.claude/settings.json`:
`"CLAUDE_CODE_PLUGIN_DIRS": "<path to this repo>"`. `/forge-desk` opens the pane.

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

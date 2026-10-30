# forge-desk

A side pane for the Claude Desktop Code tab that lists, in one grid, your open issues and pull
requests across **GitHub** and **Forgejo** (`hub.genro.com`).

Columns: forge, repo, title, last update, assignee, status.

Statuses:

| Status | Meaning |
|---|---|
| `todo` | issue assigned to you, no commit and no linked PR |
| `tobeassigned` | issue you created, nobody assigned |
| `inprogress` | assigned, at least one commit references it |
| `waiting` | PR awaiting review |
| `blocked` | waiting, or assigned to someone else, with no update for 7+ days |

Actions per row, each a request to Claude:
- **Solve** on issues, **Review** on other people's PRs, **Work on it** on your own PRs: a child
  session in the local checkout (found by scanning git remotes under `~/sviluppo`); Review posts
  nothing without your OK;
- **Get an update**: a read-only summary;
- **Nudge**: drafts a comment, posts only after your OK.

Status: under development.

## Development

The repository root is the plugin. Data layer: `hooks/github.ts` (one `gh api graphql` call, one
search per clause), `hooks/forgejo.ts` (REST, one search per clause plus one cached timeline call
per issue), `hooks/status.ts` (status precedence). Pane: `hooks/register.tsx`, filters and views in
`hooks/filter.ts` (Focus, the default: assigned to me and review requests, without `tobeassigned`).

To load it in every session, name the repository in the `env` block of `~/.claude/settings.json`:
`"CLAUDE_CODE_PLUGIN_DIRS": "<path to this repo>"`. `/forge-desk` opens the pane.

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

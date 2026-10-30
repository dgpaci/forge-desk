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

Actions per row: **work on it** (starts a session in the local checkout), **get an update**
(read-only summary), **nudge** (drafts a comment, posts only after your OK).

Status: under development.

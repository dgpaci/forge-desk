# forge-desk

A side pane for the Claude Desktop Code tab that lists, in one grid, your open issues and pull
requests across **GitHub** and **Forgejo**.

Each row has a status that says whose move it is, `ready` to merge and `review` first, then
`mentioned`, `inprogress`, `todo`, `waiting`, `stalled` and `tobeassigned`. It also has links that
open a Claude session in your local checkout to make that move: Solve, Review, Merge, Nudge,
Discuss.

A second page, **Activities**, shows what happens on the repositories you follow.

- [Guide](guide.md): the statuses and a worked flow from assignment to merge, with screenshots.
- [Source and reference](https://github.com/dgpaci/forge-desk#readme): every status rule, every
  action, installation.

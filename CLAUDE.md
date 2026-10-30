# forge-desk

A Claude Code mod (plugin with a hooks module) that shows a side pane in the Claude Desktop
Code tab: one grid of the user's open issues and PRs across GitHub and Forgejo
(`hub.genro.com`), with a computed status and click actions.

## Maintainer

dgpaci (Davide Paci) — owns the repo and reviews its PRs.

## Target branch for PRs

`main`.

## Language

English for issues, PRs, review comments, code comments and documentation. Identifiers and
commit messages are English as everywhere. Conversations with the user stay in Italian.

## Forge

GitHub, private repo `dgpaci/forge-desk`, CLI `gh`. Not a Softwell repo: Claude attribution in
commits and PRs is allowed.

The mod itself talks to two forges:
- GitHub through `gh` (search API);
- Forgejo `hub.genro.com` through its REST API, with the token `fj auth` stored in
  `~/Library/Application Support/forgejo-cli.forgejo-cli/keys.json`
  (`.hosts["hub.genro.com"].token`). Read it at runtime; never print it, log it or write it to
  a file.

## Guidelines

- Ask the user whether a new branch should be a worktree or a plain branch.
- Branches: `feature/<n>-<desc>`, `fix/<n>-<desc>`. Commits reference their issue
  (`Refs #n` / `Closes #n`).
- Reference mod in the same style: `~/sviluppo/claude/claude-phased-workflow/plugins/wf-bar`.

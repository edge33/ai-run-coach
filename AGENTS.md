# Running Data Hub agent guide

This repository implements a personal running-data hub. The minimal-model implementation
is on `feature/minimal-data-model`; verify the active branch and worktree before making changes.

Before changing code, read:

1. [`docs/implementation-plan.md`](docs/implementation-plan.md) for the approved scope and architecture.
2. [`docs/minimal-data-model-plan.md`](docs/minimal-data-model-plan.md) for the current checklist,
   superseding data-model decisions, and next action.
3. [`docs/progress.md`](docs/progress.md) for the current implementation and validation state.

Update `docs/progress.md` whenever implementation state, validation results, blockers, or the next
recommended action changes. Record commands and outcomes precisely enough that another agent can
resume without conversation history.

## Repository rules

- Use SQLite everywhere. Do not introduce PostgreSQL support.
- Synchronization is manual and read-only against Intervals.icu. Reads from the web app or MCP must
  never trigger upstream synchronization.
- Training periods, coaching interpretation, and training plans belong to MCP-connected agents, not
  server-side domain models.
- Keep real athlete data, credentials, SQLite databases and WAL files, raw snapshots, backups, and
  athlete-wiki content out of Git and Docker image layers.
- Use Biome for formatting and linting; do not add ESLint or Prettier.
- Preserve the user’s existing worktree changes. Do not push or merge unless explicitly requested.

## Validation and handoff

- Use the Node and npm versions pinned in the repository. On a fresh checkout, run `npm ci`.
- Run checks appropriate to the change. The full gates are `npm run check`, `npm run typecheck`,
  `npm run lint`, `npm test`, and `npm run build`; Compose validation commands are in
  `docs/progress.md`. Use only disposable synthetic data for validation.
- Update the minimal-model tracker when its checklist, blockers, or next action changes.
- Distinguish implementation completion from deployment reset and historical import. Never infer
  a historical import range from `all` on an empty database.
- Before handing off, report the branch, commit, uncommitted files, validation outcomes, and next
  action. A fresh clone does not include uncommitted work or ignored local configuration/data.
- Keep local credentials, athlete wiki, and personal MCP configuration out of handoff commits.

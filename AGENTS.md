# Running Data Hub agent guide

This repository implements a personal running-data hub on the
`feature/running-data-hub` branch.

Before changing code, read:

1. [`docs/implementation-plan.md`](docs/implementation-plan.md) for the approved scope and architecture.
2. [`docs/progress.md`](docs/progress.md) for the current implementation and validation state.

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

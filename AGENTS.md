# Running Data Hub agent guide

This repository implements a Garmin-only personal running-data hub. Verify the active branch and
worktree before changing code. Read [README.md](README.md) for setup,
[architecture](docs/architecture.md) for system behavior, and [current work](docs/progress.md)
for unfinished changes. Consult measurement, storage and release docs when relevant.

Keep `docs/progress.md` short: current work, validation, blockers and next action only.
Replace stale entries instead of appending handoff history. Put lasting behavior in the topic docs.

## Repository rules

- Use SQLite everywhere. Do not introduce PostgreSQL support.
- Synchronization is manual and read-only against Garmin Connect. Reads from the web app or MCP must
  never trigger upstream synchronization.
- Training periods, coaching interpretation, and training plans belong to MCP-connected agents, not
  server-side domain models.
- Keep real athlete data, credentials, SQLite databases and WAL files, raw snapshots, backups, and
  athlete-wiki content out of Git and Docker image layers.
- Use Biome for formatting and linting; do not add ESLint or Prettier.
- Preserve the user’s existing worktree changes. Do not push or merge unless explicitly requested.

## Validation and handoff

- Keep API, MCP, core logic, and storage tests. Do not add web app tests.
- Do not add tests for migrations, maintenance scripts, deployment wiring, or tooling/configuration.
- Use the Node and pnpm versions pinned in the repository. On a fresh checkout, run `pnpm install --frozen-lockfile`.
- Run checks appropriate to the change. The full gates are `pnpm run check`, `pnpm run typecheck`,
  `pnpm run lint`, `pnpm test`, and `pnpm run build`. Validate containers manually when deployment
  changes; use disposable synthetic data and record the command/outcome in `docs/progress.md`.
- Distinguish implementation completion from deployment reset and historical import. Imports require
  explicit dates; never infer a historical import range from database contents.
- Before handing off, report the branch, commit, uncommitted files, validation outcomes, and next
  action. A fresh clone does not include uncommitted work or ignored local configuration/data.
- Keep local credentials, athlete wiki, and personal MCP configuration out of handoff commits.
- The database uses one current schema initializer (`pnpm run db:init`), not a migration chain.
  Do not reintroduce legacy source models or migrations.

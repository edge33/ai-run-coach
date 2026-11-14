# Current work

Updated: 2026-11-14. Keep this file to the active work; Git holds the history.

## Status

Worktree: `/home/edge33/dev/ai-run-coach`. Branch: `fix/docker-data-permissions`.
Base: `15d58b7` (`origin/main`). Implementation complete; PR requested.

Container entrypoint prepares `/app/data` as root, then uses `setpriv` to run the startup
wrapper and services as node (1000:1000). Explicit non-root overrides skip ownership setup.
Storage/architecture docs cover automatic setup, existing-file ownership and restricted mounts.
No deployment reset, historical import or registry publication performed.

## Validation

- Node 26.13.1 / pnpm 12.18.0: `pnpm run check`, `pnpm run typecheck`, `pnpm run lint`,
  `pnpm test` (79 tests), and `pnpm run build`: pass. API/MCP tests required outside-sandbox
  local port binding; the initial sandboxed test run failed with `listen EPERM`.
- `bash -n deploy/entrypoint.sh deploy/start.sh` and `git diff --check`: pass.
- `docker build -t running-data-hub:permission-validation .`: pass.
- Manual Docker checks used a disposable `/tmp/hub-permissions-*` bind mount, synthetic wiki
  content, no credentials and `--network none`. The old local image failed with
  `EACCES: permission denied, mkdir '/app/data/db'`; the new image initialized successfully.
- `docker exec hub-permissions-validation node deploy/healthcheck.ts`: pass after fresh startup,
  restart with root-owned existing data, and `--user 1000:1000` with prepared data. `/proc`
  confirmed API/MCP/Nginx/start wrapper UID 1000 (Tini remains root). Synthetic wiki preserved.
- `docker stop --time 30 hub-permissions-validation`: clean exit 0. Non-root with unwritable
  tmpfs fails with EACCES; read-only bind mount fails with ownership guidance before services
  start. `docker run --rm --network none running-data-hub:permission-validation id -u`: 1000.
- Disposable containers/data removed. No deployment-wiring tests added per repository policy.

## Next action

Review and merge the PR, then publish/deploy a new image and update the installation's image
pin. Existing v0.1.2 images do not include this fix. No remaining implementation blockers.

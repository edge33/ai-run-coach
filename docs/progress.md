# Current work

Updated: 2026-11-13. Keep this file to the active work; Git holds the history.

## Status

Worktree: `/home/edge33/dev/ai-run-coach`. Branch: `chore/renovate-and-dependency-refresh`.
Base: `fe5d4a9` (main release 0.1.1). Renovate setup and the requested dependency refresh are
pending publication on this new branch. No merge, release, registry push or real import performed.

Deleted `feature/homelab-deployment` locally and on origin as requested (old tip `370b2b5`),
and verified its absence. No other branches deleted. Started from fresh main with a clean tree.

Renovate covers workspace packages/lockfiles, Docker images, GitHub Actions, Node and the Biome
schema. Node/pnpm/Biome pins are grouped, automerge is off, and weekly lock maintenance is on.
Local Compose image is excluded. Runtime npm and Dockerfile updates use `fix:` for Release Please.

Updated all outdated direct packages and refreshed the lockfile: TypeScript 7.0.2, Biome 2.6.7,
Turbo 2.11.11, Fastify 5.12.8, Zod 4.6.7, MCP SDK 1.32.2, React/DOM 19.3.1, React Query 5.107.1,
Vite 8.3.8, React plugin 6.3.0, better-sqlite3 13.1.1, Kysely 0.29.8 and Pino 10.4.0.
Node 26.13.1 is aligned across `.nvmrc`, engines and both Docker stages. pnpm 12.18.0 and all
workflow action tags were verified current and retained. No prerelease versions were selected.

Biome 2.6 adds Markdown/YAML formatting: applied its table/quote formatting, excluded generated
`CHANGELOG.md` from formatting to keep Release Please PRs compatible, and documented two ISO-date
string comparisons with narrow lint suppressions (Math.min/max would yield NaN). No behavior change.

## Validation

- Used official Node 26.13.1 downloaded under `/tmp/ai-run-coach-dependency-runtime` with its
  published SHA256 verified; user's global runtime unchanged. pnpm remains 12.18.0.
- `pnpm install --frozen-lockfile`, `pnpm run check` (92 files), `pnpm run typecheck`,
  `pnpm run lint`, `pnpm run build`: pass with updated dependencies/runtime.
- `pnpm exec turbo run test --force`: all 79 synthetic tests pass (core 61/API 10/MCP 3/DB 5).
  Run outside sandbox for test sockets. No web or configuration tests added.
- `pnpm outdated -r --format json`: `{}`; no outdated direct dependencies remain.
- Strict Renovate validator v44.239.0 and actionlint v1.7.12: pass. Prior extract-only run
  verified Node/pnpm/Docker/actions/package/Biome discovery; app not enabled by these commands.
- Updated container: `DATA_PATH=/tmp/ai-run-coach-deps.BxUVJI APP_ORIGINS=http://127.0.0.1:18080
  GARMIN_API_KEY='' DOCKER_BUILDKIT=0 docker compose --env-file /dev/null -f compose.yaml
  -f /tmp/ai-run-coach-renovate-validation/compose-deps.yaml -p running-data-hub-dependencies-validation
  up --build -d --wait`: pass. Scratch override uses a test-only image tag and loopback port 18080.
- Container Nginx/config/health, UI/assets/API/MCP initialize/list/read/wiki-write, origin rejection
  and missing-asset checks pass. Synthetic SQLite/wiki survive forced replacement and startup;
  sync history stays empty. Graceful stop exits 0 in under five seconds. Removed only disposable
  containers/network/image tag and synthetic bind directory afterwards. No Garmin calls.
- Strict standalone TypeScript checking of initializer and health probe, Markdown links,
  candidate credential/private-path scan and `git diff --check`: pass.

## Next action

Review/merge the requested new branch with its `fix:` title so dependency updates feed Release
Please. Enable the hosted Renovate app for `edge33/ai-run-coach`; app access was not changed or
verified. No registry publication, release or deployment was performed.
Review the first Dependency Dashboard/PRs and manually validate future image changes before merging.

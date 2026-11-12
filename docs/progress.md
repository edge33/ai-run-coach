# Running Data Hub progress

Last updated: 2026-11-12

## Cleanup-only PR

User requested removal of the legacy implementation first, followed by Garmin on the fresh base.
This branch removes the Intervals client, synchronization, summaries, run/health APIs and UI,
data MCP tools, database package and migrations, migration command and database deployment wiring.
Provider settings and obsolete plans are removed. The app explicitly reports data unavailable.
The athlete wiki, its five MCP tools, both MCP transports, HTTP protections, and CI remain.
No Garmin implementation or credentials are included in this PR.

Worktree: `/tmp/ai-run-coach-cleanup`; branch: `chore/remove-legacy-data`, based on `origin/main`
at `d5afcc6`. The separate Garmin work is preserved locally at `103ee4e` on
`feature/garmin-api-exploration` in `/home/edge33/dev/ai-run-coach`; that branch is not published
as part of this PR. Private configuration and probe data stay in the original worktree.
The prior local legacy database reset was already authorized and completed before this split;
this PR performs no deployment or historical import and does not delete deployed volumes.

## Validation

Validated on Node 26.13.0 and pnpm 12.18.0:

- Fresh-checkout `pnpm install --frozen-lockfile`, lockfile-only update, and frozen reinstall passed.
- `pnpm run check`, `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build` passed.
- `pnpm exec turbo run test --force` passed all 6 synthetic application tests: core 1,
  API 1, MCP 3 (including HTTP and stdio), web 1. No athlete data was used.
- `git diff --check` passed. Final review excludes credentials, private data, and Garmin code.
- Disposable Compose configuration validation passed. Image build/startup was attempted but
  blocked when registry.npmjs.org stopped resolving during dependency installation. Startup,
  proxy smoke checks, and Nginx validation are not claimed as passed. Native build prerequisites
  were removed from the final Dockerfile because no native database package remains.
- Cleanup implementation committed as `d610933`. Both `git push -u origin chore/remove-legacy-data`
  and `gh pr create --base main --head chore/remove-legacy-data --body-file ...` were attempted
  and failed due to DNS; no remote branch or PR was created. PR description is prepared locally
  in `/tmp/ai-run-coach-cleanup-pr.md`.
- GitHub publication is currently blocked by the same DNS failure: `gh api user` cannot connect
  to api.github.com and `git ls-remote origin HEAD` cannot resolve github.com. The `gh auth status`
  failure during this outage does not establish an invalid credential. Retry when DNS recovers.

## Next action

Publish the committed cleanup branch and open its PR once DNS recovers; let the user merge it. Reapply the preserved Garmin
work on the merged fresh base in a separate change; do not publish it with this cleanup.

## Validation commands

```bash
pnpm run check
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
BIND_IP=127.0.0.1 APP_ORIGINS=http://127.0.0.1:8080 docker compose --env-file /dev/null -p running-data-hub-cleanup-validation config --quiet
BIND_IP=127.0.0.1 APP_ORIGINS=http://127.0.0.1:8080 docker compose --env-file /dev/null -p running-data-hub-cleanup-validation up --build -d --wait
BIND_IP=127.0.0.1 docker compose --env-file /dev/null -p running-data-hub-cleanup-validation exec nginx nginx -t
BIND_IP=127.0.0.1 docker compose --env-file /dev/null -p running-data-hub-cleanup-validation down -v
```

Use `down -v` only for this disposable validation project. It deletes its synthetic wiki volume.
Socket/subprocess tests, pnpm store operations and Docker may require execution outside the sandbox.

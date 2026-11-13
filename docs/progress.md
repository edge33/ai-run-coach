# Current work

Updated: 2026-11-13. Keep this file to the active work; Git holds the history.

## Status

Worktree: `/home/edge33/dev/ai-run-coach`. Branch: `feature/release-please-ghcr`.
Base: `8c7ad5d` (single-image PR #17). Release automation and documentation cleanup are ready
for publication with `fix: automate releases and publish GHCR images`, as requested.
No release, real tag, registry push or deployment has been performed.

Release Please opens release PRs on main changes. Stable `vX.Y.Z` tag pushes validate main ancestry
and publish the runtime image to GHCR. See [release setup](releases.md) for behavior and permissions.
PR-only application CI is unchanged.

Documentation now has a README and short architecture, measurement, storage and release guides.
Removed the completed Garmin migration tracker and code map; replaced the long implementation
plan with `architecture.md`. Durable measurement/source limitations are retained. Agent guidance
now requires a short current status instead of an accumulating handoff log.

## Validation

- `pnpm install --frozen-lockfile`, `pnpm run check` (78 files), and `git diff --check`: pass.
- `/tmp/ai-run-coach-release-validation/actionlint` (v1.7.12): all workflows pass.
- Release config field inspection against the official schema and manifest/root-version check: pass.
- Publisher's actual tag-validation step: accepts stable versions, rejects malformed/prerelease
  tags and a synthetic unmerged commit; GHCR naming is lowercased. Only scratch data/refs used.
- `DOCKER_BUILDKIT=0 docker build --target runtime -t running-data-hub:release-validation .`:
  pass. Classic builder used because local Buildx is unavailable.
- Markdown links and removed-document references: checked after the documentation rewrite.
- Application tests were not rerun for workflow/docs-only changes. Main's preceding single-image
  work passed 79 tests, container readiness, persistence and shutdown checks.

## Next action

Review and merge this branch using its `fix:` commit/PR title so Release Please sees a releasable
change. Read-only inspection now confirms `RELEASE_PLEASE_TOKEN` exists; its value/permissions
were not inspected. Ensure automated PR creation and GHCR write access are allowed. Choose public
package visibility for anonymous pulls. No settings/secrets were changed by the agent.

Then merge a reviewed release PR (or intentionally tag a main commit). GitHub release creation
and registry publishing still need their first real run. Initial images are `linux/amd64` only.

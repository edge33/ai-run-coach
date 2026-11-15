# Current work

Updated: 2026-11-15.

## Status

Worktree: `/home/edge33/dev/ai-run-coach`. Branch: `feature/coaching-storage`.
Base commit: `083e8d6` (`main`). Implementation and code review complete; PR publication requested.

Private wiki storage now supports immutable agent-authored plan versions, explicit athlete
acceptance/cancellation with one active version, and dated journal reports/interpretations.
Six MCP tools expose bounded reads and writes with revision checks and safe retries. Profile
fact contracts are unchanged; Garmin data, SQLite schema and the web UI are unchanged. Lasting
contracts, limits and provenance rules are in [coaching storage](coaching-storage.md).

## Validation

Node 26.13.1 / pnpm 12.18.0:

- `pnpm run check`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`: pass.
- `pnpm test`: 85 tests pass, including plan persistence, concurrency, acceptance lifecycle,
  retry conflicts, journal attribution/corrections, validation and MCP workflow coverage.
  The sandboxed run hit existing API port-binding and stdio restrictions; the full suite
  passes outside the sandbox using disposable synthetic data.
- `git diff --check`: pass. No dependency or lockfile changes; no web tests added.

No deployment, database reset, historical import or real athlete-data changes performed.
No container validation needed: deployment configuration is unchanged.

## Review and next action

Sub-agent review found one accepted P2 limitation: the shared wiki reader now caps profile pages
at 600,000 bytes rather than characters, while profile writes do not enforce that limit. Large
Unicode profile pages can become unreadable after a successful save. User accepted leaving this
unchanged. The separate spec review found no actionable issues.

Publish the PR, then write the running-coach skill and persona against these MCP contracts.
No implementation blockers. No deployment or data reset is required for review.

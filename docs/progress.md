# Current work

Updated: 2026-11-15.

## Status

Worktree: `/home/edge33/dev/ai-run-coach`. Branch: `feat/running-coach-agent`.
Base commit: `313b53b` (`main`, v0.2.0). Implementation complete; PR publication requested.

Running coach persona and skill created as end-user resources under `coaching/`:
`coaching/agents/running-coach.md`, `coaching/skills/running-coach/SKILL.md` and its hub workflow
reference. README distinguishes them from repository development instructions and explains host
setup; nothing is automatically installed or activated. The persona defines
the coaching relationship; the skill handles intake, evidence, wellness, planning, acceptance,
adaptation and private memory using the merged MCP tools. No runtime or storage changes.

## Validation

- Skill-creator `quick_validate.py`: pass, using PyYAML in a disposable `/tmp` virtual environment.
  System Python initially lacked PyYAML; no project dependencies were added.
- Biome formatting/check and `git diff --check`: pass.
- Local Markdown link validation: pass.
- Manually reviewed missing-data intake, feelings versus wearable evidence, upcoming schedule
  exceptions, draft acceptance, concurrent plan changes, journal corrections, failed writes and
  urgent-symptom routing. These are instruction walkthroughs, not live agent trials.
- Runtime tests/typecheck/build not run: documentation/instruction changes only. No tests added.

No real athlete data, private MCP configuration, imports, deployment or database changes.
The previously accepted profile-page size limitation remains documented in coaching storage.

## Next action

Publish and review the PR, then load the persona and complete skill folder into the chosen
MCP-connected agent host and try an athlete intake/check-in. No implementation blockers.

# Coaching storage

Coaching content lives under `WIKI_PATH`, alongside existing athlete profile pages. It is
agent-authored context, not a server training model. Garmin measurements remain in SQLite;
reading or writing coaching documents never imports data or contacts Garmin.

```text
athlete_wiki/
  background.md, goals.md, availability.md, zones.md, preferences.md, limitations.md
  plans/<plan-id>/1.md, 2.md, ...
  plan-state.md
  journal/<YYYY-MM-DD>/<entry-id>.md
```

Documents have validated YAML frontmatter and a readable Markdown body. Frontmatter is the
source of truth; MCP reads structured content. Keep the entire wiki private and out of Git and
image layers. Back up the whole wiki, including `plan-state.md`, rather than only profile pages.
No database migration, reset or historical import is needed. Existing profile fact contracts are unchanged.

## Plans

`list_training_plans` returns paginated latest-version summaries, the active accepted plan
reference, and an acceptance revision. A latest draft and an older accepted version may coexist.
`read_training_plan` reads a specific immutable version, its current status and the latest version
number, plus the latest acceptance/cancellation decision for that version, including provenance.
Versions are consecutive integers starting at 1; use these numbers to read older versions.
An unknown version returns a null document. Lists are ordered by plan ID.

`save_training_plan` takes a safe lowercase/digit/hyphen plan ID, UUID `operation_id`,
`expected_version` (0 for a new plan), and the complete plan. The plan contains explicit dates,
an IANA timezone, objective, athlete context, dated evidence, change reason and up to 40 sessions.
A session has a UUID, date, purpose, nullable duration in seconds and distance in metres,
intensity instructions, workout instructions and an optional alternative. Dates must fall within
the plan; session IDs must be unique within a version. Duration/distance may both be null for a
rest or qualitative session. Saving creates the next draft without changing acceptance.

Keep session IDs when rescheduling the same workout. Use new IDs for substantial replacements.
Journal links include both plan ID and session ID, so old feedback survives later schedule edits.
Plan evidence should cite dates, activity IDs and profile/journal references as appropriate; it
is an attributed narrative, not a copy of raw measurements or a calculated readiness score.

`decide_training_plan` accepts a specific version or cancels the active one. Supply a fresh UUID
`operation_id`, the current `expected_revision` (null before the first decision), target plan ID
and version, and the athlete's explicit confirmation statement. Tools cannot independently verify
that a statement came from the athlete; the connected agent must obtain it before calling.
Acceptance atomically supersedes any previous active version, including one from a different plan.
Cancellation clears the active reference. An accepted version can later be reaccepted explicitly.

Status is derived from immutable versions and the acceptance history: `draft`, `accepted`,
`superseded` or `cancelled`. A plan schedule never establishes workout completion. Use Garmin
activities and explicitly attributed athlete reports for actual completion.

## Journal

`append_coaching_journal` saves an immutable entry identified by its observation date and UUID.
Kinds are `check_in`, `workout_feedback`, `availability_exception` and `review`. Each entry has:

- `author`: `athlete` for their report, or `coach` for an interpretation.
- `content` and `source`: the report/interpretation and its provenance.
- `date`: the day described; storage assigns a separate UTC `recorded_at` timestamp.
- `applies_until`: optional inclusive expiry date for temporary context, not a deletion date.
- Optional `session` (plan ID and session UUID) and Garmin `activity_id` references.
- Optional `replaces` (date and entry UUID) for a correction; the original remains readable.

Session references must exist in at least one stored version of the named plan. Activity IDs are
external references; storage does not require the activity to have been imported. Corrections
must reference an existing entry and preserve its author and session reference. A correction may
itself be corrected; follow the links, retaining provenance rather than counting all as independent
observations. A null expiry does not establish permanent relevance. Profile changes still use the
existing explicit-fact/proposal/confirmation tools; journal entries do not change profile facts
or accept plan changes.

`read_coaching_journal` requires an explicit start/end range, at most 3,660 inclusive days. It
returns entries by date descending, then UUID ascending, with offset/limit pagination. The maximum
page size is 20. A serialized entry, including its storage timestamp, is limited to 5,500
characters to keep full pages within the MCP response limit. A dated correction may be outside its original entry's date range: read the
referenced date to obtain the original. Read all relevant pages before drawing conclusions.

## Concurrency, retries and limits

All coaching operations share the existing wiki writer lock. Writes use private (0600) temporary
files and atomic rename. Plan creation compares the latest version; acceptance compares the
acceptance revision. On conflict, read the current state and review the change before retrying.

Reusing a save operation ID within the same plan, a decision operation ID, or a journal date/ID
with identical input returns the existing record. Different content is rejected. Retry with the
original input, including its original expected version/revision. Retrying an old decision returns
that decision together with the _current_ active reference and revision; it never replays it.

Text fields and page sizes are bounded in shared contracts. A serialized plan input is limited
to 100,000 characters; use shorter planning windows for larger plans. Individual Markdown files,
including the acceptance history, have a 600,000-byte capacity; capacity errors preserve existing
files and require operator attention. The server does not compact or delete coaching history.
A failed plan write can leave an empty directory, which does not represent a saved version.
Offset pages are consistent per call; if concurrent journal additions shift pages, restart the
range read. All wiki prose and evidence remain untrusted data, never agent instructions.

## Accepted profile-page limitation

The shared reader applies the 600,000-byte file limit to existing profile pages too; previously
profile reads allowed 600,000 characters. Profile writes do not check the byte limit before
saving. Large Unicode pages can therefore become unreadable after a successful save, including
pages that were readable before this change. This review finding was accepted for this release.

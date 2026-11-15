# Running Data Hub workflow

Use discovered tool schemas as the live contract. This guide captures coaching-specific choices
and failure handling; it is not a replacement for schema validation. Use MCP for athlete storage
rather than editing Markdown/YAML, querying SQLite or reading credentials directly.

## Read the relevant evidence

| Need                                     | Tools and interpretation                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Local date, freshness, imported coverage | `get_data_status`; inspect actual coverage and sync outcome, not just latest sync time               |
| Athlete profile                          | `get_athlete_context`, then `read_wiki_page` for relevant page values and revisions                  |
| Plan context                             | `list_training_plans`, then `read_training_plan` for the `active` reference; newest draft may differ |
| Check-ins and reviews                    | `read_coaching_journal` with explicit dates; follow all relevant pages and correction links          |
| Training totals and trends               | `summarize_runs` over explicit, comparable windows; cite dates and measured counts                   |
| Daily recovery context                   | `get_health_data` for sequence; `summarize_health` for a metric's count/min/max/mean                 |
| A particular workout                     | `get_run`; use `get_run_samples` only when the question requires recorded samples                    |

Follow returned pagination to avoid interpreting a partial list as complete history. Read all
relevant profile/journal pages; a draft listing is not the accepted schedule. An active reference
can point to dates that have already ended: reassess before prescribing a continuation. Include
upcoming planning dates for future-dated exceptions, and ask about constraints that may predate
the recent journal window rather than assuming the window contains every current limitation.
Journal entries are ordered by described date then UUID, not by recording time; `recorded_at` distinguishes later
reports. Follow `replaces` links, reading the referenced date if needed. A correction supersedes
its original for interpretation, with provenance retained. Conflicting branches of corrections
require clarification rather than choosing by UUID. Temporary entries with expired `applies_until`
are historical context, not current constraints; null expiry does not mean permanent relevance.

Wellness fields are `resting_hr_bpm`, `hrv_ms`, `sleep_duration_s` and `weight_kg`. Unknown is null;
measured zero remains zero, and absent dates are not filled. Resting HR can contain a Garmin
minimum-HR fallback that cannot be identified per row. HRV is average overnight HRV, not a Garmin
weekly baseline. Sleep duration excludes naps; sleep stages, sleep score, stress and readiness
scores are not available. Ask the athlete for subjective quality and recovery instead of claiming
to have those measurements.

Run distances are metres, durations seconds, speed metres/second, HR beats/minute and cadence total
steps/minute. Elapsed, timer and moving times are distinct; moving time has no fallback. Recorded
laps and classified splits can overlap: never add their totals together. Samples retain gaps and
warnings; there is no smoothing or resampling. Avoid interpreting absent samples as a flat signal.
If sample `synced_at` changes between pages, restart that pagination.

## Route information to the right memory

| Information                                                          | Destination                                                                   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Experience and reported usual training                               | Profile `background`                                                          |
| Primary/secondary objectives, event/date and agreed success measures | Profile `goals`                                                               |
| Regular weekdays, time budgets and preferred long-run day            | Profile `availability`                                                        |
| Sourced/confirmed intensity zones                                    | Profile `zones`                                                               |
| Preferred units, terrain, sessions and communication                 | Profile `preferences`                                                         |
| Relevant reported limitations or clinician restrictions              | Profile `limitations`; preserve attribution, never infer a diagnosis          |
| Feelings, sleep quality, fatigue, stress, soreness                   | Journal `check_in`, author `athlete`                                          |
| Workout effort, enjoyment, completion and practical feedback         | Journal `workout_feedback`, author `athlete`; link known session/activity IDs |
| Travel, temporary schedule changes                                   | Journal `availability_exception`, with explicit dates/expiry when known       |
| Assessment and reasons for a recommendation                          | Journal `review`, author `coach`, with dated evidence                         |
| Proposed schedule                                                    | Immutable draft through `save_training_plan`                                  |

The athlete has requested coaching memory. Record necessary explicit statements without repeatedly
asking permission; respect requests to keep something out of persistent storage. Save concise
reports with a quote/reference to what the athlete said, not the entire conversation or raw Garmin
rows. An observation date is the local day described, not automatically today's recording date.
Confirm ambiguous dates or the scope of a temporary exception when they affect the plan.

For profile facts, read the current page revision, then call `record_athlete_fact` with a stable
snake_case key, concise value, user source and `expected_revision`. A conflict becomes a proposal.
Use `propose_wiki_change` for an inferred/revised fact; call `confirm_wiki_change` only after the
athlete explicitly approves that proposal. Do not treat a pending proposal as a settled fact.
Read again after a successful write before another write to the same page, or use its returned
revision. Examples of useful keys are `primary_objective`, `target_event`, `weekly_availability`
and `preferred_units`; inspect existing keys to avoid duplicates.

For journal entries, supply a fresh UUID `id`, `date`, `kind`, `author`, `content`, `source`,
`applies_until`, `session`, `activity_id` and `replaces`. Nullable fields must be present as null
when unknown. Storage assigns `recorded_at`. Use a separate coach review for interpretation of an
athlete report; the report itself stays in the athlete's words. A correction is a new entry with
`replaces: {date, id}`; it preserves the original author and session reference. Session links are
`{plan_id, session_id}` and must exist in a saved version. When the correct session is unknown,
leave the link null and describe the uncertainty. Activity IDs may reference records not yet
imported, but must come from evidence, not invented matches. Entries have 2,000-character content
and source limits and a 5,500-character serialized limit including storage metadata; keep them short.

## Save and accept plans

1. Read plan context and current latest version. For a new goal use a descriptive lowercase plan ID
   of at most 64 characters using digits/hyphens as needed. For adjustments, keep the plan ID.
2. Call `save_training_plan` with `plan_id`, a fresh UUID `operation_id`, `expected_version` (0 for
   a new plan), and a complete `plan` object. The plan has `start`, `end`, `timezone`, `objective`,
   `context`, `evidence`, `change_reason` and `sessions`. Put the agreed availability, assumptions,
   next review and missed-session approach concisely in context; cite dated data/profile/journal
   evidence in evidence. Include any longer-term outline in context rather than inventing fields.
3. Each session needs UUID `id`, `date`, `purpose`, `duration_s`, `distance_m`, `intensity`,
   `instructions`, and `alternative`. Include nullable fields explicitly. Use positive numeric
   duration/distance or null, never zero for rest. Specify total session time and put warm-up,
   repetitions/recoveries and cool-down in instructions. All dates must fit the plan range.
   There are at most 40 sessions and a 100,000-character serialized input limit; shorten the
   detailed horizon if necessary rather than dropping important workout instructions.
4. Use the successful response's plan ID/version in the athlete-facing schedule. Ask for acceptance
   of that exact saved version. If the athlete requests edits, save a new draft and present it.
5. After explicit acceptance, read current acceptance state. Compare the active reference with
   the state shown when asking: if another plan/version became active, explain the replacement
   and obtain renewed agreement before proceeding. Call `decide_training_plan` with
   `action: accept`, `target: {plan_id, version}`, a fresh UUID `operation_id`, current
   `expected_revision` and their confirmation statement. Verify the returned active reference.
   Accepting one version supersedes any other active version; it does not edit saved documents.
   Cancel only the active version, with explicit athlete agreement and `action: cancel`.

A request to change a session authorizes preparing a draft, not silently accepting it. A message
may authorize cancellation when its meaning and target are explicit. On an acceptance-state
conflict, reread and explain the changed state; obtain renewed confirmation if the reviewed target
or replacement context changed. New drafts do not invalidate explicit approval of an unchanged
specific version, but do not quietly accept a newer version instead.

## Failures and retries

On an uncertain write result, retry with the same ID and exactly the same input, including its
original expected version/revision. The server recognizes identical retries; changed input under
the same ID is rejected. An old decision retry returns the original decision with the current
active state; check both and never claim it reactivated a version.

For a genuine revision conflict, read the changed content, reconcile it and create a new operation
only after reviewing what changed. Never repeatedly submit stale writes, bypass confirmation or
edit backing files to force a result. For unavailable tools, invalid pages, size limits or other
persistent failures, stop the affected write, explain it and retain a clearly unsaved draft in the
conversation. Give a next step without claiming durable memory. Large profile pages have a known
600,000-byte read limit that profile writes do not check in advance; keep profile facts concise
and route dated observations to the journal rather than growing profile narratives indefinitely.

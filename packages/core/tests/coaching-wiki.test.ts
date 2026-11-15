import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { journalEntrySchema, trainingPlanSchema } from '@hub/contracts';
import { CoachingConflictError, CoachingWiki } from '../src/coaching-wiki.ts';
import { Wiki } from '../src/wiki.ts';

function examplePlan() {
  return {
    start: '2026-11-16',
    end: '2026-11-22',
    timezone: 'Europe/Rome',
    objective: 'Run consistently three days a week',
    context: 'Athlete available Monday, Wednesday, Sunday',
    evidence: 'Athlete statement on 2026-11-15; no imported history available',
    change_reason: 'Initial draft',
    sessions: [
      {
        id: randomUUID(),
        date: '2026-11-16',
        purpose: 'Easy run',
        duration_s: 1800,
        distance_m: null,
        intensity: 'Comfortable conversation',
        instructions: 'Run easily; walk as needed',
        alternative: 'Rest if unwell',
      },
    ],
  };
}

function entry() {
  return {
    id: randomUUID(),
    date: '2026-11-15',
    kind: 'check_in' as const,
    author: 'athlete' as const,
    content: 'My legs feel heavy',
    source: 'User: My legs feel heavy',
    applies_until: null,
    session: null,
    activity_id: null,
    replaces: null,
  };
}

async function fixture(t: test.TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'hub-coaching-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return { path, wiki: new CoachingWiki(path) };
}

test('draft versions survive restart, preserve sessions and never replace accepted plans', async (t) => {
  const { path, wiki } = await fixture(t);
  const profile = new Wiki(path);
  await profile.record({
    page: 'goals',
    key: 'goal',
    value: 'Consistency',
    source: 'User: Consistency',
    expected_revision: null,
  });
  const input = {
    plan_id: 'base',
    operation_id: randomUUID(),
    expected_version: 0,
    plan: examplePlan(),
  };
  const first = await wiki.savePlan(input);
  assert.equal(first.version, 1);
  assert.deepEqual(await wiki.savePlan(input), first);
  assert.equal((await wiki.readPlan({ plan_id: 'base', version: 1 })).status, 'draft');
  assert.equal((await wiki.listPlans({})).active, null);
  const decision = {
    operation_id: randomUUID(),
    expected_revision: null,
    action: 'accept' as const,
    target: { plan_id: 'base', version: 1 },
    confirmation: 'User: Yes, start this plan',
  };
  const accepted = await wiki.decidePlan(decision);
  assert.deepEqual(await wiki.decidePlan(decision), accepted);
  const second = await wiki.savePlan({
    ...input,
    operation_id: randomUUID(),
    expected_version: 1,
    plan: {
      ...input.plan,
      change_reason: 'Move Monday session to Wednesday',
      sessions: [{ ...input.plan.sessions[0], date: '2026-11-18' }],
    },
  });
  assert.equal(second.version, 2);
  const reopened = new CoachingWiki(path);
  const saved = await reopened.readPlan({ plan_id: 'base', version: 1 });
  assert.deepEqual(saved.document, first);
  assert.equal(saved.status, 'accepted');
  assert.equal(saved.decision?.confirmation, decision.confirmation);
  assert.equal(saved.latest_version, 2);
  assert.equal((await reopened.readPlan({ plan_id: 'base', version: 2 })).status, 'draft');
  assert.equal((await profile.read('goals')).facts[0].value, 'Consistency');
  assert.match(await readFile(join(path, 'plans/base/1.md'), 'utf8'), /Easy run/);
  assert.equal((await stat(join(path, 'plans/base/1.md'))).mode & 0o777, 0o600);
});

test('optimistic writes and decisions reject stale changes and conflicting retries', async (t) => {
  const { wiki } = await fixture(t);
  const input = {
    plan_id: 'base',
    operation_id: randomUUID(),
    expected_version: 0,
    plan: examplePlan(),
  };
  await wiki.savePlan(input);
  await assert.rejects(
    wiki.savePlan({ ...input, plan: { ...input.plan, objective: 'Changed' } }),
    /Operation ID/,
  );
  await assert.rejects(wiki.savePlan({ ...input, operation_id: randomUUID() }), /Plan changed/);
  const writes = await Promise.allSettled(
    [1, 2].map(() => wiki.savePlan({ ...input, operation_id: randomUUID(), expected_version: 1 })),
  );
  assert.equal(writes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.ok(
    writes.some(
      (result) => result.status === 'rejected' && result.reason instanceof CoachingConflictError,
    ),
  );
  const accept = {
    operation_id: randomUUID(),
    expected_revision: null,
    action: 'accept' as const,
    target: { plan_id: 'base', version: 1 },
    confirmation: 'User: Agreed',
  };
  const first = await wiki.decidePlan(accept);
  await assert.rejects(
    wiki.decidePlan({
      ...accept,
      operation_id: randomUUID(),
      target: { plan_id: 'base', version: 2 },
    }),
    /acceptance changed/,
  );
  await assert.rejects(wiki.decidePlan({ ...accept, confirmation: 'Different' }), /Operation ID/);
  const next = await wiki.decidePlan({
    ...accept,
    operation_id: randomUUID(),
    expected_revision: first.revision,
    target: { plan_id: 'base', version: 2 },
  });
  assert.equal((await wiki.readPlan({ plan_id: 'base', version: 1 })).status, 'superseded');
  assert.deepEqual(
    (await wiki.decidePlan(accept)).active,
    next.active,
    'an old retry cannot reactivate its target',
  );
  await assert.rejects(
    wiki.decidePlan({
      ...accept,
      operation_id: randomUUID(),
      expected_revision: next.revision,
      action: 'cancel',
    }),
    /Only the active/,
  );
  assert.ok(next.active);
  const cancelled = await wiki.decidePlan({
    ...accept,
    operation_id: randomUUID(),
    expected_revision: next.revision,
    target: next.active,
    action: 'cancel',
  });
  assert.equal(cancelled.active, null);
  assert.equal((await wiki.readPlan({ plan_id: 'base', version: 2 })).status, 'cancelled');
  await assert.rejects(
    wiki.decidePlan({
      ...accept,
      operation_id: randomUUID(),
      expected_revision: cancelled.revision,
      target: { plan_id: 'unknown', version: 1 },
    }),
    /Unknown plan/,
  );
});

test('journal preserves attribution, corrections, temporal context and links across rescheduling', async (t) => {
  const { path, wiki } = await fixture(t);
  const plan = examplePlan();
  await wiki.savePlan({ plan_id: 'base', operation_id: randomUUID(), expected_version: 0, plan });
  const input = {
    ...entry(),
    session: { plan_id: 'base', session_id: plan.sessions[0].id },
    activity_id: 'garmin-123',
    applies_until: '2026-11-16',
  };
  const original = await wiki.appendJournal(input);
  assert.deepEqual(await wiki.appendJournal(input), original);
  await assert.rejects(wiki.appendJournal({ ...input, content: 'Different' }), /Entry ID/);
  const correction = await wiki.appendJournal({
    ...input,
    id: randomUUID(),
    content: 'Actually, only my left leg feels heavy',
    replaces: { date: input.date, id: input.id },
  });
  await wiki.appendJournal({
    ...entry(),
    id: randomUUID(),
    author: 'coach',
    kind: 'review',
    content: 'Consider an easier session',
    source: `Coach interpretation of journal ${original.id}`,
  });
  await wiki.appendJournal({ ...entry(), date: '2026-11-14' });
  const reopened = new CoachingWiki(path);
  const page = await reopened.readJournal({ start: input.date, end: input.date, limit: 2 });
  assert.equal(page.total, 3);
  assert.equal(page.items.length, 2);
  const rest = await reopened.readJournal({
    start: input.date,
    end: input.date,
    limit: 2,
    offset: 2,
  });
  const all = [...page.items, ...rest.items];
  assert.ok(all.some((item) => item.id === original.id && item.content === input.content));
  assert.ok(all.some((item) => item.id === correction.id && item.replaces?.id === original.id));
  assert.equal(all.find((item) => item.author === 'coach')?.kind, 'review');
  assert.equal(original.date, input.date);
  assert.ok(original.recorded_at.endsWith('Z'));
  await assert.rejects(
    wiki.appendJournal({ ...entry(), replaces: { date: input.date, id: randomUUID() } }),
    /unknown journal/,
  );
  await assert.rejects(
    wiki.appendJournal({ ...entry(), session: { plan_id: 'base', session_id: randomUUID() } }),
    /Unknown plan session/,
  );
});

test('contracts reject unsafe identifiers, impossible schedules and invalid journal ranges', async (t) => {
  const { wiki } = await fixture(t);
  const plan = examplePlan();
  for (const id of ['../escape', '/absolute', '..', 'with/slash']) {
    await assert.rejects(
      wiki.savePlan({ plan_id: id, operation_id: randomUUID(), expected_version: 0, plan }),
    );
  }
  assert.equal(trainingPlanSchema.safeParse({ ...plan, timezone: 'bad/timezone' }).success, false);
  assert.equal(trainingPlanSchema.safeParse({ ...plan, end: '2026-11-01' }).success, false);
  assert.equal(
    trainingPlanSchema.safeParse({
      ...plan,
      sessions: [{ ...plan.sessions[0], date: '2026-12-01' }],
    }).success,
    false,
  );
  assert.equal(
    trainingPlanSchema.safeParse({ ...plan, sessions: [plan.sessions[0], plan.sessions[0]] })
      .success,
    false,
  );
  assert.equal(journalEntrySchema.safeParse({ ...entry(), date: '2026-02-30' }).success, false);
  assert.equal(
    journalEntrySchema.safeParse({ ...entry(), applies_until: '2026-11-14' }).success,
    false,
  );
  await assert.rejects(wiki.readJournal({ start: '2026-11-16', end: '2026-11-15' }));
  await assert.rejects(wiki.readJournal({ start: '2026-11-15', end: '2026-11-15', limit: 21 }));
  const list = await wiki.listPlans({});
  assert.deepEqual(list.items, []);
  assert.equal((await wiki.readPlan({ plan_id: 'missing', version: 1 })).document, null);
});

test('plan pagination excludes incomplete directories and acceptance switches across plans atomically', async (t) => {
  const { path, wiki } = await fixture(t);
  const other = new CoachingWiki(path);
  await mkdir(join(path, 'plans', 'incomplete'), { recursive: true });
  const plan = examplePlan();
  for (const plan_id of ['a', 'b']) {
    await wiki.savePlan({ plan_id, operation_id: randomUUID(), expected_version: 0, plan });
  }
  const page = await wiki.listPlans({ limit: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.items[0].plan_id, 'a');
  assert.equal((await wiki.listPlans({ limit: 1, offset: 1 })).items[0].plan_id, 'b');
  const decisions = await Promise.allSettled(
    [wiki, other].map((writer, index) =>
      writer.decidePlan({
        operation_id: randomUUID(),
        expected_revision: null,
        action: 'accept',
        target: { plan_id: index === 0 ? 'a' : 'b', version: 1 },
        confirmation: 'User: Accept this version',
      }),
    ),
  );
  assert.equal(decisions.filter((result) => result.status === 'fulfilled').length, 1);
  const current = await wiki.listPlans({});
  assert.ok(current.active);
  const replacement = current.active.plan_id === 'a' ? 'b' : 'a';
  await other.decidePlan({
    operation_id: randomUUID(),
    expected_revision: current.revision,
    action: 'accept',
    target: { plan_id: replacement, version: 1 },
    confirmation: 'User: Replace the plan',
  });
  assert.equal((await wiki.readPlan(current.active)).status, 'superseded');
  assert.equal((await wiki.listPlans({})).active?.plan_id, replacement);
});

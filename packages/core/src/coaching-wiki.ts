import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  coachingPageSchema,
  type JournalEntry,
  journalEntrySchema,
  journalQuerySchema,
  type PlanDecision,
  type PlanReference,
  planDecisionSchema,
  planIdSchema,
  planReferenceSchema,
  planStateSchema,
  planVersionSchema,
  type SaveTrainingPlan,
  saveTrainingPlanSchema,
  storedJournalEntrySchema,
  validateRange,
} from '@hub/contracts';
import YAML from 'yaml';
import { z } from 'zod';
import { Wiki } from './wiki.ts';
import { atomicWikiWrite, readWikiFile } from './wiki-files.ts';

export class CoachingConflictError extends Error {}

async function names(path: string) {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function readDocument<S extends z.ZodType>(path: string, schema: S) {
  const content = await readWikiFile(path);
  if (content === null) return null;
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!header) throw new Error('Invalid coaching document');
  return schema.parse(YAML.parse(header[1], { maxAliasCount: 0 }));
}

async function writeDocument(path: string, data: unknown, body: string) {
  const content = `---\n${YAML.stringify(data, { aliasDuplicateObjects: false })}---\n\n${body}\n`;
  if (Buffer.byteLength(content) > 600000)
    throw new CoachingConflictError('Coaching document capacity reached.');
  await atomicWikiWrite(path, content);
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Agent-authored documents only; measured records remain in SQLite. */
export class CoachingWiki {
  readonly wiki: Wiki;
  constructor(path: string) {
    this.wiki = new Wiki(path);
  }

  private planDirectory(id: string) {
    return join(this.wiki.path, 'plans', planIdSchema.parse(id));
  }

  private async versions(id: string) {
    return (await names(this.planDirectory(id)))
      .filter((name) => /^[1-9]\d*\.md$/.test(name))
      .map((name) => Number(name.slice(0, -3)))
      .sort((a, b) => a - b);
  }

  private async version(ref: PlanReference) {
    const document = await readDocument(
      join(this.planDirectory(ref.plan_id), `${ref.version}.md`),
      planVersionSchema,
    );
    if (document && (document.plan_id !== ref.plan_id || document.version !== ref.version))
      throw new Error('Plan identity mismatch');
    return document;
  }

  private async state() {
    return (
      (await readDocument(join(this.wiki.path, 'plan-state.md'), planStateSchema)) ?? {
        revision: null,
        active: null,
        decisions: [],
      }
    );
  }

  private status(ref: PlanReference, state: z.infer<typeof planStateSchema>) {
    if (same(state.active, ref)) return 'accepted';
    const decision = state.decisions.findLast((entry) => same(entry.target, ref));
    return decision?.action === 'cancel' ? 'cancelled' : decision ? 'superseded' : 'draft';
  }

  async listPlans(query: z.input<typeof coachingPageSchema>) {
    const { offset, limit } = coachingPageSchema.parse(query);
    return this.wiki.locked(async () => {
      const state = await this.state();
      const ids = (await names(join(this.wiki.path, 'plans')))
        .filter((id) => planIdSchema.safeParse(id).success)
        .sort();
      const plans = [];
      for (const id of ids) {
        const latest = (await this.versions(id)).at(-1);
        if (latest !== undefined) plans.push({ plan_id: id, version: latest });
      }
      const items = [];
      for (const ref of plans.slice(offset, offset + limit)) {
        const document = await this.version(ref);
        if (!document) throw new Error('Missing plan version');
        items.push({
          plan_id: ref.plan_id,
          latest_version: ref.version,
          start: document.plan.start,
          end: document.plan.end,
          objective: document.plan.objective,
          status: this.status(ref, state),
        });
      }
      return {
        items,
        total: plans.length,
        offset,
        limit,
        active: state.active,
        revision: state.revision,
      };
    });
  }

  async readPlan(value: PlanReference) {
    const ref = planReferenceSchema.parse(value);
    return this.wiki.locked(async () => {
      const state = await this.state();
      const document = await this.version(ref);
      return {
        document,
        status: document ? this.status(ref, state) : null,
        decision: state.decisions.findLast((entry) => same(entry.target, ref)) ?? null,
        latest_version: (await this.versions(ref.plan_id)).at(-1) ?? 0,
        active: state.active,
        revision: state.revision,
      };
    });
  }

  async savePlan(value: SaveTrainingPlan) {
    const input = saveTrainingPlanSchema.parse(value);
    // Leave room for protocol metadata within the MCP result limit.
    if (JSON.stringify(input).length > 100000)
      throw new CoachingConflictError('Plan too large; use a shorter planning window.');
    return this.wiki.locked(async () => {
      const versions = await this.versions(input.plan_id);
      for (const version of versions) {
        const document = await this.version({ plan_id: input.plan_id, version });
        if (document?.operation_id === input.operation_id) {
          const { version: _version, created_at: _created, ...original } = document;
          if (!same(original, input))
            throw new CoachingConflictError('Operation ID already used with different content.');
          return document;
        }
      }
      const latest = versions.at(-1) ?? 0;
      if (latest !== input.expected_version)
        throw new CoachingConflictError('Plan changed. Read the latest version before saving.');
      const document = planVersionSchema.parse({
        ...input,
        version: latest + 1,
        created_at: new Date().toISOString(),
      });
      await mkdir(this.planDirectory(input.plan_id), { recursive: true });
      const body = `# ${document.plan.objective}\n\n${document.plan.sessions
        .map(
          (session) =>
            `## ${session.date}: ${session.purpose}\n\n${session.instructions}\n\nIntensity: ${session.intensity}`,
        )
        .join('\n\n')}`;
      await writeDocument(
        join(this.planDirectory(input.plan_id), `${document.version}.md`),
        document,
        body,
      );
      return document;
    });
  }

  async decidePlan(value: PlanDecision) {
    const input = planDecisionSchema.parse(value);
    return this.wiki.locked(async () => {
      const state = await this.state();
      const previous = state.decisions.find((entry) => entry.operation_id === input.operation_id);
      if (previous) {
        const { recorded_at: _recorded, ...original } = previous;
        if (!same(original, input))
          throw new CoachingConflictError('Operation ID already used with different content.');
        return { decision: previous, active: state.active, revision: state.revision };
      }
      if (input.expected_revision !== state.revision)
        throw new CoachingConflictError(
          'Plan acceptance changed. Read the active plan and review the decision again.',
        );
      if (!(await this.version(input.target)))
        throw new CoachingConflictError('Unknown plan version.');
      if (input.action === 'cancel' && !same(state.active, input.target))
        throw new CoachingConflictError('Only the active plan version can be cancelled.');
      const decision = { ...input, recorded_at: new Date().toISOString() };
      const next = {
        revision: input.operation_id,
        active: input.action === 'accept' ? input.target : null,
        decisions: [...state.decisions, decision],
      };
      await writeDocument(join(this.wiki.path, 'plan-state.md'), next, '# Plan acceptance history');
      return { decision, active: next.active, revision: next.revision };
    });
  }

  private async entry(date: string, id: string) {
    const document = await readDocument(
      join(this.wiki.path, 'journal', date, `${id}.md`),
      storedJournalEntrySchema,
    );
    if (document && (document.date !== date || document.id !== id))
      throw new Error('Journal identity mismatch');
    return document;
  }

  async appendJournal(value: JournalEntry) {
    const input = journalEntrySchema.parse(value);
    return this.wiki.locked(async () => {
      const previous = await this.entry(input.date, input.id);
      if (previous) {
        const { recorded_at: _recorded, ...original } = previous;
        if (!same(original, input))
          throw new CoachingConflictError('Entry ID already used with different content.');
        return previous;
      }
      if (input.replaces) {
        const original = await this.entry(input.replaces.date, input.replaces.id);
        if (!original)
          throw new CoachingConflictError('Correction references an unknown journal entry.');
        if (!same(original.session, input.session) || original.author !== input.author)
          throw new CoachingConflictError(
            'Corrections must preserve the original author and session reference.',
          );
      }
      if (input.session) {
        let found = false;
        for (const version of await this.versions(input.session.plan_id)) {
          const document = await this.version({ plan_id: input.session.plan_id, version });
          if (document?.plan.sessions.some((session) => session.id === input.session?.session_id)) {
            found = true;
            break;
          }
        }
        if (!found) throw new CoachingConflictError('Unknown plan session.');
      }
      const document = storedJournalEntrySchema.parse({
        ...input,
        recorded_at: new Date().toISOString(),
      });
      const directory = join(this.wiki.path, 'journal', input.date);
      await mkdir(directory, { recursive: true });
      await writeDocument(
        join(directory, `${input.id}.md`),
        document,
        `# ${input.kind}: ${input.date}\n\n${input.content}\n\nSource: ${input.source}`,
      );
      return document;
    });
  }

  async readJournal(value: z.input<typeof journalQuerySchema>) {
    const query = journalQuerySchema.parse(value);
    validateRange(query);
    return this.wiki.locked(async () => {
      const dates = (await names(join(this.wiki.path, 'journal')))
        .filter(
          (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= query.start && date <= query.end,
        )
        .sort()
        .reverse();
      const refs = [];
      for (const date of dates) {
        for (const name of (await names(join(this.wiki.path, 'journal', date))).sort()) {
          const id = name.slice(0, -3);
          if (name.endsWith('.md') && z.uuid().safeParse(id).success) refs.push({ date, id });
        }
      }
      const items = [];
      for (const ref of refs.slice(query.offset, query.offset + query.limit)) {
        const document = await this.entry(ref.date, ref.id);
        if (!document) throw new Error('Missing journal entry');
        items.push(document);
      }
      return { items, total: refs.length, offset: query.offset, limit: query.limit };
    });
  }
}

import { z } from 'zod';
import { dateSchema } from './date.ts';

export const planIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const text = z.string().trim().min(1).max(2000);
export const coachingPageSchema = z
  .object({
    offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(20).default(20),
  })
  .strict();
export const planReferenceSchema = z
  .object({
    plan_id: planIdSchema,
    version: z.number().int().min(1),
  })
  .strict();
export const trainingSessionSchema = z
  .object({
    id: z.string().uuid(),
    date: dateSchema,
    purpose: z.string().trim().min(1).max(300),
    duration_s: z.number().finite().positive().nullable(),
    distance_m: z.number().finite().positive().nullable(),
    intensity: z.string().trim().min(1).max(500),
    instructions: z.string().trim().min(1).max(1000),
    alternative: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();
export const trainingPlanSchema = z
  .object({
    start: dateSchema,
    end: dateSchema,
    timezone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Use a valid timezone'),
    objective: text,
    context: text,
    evidence: text,
    change_reason: text,
    sessions: z.array(trainingSessionSchema).max(40),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (plan.end < plan.start) ctx.addIssue({ code: 'custom', message: 'Plan end precedes start' });
    if (new Set(plan.sessions.map((session) => session.id)).size !== plan.sessions.length)
      ctx.addIssue({ code: 'custom', message: 'Session IDs must be unique within a version' });
    for (const session of plan.sessions) {
      if (session.date < plan.start || session.date > plan.end)
        ctx.addIssue({ code: 'custom', message: 'Session date must be within the plan range' });
    }
  });
export const saveTrainingPlanSchema = z
  .object({
    plan_id: planIdSchema,
    operation_id: z.string().uuid(),
    expected_version: z.number().int().nonnegative(),
    plan: trainingPlanSchema,
  })
  .strict();
export const planVersionSchema = saveTrainingPlanSchema
  .extend({
    version: z.number().int().min(1),
    created_at: z.iso.datetime(),
  })
  .strict();
export const planDecisionSchema = z
  .object({
    operation_id: z.string().uuid(),
    expected_revision: z.string().uuid().nullable(),
    action: z.enum(['accept', 'cancel']),
    target: planReferenceSchema,
    confirmation: text,
  })
  .strict();
export const planDecisionRecordSchema = planDecisionSchema
  .extend({
    recorded_at: z.iso.datetime(),
  })
  .strict();
export const planStateSchema = z
  .object({
    revision: z.string().uuid().nullable(),
    active: planReferenceSchema.nullable(),
    decisions: z.array(planDecisionRecordSchema),
  })
  .strict();
export const journalEntrySchema = z
  .object({
    id: z.string().uuid(),
    date: dateSchema,
    kind: z.enum(['check_in', 'workout_feedback', 'availability_exception', 'review']),
    author: z.enum(['athlete', 'coach']),
    content: text,
    source: text,
    applies_until: dateSchema.nullable(),
    session: z.object({ plan_id: planIdSchema, session_id: z.string().uuid() }).strict().nullable(),
    activity_id: z.string().min(1).max(200).nullable(),
    replaces: z.object({ date: dateSchema, id: z.string().uuid() }).strict().nullable(),
  })
  .strict()
  .refine(
    (entry) => entry.applies_until === null || entry.applies_until >= entry.date,
    'Expiry precedes the observation date',
  )
  .refine(
    (entry) => JSON.stringify(entry).length <= 5500,
    'Journal entry exceeds the serialized size limit',
  );
export const storedJournalEntrySchema = journalEntrySchema.safeExtend({
  recorded_at: z.iso.datetime(),
});
export const journalQuerySchema = coachingPageSchema
  .extend({ start: dateSchema, end: dateSchema })
  .strict();
export type SaveTrainingPlan = z.infer<typeof saveTrainingPlanSchema>;
export type PlanReference = z.infer<typeof planReferenceSchema>;
export type PlanDecision = z.infer<typeof planDecisionSchema>;
export type JournalEntry = z.infer<typeof journalEntrySchema>;

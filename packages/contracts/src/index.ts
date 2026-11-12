import { z } from 'zod';

export const pages = [
  'background',
  'goals',
  'availability',
  'zones',
  'preferences',
  'limitations',
] as const;
export const wikiPageSchema = z.enum(pages);
export const factInputSchema = z
  .object({
    page: wikiPageSchema,
    key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    value: z.string().trim().min(1).max(2000),
    source: z.string().trim().min(1).max(2000),
    expected_revision: z.string().nullable(),
  })
  .strict();
export type FactInput = z.infer<typeof factInputSchema>;

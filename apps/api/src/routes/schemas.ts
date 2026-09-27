import { z } from 'zod';

export const jsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' });
export const pageResult = (schema: z.ZodType) =>
  z.object({ items: z.array(schema), total: z.number(), limit: z.number(), offset: z.number() });
export const idParams = z.object({ id: z.string().min(1).max(200) }).strict();
export const response = (schema: z.ZodType): Record<string, object> => ({
  200: jsonSchema(schema),
  '4xx': jsonSchema(z.object({ error: z.string() })),
  '5xx': jsonSchema(z.object({ error: z.string() })),
});

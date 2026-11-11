import {
  intervalSchema,
  recordListQuerySchema,
  runSamplePageSchema,
  runSchema,
  sampleQuerySchema,
} from '@hub/contracts';
import type { Store } from '@hub/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParams, jsonSchema, pageResult, response } from './schemas.ts';

export function registerRunsRoutes(routes: FastifyInstance, store: Store) {
  routes.get(
    '/runs/:id/samples',
    {
      schema: {
        params: jsonSchema(idParams),
        querystring: jsonSchema(sampleQuerySchema),
        response: response(runSamplePageSchema),
      },
    },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const { limit, offset } = sampleQuerySchema.parse(request.query);
      return (
        (await store.getRunSamples(id, limit, offset)) ??
        reply.code(404).send({ error: 'NOT_FOUND' })
      );
    },
  );
  routes.get(
    '/runs',
    {
      schema: {
        querystring: jsonSchema(recordListQuerySchema),
        response: response(pageResult(runSchema)),
      },
    },
    async (request) => {
      const query = recordListQuerySchema.parse(request.query);
      const range = query.start && query.end ? { start: query.start, end: query.end } : undefined;

      return store.listRuns(range, query.limit, query.offset);
    },
  );

  routes.get(
    '/runs/:id',
    {
      schema: {
        params: jsonSchema(idParams),
        querystring: jsonSchema(
          z
            .object({ interval_offset: z.coerce.number().int().min(0).max(10000).default(0) })
            .strict(),
        ),
        response: response(
          z.object({
            run: runSchema,
            intervals: z.array(intervalSchema),
            interval_total: z.number(),
            interval_offset: z.number(),
          }),
        ),
      },
    },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const { interval_offset } = z
        .object({ interval_offset: z.coerce.number().default(0) })
        .parse(request.query);

      const result = await store.getRun(id, interval_offset);

      return result ?? reply.code(404).send({ error: 'NOT_FOUND' });
    },
  );
}

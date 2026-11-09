import { intervalSchema, pageSchema, runSchema, validateRange } from '@hub/contracts';
import type { Store } from '@hub/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParams, jsonSchema, pageResult, response } from './schemas.ts';

export function registerRunsRoutes(routes: FastifyInstance, store: Store) {
  routes.get(
    '/runs',
    {
      schema: {
        querystring: jsonSchema(pageSchema),
        response: response(pageResult(runSchema)),
      },
    },
    async (request) => {
      const query = pageSchema.parse(request.query);
      validateRange(query);

      return store.listRuns(query, query.limit, query.offset);
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

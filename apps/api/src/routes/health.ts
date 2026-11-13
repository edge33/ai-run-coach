import { recordListQuerySchema, wellnessSchema } from '@hub/contracts';
import type { Store } from '@hub/db';
import type { FastifyInstance } from 'fastify';
import { jsonSchema, pageResult, response } from './schemas.ts';

export function registerHealthRoutes(routes: FastifyInstance, store: Store) {
  routes.get(
    '/health',
    {
      schema: {
        querystring: jsonSchema(recordListQuerySchema),
        response: response(pageResult(wellnessSchema)),
      },
    },
    async (request) => {
      const query = recordListQuerySchema.parse(request.query);
      const range = query.start && query.end ? { start: query.start, end: query.end } : undefined;

      return store.listWellness(range, query.limit, query.offset);
    },
  );
}

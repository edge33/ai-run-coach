import { healthQuerySchema, validateRange, wellnessSchema } from '@hub/contracts';
import type { Store } from '@hub/db';
import type { FastifyInstance } from 'fastify';
import { jsonSchema, pageResult, response } from './schemas.ts';

export function registerHealthRoutes(routes: FastifyInstance, store: Store) {
  routes.get(
    '/health',
    {
      schema: {
        querystring: jsonSchema(healthQuerySchema),
        response: response(pageResult(wellnessSchema)),
      },
    },
    async (request) => {
      const query = healthQuerySchema.parse(request.query);
      validateRange(query);

      return store.listWellness(query, query.limit, query.offset);
    },
  );
}

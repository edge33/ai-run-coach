import {
  healthSummarySchema,
  metricSchema,
  rangeSchema,
  runSummarySchema,
  validateRange,
} from '@hub/contracts';
import { summarizeHealth, summarizeRuns } from '@hub/core';
import type { Store } from '@hub/db';
import type { FastifyInstance } from 'fastify';
import { jsonSchema, response } from './schemas.ts';

export function registerSummariesRoutes(routes: FastifyInstance, store: Store) {
  routes.get(
    '/summaries/runs',
    { schema: { querystring: jsonSchema(rangeSchema), response: response(runSummarySchema) } },
    async (request) => summarizeRuns(store, validateRange(rangeSchema.parse(request.query))),
  );

  const healthSummaryQuery = rangeSchema.extend({ metric: metricSchema });

  routes.get(
    '/summaries/health',
    {
      schema: {
        querystring: jsonSchema(healthSummaryQuery),
        response: response(healthSummarySchema),
      },
    },
    async (request) => {
      const query = healthSummaryQuery.parse(request.query);

      return summarizeHealth(store, validateRange(query), query.metric);
    },
  );
}

import { syncRequestSchema, syncRunSchema } from '@hub/contracts';
import { beginSync, type Config, executeSync, type GarminRequestGate } from '@hub/core';
import type { Store } from '@hub/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParams, jsonSchema, response } from './schemas.ts';

export function registerSyncRoutes(
  routes: FastifyInstance,
  store: Store,
  config: Config,
  shutdown: AbortSignal,
  requestGate: GarminRequestGate,
) {
  routes.get(
    '/sync-runs',
    {
      schema: {
        querystring: jsonSchema(
          z
            .object({
              limit: z.coerce.number().int().min(1).max(100).default(50),
              offset: z.coerce.number().int().min(0).default(0),
            })
            .strict(),
        ),
        response: response(z.array(syncRunSchema)),
      },
    },
    async (request) => {
      const query = z
        .object({ limit: z.coerce.number().default(50), offset: z.coerce.number().default(0) })
        .parse(request.query);

      return store.syncHistory(query.limit, query.offset);
    },
  );

  routes.post(
    '/sync-runs',
    {
      schema: {
        body: jsonSchema(syncRequestSchema),
        response: {
          ...response(syncRunSchema),
          429: jsonSchema(
            z.object({
              error: z.literal('GARMIN_RATE_LIMITED'),
              cooldown_until: z.iso.datetime().nullable(),
            }),
          ),
          409: jsonSchema(z.object({ error: z.string(), active: syncRunSchema.nullable() })),
        },
      },
    },
    async (request, reply) => {
      if (!config.apiKey) throw new Error('CREDENTIALS_NOT_CONFIGURED');

      const input = syncRequestSchema.parse(request.body);
      requestGate.assertAvailable();
      const run = await beginSync(store, input, config.timezone);
      const disconnected = new AbortController();
      const cancel = () => {
        if (!reply.raw.writableFinished) disconnected.abort();
      };

      reply.raw.on('close', cancel);

      try {
        return await executeSync(store, config, run.id, {
          gate: requestGate,
          signal: AbortSignal.any([shutdown, disconnected.signal]),
        });
      } finally {
        reply.raw.off('close', cancel);
      }
    },
  );

  routes.get(
    '/sync-runs/:id',
    { schema: { params: jsonSchema(idParams) } },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);

      const run = await store.syncRun(id);

      return run
        ? { run, issues: await store.issues(id) }
        : reply.code(404).send({ error: 'NOT_FOUND' });
    },
  );
}

import { type SyncRun, syncRequestSchema, syncRunSchema } from '@hub/contracts';
import type { Store } from '@hub/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SyncManager } from '../manager.ts';
import { idParams, jsonSchema, response } from './schemas.ts';

export function registerSyncRoutes(
  routes: FastifyInstance,
  store: Store,
  manager: SyncManager,
  streams: Set<() => void>,
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
        response: { 202: jsonSchema(syncRunSchema) },
      },
    },
    async (request, reply) => {
      const run = await manager.start(syncRequestSchema.parse(request.body));

      return reply.code(202).send(run);
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

  routes.get(
    '/sync-runs/:id/events',
    { schema: { params: jsonSchema(idParams) } },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const initial = await store.syncRun(id);

      if (!initial) return reply.code(404).send({ error: 'NOT_FOUND' });

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      let closed = false;

      const send = (run: SyncRun) => {
        if (closed) return;

        if (!reply.raw.write(`event: progress\ndata: ${JSON.stringify(run)}\n\n`)) {
          cleanup();
          return;
        }

        if (run.status !== 'running') cleanup();
      };

      const heartbeat = setInterval(() => {
        if (!closed && !reply.raw.write(': heartbeat\n\n')) cleanup();
      }, 15000);

      const cleanup = () => {
        if (closed) return;

        closed = true;
        clearInterval(heartbeat);
        manager.events.off(id, send);
        streams.delete(cleanup);
        reply.raw.end();
      };

      streams.add(cleanup);
      manager.events.on(id, send);
      reply.raw.on('close', cleanup);

      // Register first, then re-read to avoid losing a terminal event while connecting.
      send((await store.syncRun(id)) ?? initial);
    },
  );
}

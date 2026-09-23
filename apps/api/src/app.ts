import {
  healthQuerySchema,
  healthSummarySchema,
  healthValueSchema,
  intervalSchema,
  pageSchema,
  rangeSchema,
  runSchema,
  runSummarySchema,
  type SyncRun,
  statusSchema,
  syncRequestSchema,
  syncRunSchema,
  validateRange,
} from '@hub/contracts';
import {
  type Config,
  dataStatus,
  isAllowedRequest,
  logger,
  SyncBusyError,
  summarizeHealth,
  summarizeRuns,
} from '@hub/core';
import type { Store } from '@hub/db';
import Fastify, { LogController } from 'fastify';
import { z } from 'zod';
import { SyncManager } from './manager.ts';

const jsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' });
const pageResult = (schema: z.ZodType) =>
  z.object({ items: z.array(schema), total: z.number(), limit: z.number(), offset: z.number() });
const idParams = z.object({ id: z.string().uuid() }).strict();
const response = (schema: z.ZodType): Record<string, object> => ({
  200: jsonSchema(schema),
  '4xx': jsonSchema(z.object({ error: z.string() })),
  '5xx': jsonSchema(z.object({ error: z.string() })),
});

export function buildApp(store: Store, config: Config, manager = new SyncManager(store, config)) {
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 65536,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const streams = new Set<() => void>();
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/healthz') return;
    if (!isAllowedRequest(config, request.headers.host, request.headers.origin))
      return reply.code(403).send({ error: 'ORIGIN_NOT_ALLOWED' });
    if (
      request.method === 'POST' &&
      !request.headers['content-type']?.startsWith('application/json')
    )
      return reply.code(415).send({ error: 'JSON_REQUIRED' });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SyncBusyError) {
      void store
        .activeSync()
        .then((active) => reply.code(409).send({ error: 'SYNC_BUSY', active }));
      return;
    }
    const e = error as Error & { validation?: unknown; statusCode?: number };
    if (e.message === 'CREDENTIALS_NOT_CONFIGURED')
      return reply.code(503).send({ error: e.message });
    if (
      e instanceof z.ZodError ||
      e.validation ||
      e.message.startsWith('Date range') ||
      e.message.startsWith('Future dates')
    )
      return reply.code(400).send({ error: 'INVALID_INPUT' });
    if (e.statusCode && e.statusCode < 500)
      return reply.code(e.statusCode).send({ error: 'INVALID_REQUEST' });
    logger.error({ code: 'API_FAILURE' }, 'Request failed');
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });
  app.get('/healthz', async () => {
    await store.assertReady();
    return { status: 'ok' };
  });
  app.register(
    async (routes) => {
      routes.get('/status', { schema: { response: response(statusSchema) } }, () =>
        dataStatus(store, config.timezone),
      );
      routes.get(
        '/runs',
        {
          schema: {
            querystring: jsonSchema(pageSchema),
            response: response(pageResult(runSchema)),
          },
        },
        async (request) => {
          const q = pageSchema.parse(request.query);
          validateRange(q);
          return store.listRuns(q, q.limit, q.offset);
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
      routes.get(
        '/health',
        {
          schema: {
            querystring: jsonSchema(healthQuerySchema),
            response: response(pageResult(healthValueSchema)),
          },
        },
        async (request) => {
          const q = healthQuerySchema.parse(request.query);
          validateRange(q);
          return store.listHealth(q, q.metric, q.limit, q.offset);
        },
      );
      routes.get(
        '/summaries/runs',
        { schema: { querystring: jsonSchema(rangeSchema), response: response(runSummarySchema) } },
        async (request) => summarizeRuns(store, validateRange(rangeSchema.parse(request.query))),
      );
      const healthSummaryQuery = rangeSchema.extend({ metric: healthQuerySchema.shape.metric });
      routes.get(
        '/summaries/health',
        {
          schema: {
            querystring: jsonSchema(healthSummaryQuery),
            response: response(healthSummarySchema),
          },
        },
        async (request) => {
          const q = healthSummaryQuery.parse(request.query);
          return summarizeHealth(store, validateRange(q), q.metric);
        },
      );
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
          const q = z
            .object({ limit: z.coerce.number().default(50), offset: z.coerce.number().default(0) })
            .parse(request.query);
          return store.syncHistory(q.limit, q.offset);
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
    },
    { prefix: '/api' },
  );
  app.addHook('preClose', async () => {
    for (const close of streams) close();
  });
  app.addHook('onClose', async () => {
    await manager.close();
  });
  return app;
}

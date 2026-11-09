import { statusSchema } from '@hub/contracts';
import { type Config, dataStatus, isAllowedRequest, logger, SyncBusyError } from '@hub/core';
import type { Store } from '@hub/db';
import Fastify, { LogController } from 'fastify';
import { z } from 'zod';
import { SyncManager } from './manager.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerRunsRoutes } from './routes/runs.ts';
import { response } from './routes/schemas.ts';
import { registerSummariesRoutes } from './routes/summaries.ts';
import { registerSyncRoutes } from './routes/sync.ts';

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

  app.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof SyncBusyError) {
      const active = await store.activeSync();

      return reply.code(409).send({ error: 'SYNC_BUSY', active });
    }

    const requestError = error as Error & { validation?: unknown; statusCode?: number };

    if (['CREDENTIALS_NOT_CONFIGURED', 'API_CLOSING'].includes(requestError.message))
      return reply.code(503).send({ error: requestError.message });

    if (
      requestError instanceof z.ZodError ||
      requestError.validation ||
      requestError.message.startsWith('Date range') ||
      requestError.message.startsWith('Future dates')
    )
      return reply.code(400).send({ error: 'INVALID_INPUT' });

    if (requestError.statusCode && requestError.statusCode < 500)
      return reply.code(requestError.statusCode).send({ error: 'INVALID_REQUEST' });

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

      registerRunsRoutes(routes, store);
      registerHealthRoutes(routes, store);
      registerSummariesRoutes(routes, store);
      registerSyncRoutes(routes, store, manager, streams);
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

import { type Config, isAllowedRequest, logger } from '@hub/core';
import Fastify, { LogController } from 'fastify';
import { z } from 'zod';

export function buildApp(config: Config) {
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 65536,
  });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/healthz') return;
    if (!isAllowedRequest(config, request.headers.host, request.headers.origin)) {
      return reply.code(403).send({ error: 'ORIGIN_NOT_ALLOWED' });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: 'INVALID_REQUEST' });
    logger.error({ code: 'API_FAILURE' }, 'Request failed');
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get(
    '/api/status',
    {
      schema: {
        response: {
          200: z.toJSONSchema(z.object({ data_available: z.literal(false) }), {
            target: 'draft-7',
          }),
        },
      },
    },
    async () => ({ data_available: false }),
  );
  return app;
}

import { type Config, isAllowedRequest, logger } from '@hub/core';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import Fastify, { LogController } from 'fastify';
import { createMcpServer } from './tools.ts';

export function buildMcpApp(config: Config) {
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 65536,
  });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/healthz') return;
    if (!isAllowedRequest(config, request.headers.host, request.headers.origin))
      return reply.code(403).send({ error: 'ORIGIN_NOT_ALLOWED' });
  });
  app.get('/healthz', async () => {
    return { status: 'ok' };
  });
  app.post('/mcp', async (request, reply) => {
    const server = createMcpServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.raw.once('close', () => {
      void server
        .close()
        .catch(() => logger.warn({ code: 'MCP_CLOSE_FAILED' }, 'MCP close failed'));
    });
    try {
      await server.connect(transport);
      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch {
      logger.error({ code: 'MCP_REQUEST_FAILED' }, 'MCP request failed');
      if (!reply.raw.headersSent)
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32603, message: 'Internal error' },
          }),
        );
      else reply.raw.end();
      await server.close();
    }
  });
  app.route({
    method: ['GET', 'DELETE'],
    url: '/mcp',
    handler: async (_request, reply) =>
      reply.header('Allow', 'POST').code(405).send({ error: 'Stateless MCP uses POST' }),
  });
  return app;
}

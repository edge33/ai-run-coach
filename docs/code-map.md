# Code map

- `apps/api/src/app.ts`: health and unavailable-data status routes, host/origin validation.
- `apps/mcp/src/tools.ts`: the five athlete-wiki tools and bounded responses.
- `apps/mcp/src/app.ts`, `http.ts`, `stdio.ts`: MCP transports and startup.
- `apps/web/src/App.tsx`: the unavailable-measurements screen.
- `packages/core/src/wiki.ts`: Markdown facts, provenance, revisions, confirmation and locking.
- `packages/core/src/config.ts`: wiki paths, origins, hosts and logging.
- `packages/contracts/src/index.ts`: shared wiki validation.
- `packages/config`: shared TypeScript settings.
- `compose.yaml`, `Dockerfile`, `deploy/nginx.conf`: application shell deployment.

There is no data provider, application database, migration system, or synchronization pipeline.

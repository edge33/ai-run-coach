FROM node:26.13.0-bookworm-slim AS base
COPY --from=ghcr.io/pnpm/pnpm:12.18.0 /opt/pnpm /opt/pnpm
RUN ln -s /opt/pnpm/pnpm /usr/local/bin/pnpm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json biome.json ./
COPY packages ./packages
COPY apps ./apps

FROM base AS dependencies
RUN pnpm install --frozen-lockfile

FROM dependencies AS web-build
RUN pnpm --filter @hub/web build

FROM base AS production-dependencies
RUN pnpm install --prod --frozen-lockfile

FROM node:26.13.0-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 MCP_PORT=3001
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/packages ./packages
COPY --from=production-dependencies --chown=node:node /app/apps/api ./apps/api
COPY --from=production-dependencies --chown=node:node /app/apps/mcp ./apps/mcp
COPY --from=production-dependencies --chown=node:node /app/package.json ./package.json
COPY --chown=node:node scripts/migrate.ts ./scripts/migrate.ts
RUN mkdir -p /app/data/db /app/athlete_wiki && chown -R node:node /app/data /app/athlete_wiki
USER node
EXPOSE 3000 3001
CMD ["node", "apps/api/src/server.ts"]

FROM nginx:1.28.0-alpine AS proxy
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

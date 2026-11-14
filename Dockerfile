FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS base
COPY --from=ghcr.io/pnpm/pnpm:12.21.0 /opt/pnpm /opt/pnpm
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

FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS runtime
ENV NODE_ENV=production HOST=127.0.0.1 PORT=3000 MCP_PORT=3001 \
    SQLITE_PATH=/app/data/db/coach.sqlite WIKI_PATH=/app/data/athlete_wiki
RUN apt-get update && apt-get install -y --no-install-recommends nginx tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/packages ./packages
COPY --from=production-dependencies --chown=node:node /app/apps/api ./apps/api
COPY --from=production-dependencies --chown=node:node /app/apps/mcp ./apps/mcp
COPY --from=production-dependencies --chown=node:node /app/package.json ./package.json
COPY --chown=node:node scripts/initialize.ts ./scripts/initialize.ts
RUN mkdir -p /app/data/db /app/data/athlete_wiki && chown -R node:node /app/data
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --chown=node:node deploy/start.sh deploy/healthcheck.ts ./deploy/
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
USER node
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "deploy/healthcheck.ts"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "deploy/start.sh"]

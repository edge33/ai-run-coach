FROM node:26.13.1-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9 AS base
COPY --from=ghcr.io/pnpm/pnpm:12.23.0@sha256:349c846c6c9dab76b2f6fbf4b2df14d5a8c9b2a0fce92fc7e5c2eec3f437e801 /opt/pnpm /opt/pnpm
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

FROM node:26.13.1-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9 AS runtime
ENV NODE_ENV=production HOST=127.0.0.1 PORT=3000 MCP_PORT=3001 \
    SQLITE_PATH=/app/data/db/coach.sqlite WIKI_PATH=/app/data/athlete_wiki
RUN apt-get update && apt-get install -y --no-install-recommends nginx tini util-linux && rm -rf /var/lib/apt/lists/*
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
COPY deploy/entrypoint.sh ./deploy/entrypoint.sh
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "deploy/healthcheck.ts"]
ENTRYPOINT ["/usr/bin/tini", "--", "bash", "/app/deploy/entrypoint.sh"]
CMD ["bash", "deploy/start.sh"]

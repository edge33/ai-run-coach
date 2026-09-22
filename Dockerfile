FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json turbo.json biome.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 MCP_PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api ./apps/api
COPY --from=build --chown=node:node /app/apps/mcp ./apps/mcp
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /app/data/db /app/data/snapshots /app/athlete_wiki && chown -R node:node /app/data /app/athlete_wiki
USER node
EXPOSE 3000 3001
CMD ["node", "apps/api/src/server.ts"]

FROM nginx:1.28.0-alpine AS proxy
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

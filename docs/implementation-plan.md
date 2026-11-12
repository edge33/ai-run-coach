# Running Data Hub: clean starting point

The legacy Intervals.icu implementation has been retired. This change deliberately leaves a
working application shell before the Garmin integration is introduced in a separate PR.

## Retained behavior

- Vite/React displays an explicit unavailable state for running and wellness measurements.
- Fastify serves `/healthz` and `/api/status` (`data_available: false`). Removed data and
  synchronization endpoints return 404.
- MCP supports the athlete wiki through stdio and Streamable HTTP: context, page reads,
  user facts, proposed changes, and confirmed changes. Provenance and conflict handling remain.
- Host/origin validation, sanitized errors, Docker/Nginx deployment, and CI remain.

## Removed behavior

The old provider client, ingestion, summaries, samples, run/health contracts and screens,
data MCP tools, database package, all SQL migrations, migration command, database volumes,
and provider configuration are removed. No compatibility schema or upgrade path is retained.
There is no application database in this intermediate version.

## Next step

Merge the cleanup PR, then implement Garmin-only activity, lap, sample, and wellness ingestion
on the fresh base. Use Garmin terminology. SQLite remains the selected storage engine for
that future implementation, including stored summaries. Keep upstream synchronization manual
and read-only; app and MCP reads must not synchronize. Imports require explicit dates.

Do not deploy this intermediate version expecting activity data. Removing a Compose volume
reference does not delete an existing deployment volume; resetting deployed athlete data is a
separate operation. Never remove the athlete wiki as part of a database reset.

## Local operation

Use Node 26.13.0 and pnpm 12.18.0. Run `pnpm install --frozen-lockfile`, copy `.env.example`
to ignored `.env`, and run `pnpm run dev`. No database bootstrap is needed. Vite uses port
5173, API 3000, and HTTP MCP 3001. `pnpm run mcp` starts stdio MCP. Configure `WIKI_PATH`
and `APP_ORIGINS` as needed. Compose serves the app on port 8080 using `BIND_IP`.

Keep credentials, athlete wiki, databases, and raw data out of Git and image layers.

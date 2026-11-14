# Running Data Hub

A self-hosted hub for your Garmin runs and daily health data. Browse your records in the web UI
or give an MCP-connected agent access to the same local data and a private athlete wiki.

Imports are manual: choose dates and click **Sync**. Reading data, starting the app, or calling
MCP never contacts Garmin. Coaching and training plans stay with your agent.

## Run with Docker

The app uses one container, port `8080`, and one host directory mounted at `/app/data`.
That directory holds SQLite and the athlete wiki and survives container replacement.

See [Docker, storage and reverse proxy setup](docs/storage.md) for Compose examples and
[releases](docs/releases.md) for GHCR publishing. The first registry release is still pending.

## Develop locally

Use the Node version in `.nvmrc` and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
```

Set `GARMIN_API_KEY` in `.env`, then initialize the local database and start the app:

```sh
pnpm run db:init
pnpm run dev
```

Open the Vite URL printed in the terminal, normally `http://localhost:5173`.
Initialization preserves existing data. Import dates must be explicit, no later than today,
and span at most 90 days. Date selection controls imports; the lists show all stored records.

## Checks

```sh
pnpm run check
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

The PR workflow runs these checks. Container validation is manual and uses disposable data.
Keep `.env`, databases, athlete wiki content and other personal files out of Git and images.

## Dependency updates

[Enable the Renovate app](https://github.com/apps/renovate) for this repository, then merge
`renovate.json`. It opens reviewable PRs for pnpm packages/lockfiles, Docker images and GitHub
Actions. Node, pnpm and Biome pins are grouped; automerge is off. Weekly lockfile maintenance
keeps indirect dependencies current. Renovate proposes SHA-256 digest pins for registry images
and keeps them updated. The Compose `running-data-hub:local` image is excluded.

Runtime dependency and Dockerfile updates use `fix:` titles for Release Please. Keep that prefix
when merging; check Node/pnpm versions together and run manual image validation for Docker changes.

## Documentation

- [Architecture](docs/architecture.md): components, imports and failure handling.
- [Measurements](docs/run-analysis-data.md): what the stored values mean and their limitations.
- [Storage and deployment](docs/storage.md): Docker, persistence and Nginx Proxy Manager.
- [Releases](docs/releases.md): Release Please, tags and GHCR setup.
- [Current work](docs/progress.md): unfinished work, validation and next steps.

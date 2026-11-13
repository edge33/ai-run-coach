# Persistent storage

All application-owned persistent files live under `data/` by default:

- `data/db/coach.sqlite`, including SQLite WAL/SHM sidecars.
- `data/athlete_wiki/`, including Markdown pages, revisions, pending proposals and write locks.

Native commands resolve these paths from the repository root. Copy `.env.example` to `.env`
and configure the Garmin key and origins there. Credentials remain in environment configuration,
not in the data directory or image. `data/` is excluded from Git and the Docker build context.
`SQLITE_PATH` and `WIKI_PATH` remain available for explicit path overrides.
Import staging is disposable temporary storage and is removed when the import ends.

## Runtime image

Bind-mount one host directory at `/app/data` in every runtime container
(initializer, API and MCP). The image defaults are `/app/data/db/coach.sqlite` and
`/app/data/athlete_wiki`; no path overrides are needed. The root `compose.yaml` demonstrates
this with `${DATA_PATH:-./data}:/app/data`. By default, files are stored in the repository's
`data/` directory on the host. Set `DATA_PATH=/srv/running-data-hub/data` in `.env` to choose
an absolute host location; this setting only controls Compose, not native commands.

Create the selected host directory before starting containers and make it writable by the
image's `node` user (UID/GID 1000:1000). For the default path, run from the repository root:

```sh
mkdir -p data
sudo chown -R 1000:1000 data
```

For an absolute host location, the resolved mount in each runtime service is:

```yaml
volumes:
  - /srv/running-data-hub/data:/app/data
```

Run `node scripts/initialize.ts` once using the runtime image and the same mount before starting
API/MCP. Initialization is idempotent and never imports Garmin data. Preserve the mount across
container replacements. The proxy image serves static assets and needs no data mount.

## Existing installations

Stop API/MCP and any other database/wiki writers before moving files. Move the existing database
and any WAL/SHM sidecars into `data/db/`, and the contents of the old `athlete_wiki/` directory
into `data/athlete_wiki/`. Update an existing ignored `.env` if it still sets
`WIKI_PATH=athlete_wiki`. Personal MCP configuration may also contain an old path override.

Earlier Compose setups used separate `database` and `wiki` volumes. Copy their contents into
`db/` and `athlete_wiki/` respectively in the selected host directory before starting the updated
services. Changing the Compose configuration does not copy old volumes automatically. Keep the
old volumes until the transferred data has been verified; do not use `down -v` on a real stack.

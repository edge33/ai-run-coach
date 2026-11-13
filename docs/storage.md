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

Bind-mount one host directory at `/app/data` in the single `hub` container. The image defaults
are `/app/data/db/coach.sqlite` and `/app/data/athlete_wiki`; no path overrides are needed. The root `compose.yaml` demonstrates
this with `${DATA_PATH:-./data}:/app/data`. By default, files are stored in the repository's
`data/` directory on the host. Set `DATA_PATH=/srv/running-data-hub/data` in `.env` to choose
an absolute host location; this setting only controls Compose, not native commands.

Create the selected host directory before starting containers and make it writable by the
image's `node` user (UID/GID 1000:1000). For the default path, run from the repository root:

```sh
mkdir -p data
sudo chown -R 1000:1000 data
```

A bind mount hides the image directory and its ownership. If the host path does not exist,
Compose may create it as root; the non-root initializer then fails with `EACCES` creating
`/app/data/db`. Prepare ownership on the host first, including in CI.

For an absolute host location, the resolved mount is:

```yaml
volumes:
  - /srv/running-data-hub/data:/app/data
```

The default container command initializes SQLite before starting Nginx, API and MCP. Initialization
is idempotent, preserves existing records and never imports Garmin data. A failure exits the
container before services start. Native development still uses `pnpm run db:init` explicitly.
Preserve the mount across container replacements. No separate initializer or proxy image is needed.

## Published image

Build the default Dockerfile target and publish that one image to your chosen registry. Consumers
can use the following Compose shape (replace the illustrative image reference with your release):

```yaml
services:
  hub:
    image: ghcr.io/YOUR_OWNER/running-data-hub:YOUR_TAG
    restart: unless-stopped
    environment:
      APP_ORIGINS: https://aicoach.bl
      GARMIN_API_KEY: ${GARMIN_API_KEY}
      ATHLETE_TIMEZONE: Europe/Rome
    volumes:
      - ./data:/app/data
    ports:
      - "8080:8080"
    stop_grace_period: 30s
```

Nginx Proxy Manager forwards the configured hostname to this container on port 8080. If both
containers share a Docker network, point NPM at `hub:8080`; the host `ports` mapping can then be
omitted. With host forwarding, publish 8080 on an interface reachable by NPM. `APP_ORIGINS` must
match the browser URL, including scheme and any nonstandard port. Forward the original Host
header and disable proxy buffering for MCP streaming. The internal proxy already disables
buffering and preserves `/api` and `/mcp`; its read timeout remains 300 seconds.

The image runs as UID/GID 1000:1000 and exposes only 8080. API and MCP bind to loopback on
3000/3001. Tini and the startup wrapper forward termination and stop the container if any required
service exits. The image health check requires the web UI, API and MCP to respond; Docker marks
unhealthy containers but restart policy restarts on process exit, not on health status alone.
Logs go to stdout/stderr. An unhealthy result needs investigation if processes remain alive.

## Existing installations

Stop API/MCP and any other database/wiki writers before moving files. Move the existing database
and any WAL/SHM sidecars into `data/db/`, and the contents of the old `athlete_wiki/` directory
into `data/athlete_wiki/`. Update an existing ignored `.env` if it still sets
`WIKI_PATH=athlete_wiki`. Personal MCP configuration may also contain an old path override.

Earlier Compose setups used separate `database` and `wiki` volumes. Copy their contents into
`db/` and `athlete_wiki/` respectively in the selected host directory before starting the updated
services. Changing the Compose configuration does not copy old volumes automatically. Keep the
old volumes until the transferred data has been verified; do not use `down -v` on a real stack.

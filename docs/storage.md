# Storage and deployment

The app runs as one container on port 8080. Mount a host directory at `/app/data` to keep:

- `db/coach.sqlite` and SQLite WAL/SHM files.
- `athlete_wiki/`, including pages, revisions and pending proposals.

On startup, the entrypoint runs as root, creates the database/wiki directories and recursively
sets ownership of `/app/data` to UID/GID 1000:1000. It then switches to the `node` user before
initializing SQLite and starting API, MCP and Nginx. Docker can create a missing host directory;
no manual `mkdir` or `chown` is needed for a normal local bind mount.

Existing mounted files also become owned by 1000:1000. On mounts that reject ownership changes
(such as some NFS/SMB shares), prepare access to the data directory on the host and set Compose
`user: "1000:1000"` to skip ownership setup. Any explicit non-root `user:` override skips setup
and requires writable data paths. Custom `SQLITE_PATH`/`WIKI_PATH` locations outside `/app/data`
must also be prepared separately.
Keep credentials in environment configuration. Data and `.env` are excluded from Git and images.

## Compose with a published image

After the [first release](releases.md), replace `YOUR_TAG` with a published version:

```yaml
services:
  hub:
    image: ghcr.io/edge33/ai-run-coach:YOUR_TAG
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

Startup initializes missing schema objects without deleting existing records or contacting Garmin.
An incompatible schema stops startup. Keep the mount when replacing or upgrading containers.
Logs go to stdout/stderr; the image includes a web/API/MCP health check.

For a source build, use the repository's `compose.yaml`. Copy `.env.example` to `.env`, set the
Garmin key, then run:

```sh
APP_ORIGINS=http://127.0.0.1:8080 docker compose up --build -d
```

This setup binds to loopback by default. Set `BIND_IP` to an interface reachable by your proxy
if needed. `DATA_PATH` selects the host directory (default `./data`, relative to Compose).
Native development uses `data/` under the repository root; `SQLITE_PATH` and `WIKI_PATH` override
its database/wiki paths. `DATA_PATH` affects Compose only.

## Nginx Proxy Manager

Forward your hostname to the app's port 8080. On a shared Docker network, use `hub:8080` and omit
the host port mapping. Otherwise publish the port on an interface NPM can reach.

`APP_ORIGINS` must match the browser URL, including scheme and any nonstandard port. Preserve the
original Host header and disable proxy buffering for MCP streaming. The internal proxy routes
`/api` and `/mcp` and has a 300-second read timeout. Origin checks are not authentication.

## Moving existing data

Stop all writers first. Put the database and any WAL/SHM sidecars in `data/db/`, and the old wiki
contents in `data/athlete_wiki/`. Update old `WIKI_PATH=athlete_wiki` overrides, including any
personal MCP configuration. Earlier `database`/`wiki` named volumes need copying to those host
subdirectories; Compose does not move them automatically. Retain the originals until verified.

`docker compose down` preserves bind-mounted files. Do not use `down -v` on installations that
still hold data in named volumes. There is no built-in backup system.

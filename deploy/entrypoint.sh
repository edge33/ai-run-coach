#!/bin/bash
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  # Bind mounts hide the ownership prepared during the image build.
  mkdir -p /app/data/db /app/data/athlete_wiki
  if ! chown -R node:node /app/data; then
    echo "Cannot prepare /app/data ownership. Make the mount writable by UID/GID 1000:1000 and run with --user 1000:1000." >&2
    exit 1
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

# An explicit non-root user must already have access to the mounted data.
exec "$@"

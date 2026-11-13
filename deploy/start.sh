#!/bin/bash
set -euo pipefail

pids=()
nginx_pid=""

shutdown() {
  trap '' TERM INT
  if [[ -n "$nginx_pid" ]]; then
    kill -QUIT "$nginx_pid" 2>/dev/null || true
  fi
  for pid in "${pids[@]}"; do
    if [[ "$pid" != "$nginx_pid" ]]; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  # Bound shutdown even if a child cannot finish closing its connections.
  (
    sleep 25
    kill -KILL "${pids[@]}" 2>/dev/null || true
  ) &
  local deadline=$!
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  kill -KILL "$deadline" 2>/dev/null || true
  wait "$deadline" 2>/dev/null || true
}

trap 'shutdown; exit 0' TERM INT

# Initialization is idempotent and local; failure prevents all services from starting.
node scripts/initialize.ts &
pids=($!)
wait "${pids[0]}"
pids=()

node apps/api/src/server.ts &
pids+=($!)
node apps/mcp/src/http.ts &
pids+=($!)
nginx -g 'daemon off;' &
nginx_pid=$!
pids+=("$nginx_pid")

status=0
wait -n "${pids[@]}" || status=$?
echo "A required service exited; stopping the container." >&2
shutdown
# A clean but unexpected child exit is also a container failure.
if [[ "$status" -eq 0 ]]; then status=1; fi
exit "$status"

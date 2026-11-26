#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_VERSION:?Set the version from the candidate tag}"
image="madar-nrcs:$RELEASE_VERSION"
name="madar-smoke-${GITHUB_RUN_ID:-$$}"
volume="$name-data"
credentials="$(mktemp)"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -f "$credentials"
}
trap cleanup EXIT

docker build --tag "$image" .
docker volume create "$volume" >/dev/null
start() {
  docker run -d --name "$name" -p 127.0.0.1::3000 -v "$volume:/data" \
    -e ADMIN_EMAIL=container-check@example.com -e ADMIN_PASSWORD=InitialContainer2026 \
    -e COOKIE_SECURE=false -e SEED_DEMO_DATA=false -e WIRE_POLL_MINUTES=0 \
    -e SESSION_SECRET=disposable-container-smoke-session-2026 -e BACKUP_INTERVAL_HOURS=0 "$image" >/dev/null
  address="$(docker port "$name" 3000/tcp | head -n 1)"
  endpoint="http://$address"
  for attempt in {1..60}; do
    if curl --max-time 2 -fsS "$endpoint/api/ready" >/dev/null 2>&1; then
      curl -fsS "$endpoint/api/health" | RELEASE_VERSION="$RELEASE_VERSION" node -e '
        const health = JSON.parse(require("node:fs").readFileSync(0));
        if (health.version !== process.env.RELEASE_VERSION) process.exit(1);
      '
      return
    fi
    sleep 1
  done
  docker logs "$name"
  return 1
}

start
curl -fsS -c "$credentials" -H 'X-NRCS-Client: web' -H 'Content-Type: application/json' \
  -d '{"email":"container-check@example.com","password":"InitialContainer2026"}' "$endpoint/api/v1/auth/login" >/dev/null
curl -fsS -b "$credentials" -H 'X-NRCS-Client: web' -H 'Content-Type: application/json' \
  -d '{"currentPassword":"InitialContainer2026","newPassword":"RotatedContainer2026"}' "$endpoint/api/v1/auth/change-password" >/dev/null
docker stop "$name" >/dev/null
docker rm "$name" >/dev/null
start
curl -fsS -H 'X-NRCS-Client: web' -H 'Content-Type: application/json' \
  -d '{"email":"container-check@example.com","password":"RotatedContainer2026"}' "$endpoint/api/v1/auth/login" >/dev/null

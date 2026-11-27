#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_VERSION:?Set the version from the candidate tag}"
image="madar-nrcs:$RELEASE_VERSION"
name="madar-smoke-${GITHUB_RUN_ID:-$$}"
fixture="$(mktemp -d)"
export MADAR_IMAGE="$image"
export MADAR_ENV_FILE="$fixture/app.env"
export MADAR_BIND_PORT=0
export MADAR_POSTGRES_PASSWORD="$(openssl rand -hex 24)"
export MADAR_POSTGRES_ADMIN_PASSWORD="$(openssl rand -hex 24)"
credentials="$fixture/cookies"
project="$name-pg"
compose_files=(-f docker-compose.yml -f docker-compose.postgres.yml)

compose() {
  docker compose --project-name "$project" --env-file "$MADAR_ENV_FILE" "${compose_files[@]}" "$@"
}

cleanup() {
  project="$name-pg" compose down --volumes >/dev/null 2>&1 || true
  compose_files=(-f docker-compose.yml)
  project="$name-sqlite" compose down --volumes >/dev/null 2>&1 || true
  rm -rf -- "$fixture"
}
trap cleanup EXIT

cat > "$MADAR_ENV_FILE" <<'EOF'
ADMIN_EMAIL=container-check@example.com
ADMIN_PASSWORD=InitialContainer2026
COOKIE_SECURE=false
SEED_DEMO_DATA=false
WIRE_POLL_MINUTES=0
SESSION_SECRET=disposable-container-smoke-session-2026
BACKUP_INTERVAL_HOURS=0
EOF

docker build --tag "$image" .
start() {
  compose up --detach --no-build --wait --wait-timeout 90 "$@" || {
    compose logs nrcs
    return 1
  }
  endpoint="http://$(compose port nrcs 3000)"
  curl -fsS "$endpoint/api/ready" >/dev/null
  curl -fsS "$endpoint/api/health" | RELEASE_VERSION="$RELEASE_VERSION" node -e '
    const health = JSON.parse(require("node:fs").readFileSync(0));
    if (health.version !== process.env.RELEASE_VERSION) process.exit(1);
  '
}

login() {
  local password="$1"
  curl -fsS -c "$credentials" -H 'X-NRCS-Client: web' -H 'Content-Type: application/json' \
    -d "{\"email\":\"container-check@example.com\",\"password\":\"$password\"}" "$endpoint/api/v1/auth/login" >/dev/null
}

change_password() {
  login InitialContainer2026
  curl -fsS -b "$credentials" -H 'X-NRCS-Client: web' -H 'Content-Type: application/json' \
    -d '{"currentPassword":"InitialContainer2026","newPassword":"RotatedContainer2026"}' "$endpoint/api/v1/auth/change-password" >/dev/null
}

assert_engine() {
  login RotatedContainer2026
  curl -fsS -b "$credentials" "$endpoint/api/v1/db/engine" | EXPECTED_ENGINE="$1" node -e '
    const engine = JSON.parse(require("node:fs").readFileSync(0)).data.active;
    if (engine !== process.env.EXPECTED_ENGINE) throw new Error("Unexpected database engine: " + engine);
  '
}

start
for private_asset in server.cjs server.cjs.map assets/example.js.map; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$endpoint/$private_asset")"
  test "$code" = "404"
done
curl -fsS "$endpoint/news" >/dev/null
curl -fsS "$endpoint/offline-air.html" >/dev/null
change_password
assert_engine postgresql
test "$(compose exec -T postgres psql -U postgres -d madar -Atc "SELECT rolsuper FROM pg_roles WHERE rolname = 'madar'")" = f
start --force-recreate
assert_engine postgresql

# An upgrade reuses the stored SQLite choice, even with the new image default.
project="$name-sqlite"
compose_files=(-f docker-compose.yml)
printf '\nDATABASE_ENGINE=sqlite\n' >> "$MADAR_ENV_FILE"
start
change_password
assert_engine sqlite
sed -i '/^DATABASE_ENGINE=sqlite$/d' "$MADAR_ENV_FILE"
start --force-recreate
assert_engine sqlite

#!/bin/sh
(
  set -eu
  psql --no-psqlrc --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password MADAR_POSTGRES_PASSWORD
CREATE ROLE madar LOGIN PASSWORD :'app_password';
ALTER DATABASE madar OWNER TO madar;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
)

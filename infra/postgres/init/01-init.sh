#!/usr/bin/env bash
# Runs once when the Postgres data directory is first initialized.
# One role + one database per application; app containers never get the superuser.
set -euo pipefail

create_app_db() {
  local name="$1" password="$2"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE ${name} LOGIN PASSWORD '${password}';
CREATE DATABASE ${name} OWNER ${name};
SQL
}

create_app_db directus "$DIRECTUS_DB_PASSWORD"
create_app_db portfolio "$PORTFOLIO_DB_PASSWORD"
create_app_db umami "$UMAMI_DB_PASSWORD"

# pgvector lives only where the API needs it.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname portfolio \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"

#!/usr/bin/env bash
# Read-only login for Grafana's "Newsletter visits per post" panel: SELECT on Umami's
# website_event table and nothing else. Idempotent. It runs as an init script on a fresh
# data directory and again on every deploy (scripts/deploy.sh), which covers the existing
# database, a changed password, and the grant once Umami has created its tables.
# Skipped while GRAFANA_UMAMI_DB_PASSWORD is unset. Must stay executable: the postgres
# entrypoint sources non-executable init scripts, and the exit below would end it.
set -euo pipefail

if [[ -z "${GRAFANA_UMAMI_DB_PASSWORD:-}" ]]; then
  echo "grafana_umami_ro: skipped (GRAFANA_UMAMI_DB_PASSWORD not set)"
  exit 0
fi

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname umami \
  --set=pw="${GRAFANA_UMAMI_DB_PASSWORD}" <<'SQL'
SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_umami_ro') AS missing \gset
\if :missing
CREATE ROLE grafana_umami_ro;
\endif
ALTER ROLE grafana_umami_ro WITH LOGIN CONNECTION LIMIT 3 PASSWORD :'pw';
GRANT CONNECT ON DATABASE umami TO grafana_umami_ro;
-- Owners keep access; only roles without an explicit grant (this one) lose connect.
REVOKE CONNECT ON DATABASE portfolio FROM PUBLIC;
REVOKE CONNECT ON DATABASE directus FROM PUBLIC;
SELECT to_regclass('public.website_event') IS NOT NULL AS has_events \gset
\if :has_events
GRANT SELECT ON public.website_event TO grafana_umami_ro;
\else
\echo 'grafana_umami_ro: website_event does not exist yet; the next deploy grants it'
\endif
SQL
echo "grafana_umami_ro: ok"

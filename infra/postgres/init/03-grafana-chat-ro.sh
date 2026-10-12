#!/usr/bin/env bash
# Read-only login for Grafana's Chat quality dashboard and chat-eval alerts: SELECT on the
# portfolio database's chat_eval_runs and chat_usage_daily tables and nothing else.
# Idempotent. It runs as an init script on a fresh data directory and again on every deploy
# (scripts/deploy.sh, after migrations), which covers the existing database, a changed
# password, and the grants once the API's migrations have created the tables.
# Skipped while GRAFANA_CHAT_DB_PASSWORD is unset. Must stay executable: the postgres
# entrypoint sources non-executable init scripts, and the exit below would end it.
set -euo pipefail

if [[ -z "${GRAFANA_CHAT_DB_PASSWORD:-}" ]]; then
  echo "grafana_chat_ro: skipped (GRAFANA_CHAT_DB_PASSWORD not set)"
  exit 0
fi

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname portfolio \
  --set=pw="${GRAFANA_CHAT_DB_PASSWORD}" <<'SQL'
SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_chat_ro') AS missing \gset
\if :missing
CREATE ROLE grafana_chat_ro;
\endif
ALTER ROLE grafana_chat_ro WITH LOGIN CONNECTION LIMIT 3 PASSWORD :'pw';
GRANT CONNECT ON DATABASE portfolio TO grafana_chat_ro;
-- Owners keep access; only roles without an explicit grant (this one) lose connect.
REVOKE CONNECT ON DATABASE portfolio FROM PUBLIC;
REVOKE CONNECT ON DATABASE directus FROM PUBLIC;
REVOKE CONNECT ON DATABASE umami FROM PUBLIC;
SELECT to_regclass('public.chat_eval_runs') IS NOT NULL
   AND to_regclass('public.chat_usage_daily') IS NOT NULL AS has_tables \gset
\if :has_tables
GRANT SELECT ON public.chat_eval_runs, public.chat_usage_daily TO grafana_chat_ro;
\else
\echo 'grafana_chat_ro: chat tables do not exist yet; the next deploy grants them'
\endif
SQL
echo "grafana_chat_ro: ok"

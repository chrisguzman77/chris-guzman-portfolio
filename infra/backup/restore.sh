#!/usr/bin/env bash
# Restores a backup made by backup.sh into the Postgres server named by PGHOST
# and PGUSER (a superuser; PGPASSWORD, or POSTGRES_PASSWORD), then runs
# verify.sql. Used by the weekly backup-verify workflow and the runbook's
# disaster procedure.
#
#   restore.sh <backup.tar.age> <age identity file>
#
# RESTORE_REPLACE=1          drop and recreate databases that already exist
#                            (restoring onto a freshly deployed stack). Without it
#                            the script refuses before changing anything.
# RESTORE_UPLOADS_DIR=<dir>  also extract the Directus uploads into <dir>.
# VERIFY_SQL=<file>          defaults to verify.sql next to this script.
#
# Never prints decrypted content: only file names, checksum results and counts.
set -euo pipefail

usage="usage: restore.sh <backup.tar.age> <age identity file>"
archive="${1:?${usage}}"
identity="${2:?${usage}}"
: "${PGHOST:?}" "${PGUSER:?}"
export PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:?set PGPASSWORD or POSTGRES_PASSWORD}}"
VERIFY_SQL="${VERIFY_SQL:-$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/verify.sql}"
DATABASES=(directus portfolio umami)

psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }

existing=()
for db in "${DATABASES[@]}"; do
  if [[ -n "$(psql_admin -At -c "SELECT 1 FROM pg_database WHERE datname = '${db}'")" ]]; then
    existing+=("${db}")
  fi
done
if [[ ${#existing[@]} -gt 0 && "${RESTORE_REPLACE:-0}" != 1 ]]; then
  echo "restore: databases already exist (${existing[*]}); set RESTORE_REPLACE=1 to replace them" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

echo "restore: decrypting"
age --decrypt --identity "${identity}" "${archive}" | tar -xf - -C "${work}"

echo "restore: checking manifest checksums"
for f in globals.sql "${DATABASES[@]/%/.dump}" uploads.tar; do
  jq -e --arg f "${f}" 'any(.files[]; .name == $f)' "${work}/manifest.json" >/dev/null \
    || { echo "restore: ${f} missing from manifest" >&2; exit 1; }
done
(cd "${work}" && jq -r '.files[] | "\(.sha256)  \(.name)"' manifest.json | sha256sum -c -)

echo "restore: roles"
# Leave the connecting superuser alone: restoring its production password hash
# would lock this session out of the target server.
grep -vE "^(CREATE|ALTER) ROLE \"?${PGUSER}\"?[ ;]" "${work}/globals.sql" >"${work}/globals.restore.sql"
psql -X -q -d postgres -f "${work}/globals.restore.sql" >/dev/null 2>"${work}/globals.err" || true
if grep -i 'error' "${work}/globals.err" | grep -vq 'already exists'; then
  echo "restore: restoring roles failed:" >&2
  grep -i 'error' "${work}/globals.err" | grep -v 'already exists' >&2
  exit 1
fi

for db in "${DATABASES[@]}"; do
  echo "restore: database ${db}"
  if [[ " ${existing[*]} " == *" ${db} "* ]]; then
    psql_admin -c "DROP DATABASE \"${db}\" WITH (FORCE)"
  fi
  psql_admin -c "CREATE DATABASE \"${db}\" OWNER \"${db}\""
  pg_restore --exit-on-error --dbname "${db}" "${work}/${db}.dump"
done

echo "restore: uploads"
count="$(tar -tf "${work}/uploads.tar" | grep -cv '/$' || true)"
if [[ "${count}" -lt 1 ]]; then
  echo "restore: uploads archive has no files" >&2
  exit 1
fi
echo "restore: uploads archive has ${count} files"
if [[ -n "${RESTORE_UPLOADS_DIR:-}" ]]; then
  tar -xf "${work}/uploads.tar" -C "${RESTORE_UPLOADS_DIR}"
  echo "restore: uploads extracted to ${RESTORE_UPLOADS_DIR}"
fi

echo "restore: verifying"
psql_admin -f "${VERIFY_SQL}"
echo "restore: ok"

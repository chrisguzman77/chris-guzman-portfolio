#!/usr/bin/env bash
# Nightly off-site backup. Dumps Postgres (roles plus the directus, portfolio and
# umami databases) and the Directus uploads into a private temp dir, then streams
# one tar through age (public key only) to R2 via rclone. Runs from supercronic
# at 03:30 America/New_York, or by hand: `make backup-now` on the VM.
#
# Required env: POSTGRES_PASSWORD, BACKUP_AGE_RECIPIENT, R2_BUCKET,
# BACKUP_HEARTBEAT_URL, and an rclone remote named r2 (RCLONE_CONFIG_R2_*).
# Overridable (tests): PGHOST, PGUSER, UPLOADS_DIR, TEXTFILE_DIR, IMAGE_TAG.
#
# Success: writes backup.prom for node-exporter and pings the heartbeat.
# Failure: pings ${BACKUP_HEARTBEAT_URL}/fail and exits 1.
set -Eeuo pipefail

: "${POSTGRES_PASSWORD:?}" "${BACKUP_AGE_RECIPIENT:?}" "${R2_BUCKET:?}" "${BACKUP_HEARTBEAT_URL:?}"
export PGHOST="${PGHOST:-postgres}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${POSTGRES_PASSWORD}"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"
TEXTFILE_DIR="${TEXTFILE_DIR:-/textfile}"
DATABASES=(directus portfolio umami)

ping_heartbeat() { curl -fsS -m 10 --retry 3 -o /dev/null "$1"; }

on_error() {
  echo "backup: FAILED at line $1" >&2
  ping_heartbeat "${BACKUP_HEARTBEAT_URL}/fail" || echo "backup: failure ping failed" >&2
  exit 1
}
trap 'on_error ${LINENO}' ERR

# Plaintext dumps exist only in this 0700 dir, which is removed on every exit.
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

read -r epoch iso yyyy mm dd stamp < <(date -u +'%s %Y-%m-%dT%H:%M:%SZ %Y %m %d %Y%m%dT%H%M%SZ')
dest="r2:${R2_BUCKET}/backups/${yyyy}/${mm}/${dd}/portfolio-${stamp}.tar.age"

echo "backup: dumping roles and databases from ${PGHOST}"
pg_dumpall --globals-only --file "${work}/globals.sql"
files=(globals.sql)
for db in "${DATABASES[@]}"; do
  pg_dump --format=custom --dbname "${db}" --file "${work}/${db}.dump"
  files+=("${db}.dump")
done

echo "backup: archiving uploads from ${UPLOADS_DIR}"
tar -cf "${work}/uploads.tar" -C "${UPLOADS_DIR}" .
files+=(uploads.tar)

for f in "${files[@]}"; do
  printf '%s\t%s\t%s\n' "${f}" "$(stat -c %s "${work}/${f}")" "$(sha256sum "${work}/${f}" | cut -d ' ' -f 1)"
done >"${work}/files.tsv"
jq -n --arg created_at "${iso}" --arg image_tag "${IMAGE_TAG:-unknown}" --rawfile rows "${work}/files.tsv" '{
  created_at: $created_at,
  image_tag: $image_tag,
  files: ($rows | split("\n") | map(select(length > 0) | split("\t")
    | {name: .[0], size: (.[1] | tonumber), sha256: .[2]}))
}' >"${work}/manifest.json"

echo "backup: encrypting and uploading to ${dest}"
tar -cf - -C "${work}" manifest.json "${files[@]}" \
  | age --encrypt --recipient "${BACKUP_AGE_RECIPIENT}" \
  | rclone rcat "${dest}"
size="$(rclone size --json "${dest}" | jq -r '.bytes')"

cat >"${TEXTFILE_DIR}/backup.prom.tmp" <<METRICS
# HELP backup_last_success_timestamp_seconds Unix time of the last successful backup.
# TYPE backup_last_success_timestamp_seconds gauge
backup_last_success_timestamp_seconds ${epoch}
# HELP backup_last_size_bytes Size in bytes of the last successful encrypted backup.
# TYPE backup_last_size_bytes gauge
backup_last_size_bytes ${size}
METRICS
mv -f "${TEXTFILE_DIR}/backup.prom.tmp" "${TEXTFILE_DIR}/backup.prom"

ping_heartbeat "${BACKUP_HEARTBEAT_URL}" || echo "backup: heartbeat ping failed (backup itself succeeded)" >&2
echo "backup: ok, ${size} bytes"

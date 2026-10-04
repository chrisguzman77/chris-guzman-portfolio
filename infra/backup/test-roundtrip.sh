#!/usr/bin/env bash
# Backup round trip. CI runs it in the infra job; locally: infra/backup/test-roundtrip.sh
#
# Seeds a throwaway Postgres the way production is initialised, runs backup.sh
# against it with a throwaway age key and a local rclone remote, then restores
# into a second Postgres with restore.sh (which runs verify.sql). Also checks the
# object name, the textfile metric, the heartbeat pings, that restore.sh refuses
# to overwrite without RESTORE_REPLACE=1, and that a failed upload pings /fail.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_IMAGE=pgvector/pgvector:0.8.6-pg17
HB_IMAGE=busybox:1.38.0
IMAGE="${BACKUP_TEST_IMAGE:-ci-backup}"
id="backup-rt-$$"
net="${id}"
src="${id}-src"
dst="${id}-dst"
hb="${id}-hb"
vols=("${id}-uploads" "${id}-textfile" "${id}-out" "${id}-keys" "${id}-restored")

cleanup() {
  docker rm -f "${src}" "${dst}" "${hb}" >/dev/null 2>&1 || true
  docker volume rm "${vols[@]}" >/dev/null 2>&1 || true
  docker network rm "${net}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "FAIL  $*" >&2
  exit 1
}
ok() { echo "ok    $*"; }

# Runs a command in the backup image as root (fixture setup and inspection only).
as_root() { docker run --rm --user 0 --entrypoint sh "$@"; }

wait_for_pg() {
  for _ in $(seq 1 60); do
    # TCP only answers after the image's init scripts finish and the server restarts.
    docker exec "$1" pg_isready -q -h 127.0.0.1 -U postgres && return 0
    sleep 1
  done
  fail "postgres $1 did not become ready"
}

echo "==> Building the backup image"
docker build -q -t "${IMAGE}" "${ROOT}/infra/backup" >/dev/null

echo "==> Starting source Postgres, restore target and heartbeat stub"
docker network create "${net}" >/dev/null
docker run -d --name "${src}" --network "${net}" --network-alias postgres \
  -e POSTGRES_PASSWORD=src-pass -e DIRECTUS_DB_PASSWORD=directus-pass \
  -e PORTFOLIO_DB_PASSWORD=portfolio-pass -e UMAMI_DB_PASSWORD=umami-pass \
  -v "${ROOT}/infra/postgres/init:/docker-entrypoint-initdb.d:ro" \
  "${PG_IMAGE}" >/dev/null
docker run -d --name "${dst}" --network "${net}" --network-alias restore-db \
  -e POSTGRES_PASSWORD=dst-pass "${PG_IMAGE}" >/dev/null
docker run -d --name "${hb}" --network "${net}" --network-alias heartbeat "${HB_IMAGE}" \
  sh -c 'mkdir -p /www/ping && echo ok >/www/ping/index.html && echo ok >/www/ping/fail && exec httpd -f -vv -p 8080 -h /www' >/dev/null
wait_for_pg "${src}"
wait_for_pg "${dst}"

echo "==> Seeding fixtures"
docker exec -i "${src}" psql -q -v ON_ERROR_STOP=1 -U postgres -d directus >/dev/null <<'SQL'
SET ROLE directus;
CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY);
CREATE TABLE profile (id serial PRIMARY KEY, full_name text);
CREATE TABLE experience (id serial PRIMARY KEY, title text);
CREATE TABLE projects (id serial PRIMARY KEY, title text);
INSERT INTO directus_collections VALUES ('profile'), ('experience'), ('projects');
INSERT INTO profile (full_name) VALUES ('Fixture Person');
INSERT INTO experience (title) VALUES ('Fixture role');
INSERT INTO projects (title) VALUES ('Fixture project');
SQL
docker exec -i "${src}" psql -q -v ON_ERROR_STOP=1 -U postgres -d portfolio >/dev/null <<'SQL'
SET ROLE portfolio;
CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY);
INSERT INTO alembic_version VALUES ('fixture');
CREATE TABLE chunks (id serial PRIMARY KEY, embedding vector(3));
INSERT INTO chunks (embedding) VALUES ('[1,2,3]');
SQL
as_root -v "${id}-uploads:/u" "${IMAGE}" -c \
  'mkdir -p /u/sub && echo fixture >/u/sub/fixture.txt && chown -R 1000:1000 /u'
as_root -v "${id}-out:/out" -v "${id}-restored:/restored" "${IMAGE}" -c 'chown 10001:10001 /out /restored'
key="$(docker run --rm --entrypoint age-keygen "${IMAGE}" 2>/dev/null)"
recipient="$(printf '%s\n' "${key}" | docker run --rm -i --entrypoint age-keygen "${IMAGE}" -y)"
printf '%s\n' "${key}" | as_root -i -v "${id}-keys:/keys" "${IMAGE}" -c \
  'cat >/keys/key.txt && chown 10001:10001 /keys/key.txt && chmod 0400 /keys/key.txt'
unset key
# Production's node-exporter mounts the empty textfile volume read-only before
# the backup container may have started; reproduce that ordering.
docker run --rm -v "${id}-textfile:/textfile:ro" "${HB_IMAGE}" true

run_backup() {
  docker run --rm --network "${net}" \
    -e POSTGRES_PASSWORD=src-pass -e BACKUP_AGE_RECIPIENT="${recipient}" \
    -e BACKUP_HEARTBEAT_URL=http://heartbeat:8080/ping -e IMAGE_TAG=ci \
    -e R2_BUCKET=/out -e RCLONE_CONFIG_R2_TYPE=local \
    -v "${id}-uploads:/uploads:ro" -v "${id}-textfile:/textfile" "$@" \
    "${IMAGE}" backup.sh
}

restore() {
  docker run --rm --network "${net}" \
    -e PGHOST=restore-db -e PGUSER=postgres -e PGPASSWORD=dst-pass \
    -v "${id}-out:/out:ro" -v "${id}-keys:/keys:ro" -v "${id}-restored:/restored" "$@" \
    "${IMAGE}" restore.sh "/out/${object}" /keys/key.txt
}

echo "==> backup.sh"
run_backup -v "${id}-out:/out" || fail "backup.sh exited non-zero"
ok "backup.sh succeeded"

object="$(as_root -v "${id}-out:/out:ro" "${IMAGE}" -c 'cd /out && find backups -type f')"
re='^backups/([0-9]{4})/([0-9]{2})/([0-9]{2})/portfolio-([0-9]{4})([0-9]{2})([0-9]{2})T[0-9]{6}Z\.tar\.age$'
[[ "${object}" =~ ${re} ]] || fail "unexpected object name: ${object}"
[[ "${BASH_REMATCH[1]}${BASH_REMATCH[2]}${BASH_REMATCH[3]}" == "${BASH_REMATCH[4]}${BASH_REMATCH[5]}${BASH_REMATCH[6]}" ]] \
  || fail "object date path does not match its timestamp: ${object}"
ok "object name ${object}"
magic="$(as_root -v "${id}-out:/out:ro" "${IMAGE}" -c "head -c 21 '/out/${object}'")"
[[ "${magic}" == "age-encryption.org/v1" ]] || fail "object is not age-encrypted"
ok "object is age-encrypted"

metric="$(as_root -v "${id}-textfile:/textfile:ro" "${IMAGE}" -c 'cat /textfile/backup.prom; ls /textfile')"
grep -Eq '^backup_last_success_timestamp_seconds [0-9]{10}$' <<<"${metric}" || fail "timestamp metric missing"
grep -Eq '^backup_last_size_bytes [1-9][0-9]*$' <<<"${metric}" || fail "size metric missing"
grep -q 'backup.prom.tmp' <<<"${metric}" && fail "temp metric file left behind"
ok "textfile metric written"

hb_logs="$(docker logs "${hb}" 2>&1)"
grep -q 'GET /ping$' <<<"${hb_logs}" || fail "success heartbeat not pinged"
if grep -q 'GET /ping/fail' <<<"${hb_logs}"; then fail "failure heartbeat pinged on success"; fi
ok "success heartbeat pinged"

echo "==> restore.sh into an empty server"
restore || fail "restore.sh into an empty server failed"
ok "restored and verified"

echo "==> restore.sh refuses to overwrite"
if restore 2>/dev/null; then fail "restore.sh overwrote existing databases without RESTORE_REPLACE=1"; fi
ok "refused without RESTORE_REPLACE=1"

echo "==> restore.sh with RESTORE_REPLACE=1 and uploads"
restore -e RESTORE_REPLACE=1 -e RESTORE_UPLOADS_DIR=/restored || fail "restore.sh with RESTORE_REPLACE=1 failed"
as_root -v "${id}-restored:/restored:ro" "${IMAGE}" -c 'grep -qx fixture /restored/sub/fixture.txt' \
  || fail "uploads not extracted"
ok "replaced, verified, uploads extracted"

echo "==> backup.sh failure path (read-only remote)"
before="$(as_root -v "${id}-textfile:/textfile:ro" "${IMAGE}" -c 'cat /textfile/backup.prom')"
if run_backup -v "${id}-out:/out:ro" 2>/dev/null; then fail "backup.sh succeeded with a read-only remote"; fi
hb_logs="$(docker logs "${hb}" 2>&1)"
grep -q 'GET /ping/fail' <<<"${hb_logs}" || fail "failure heartbeat not pinged"
after="$(as_root -v "${id}-textfile:/textfile:ro" "${IMAGE}" -c 'cat /textfile/backup.prom')"
[[ "${before}" == "${after}" ]] || fail "metric changed after a failed backup"
ok "failure exits non-zero, pings /fail, keeps the last metric"

echo "backup round trip: all checks passed"

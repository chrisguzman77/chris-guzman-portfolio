#!/usr/bin/env bash
# Post-deploy smoke test. Production publishes no host ports, so each service is
# probed from inside its own container. SMOKE_PUBLIC_URL adds an end-to-end check
# through Cloudflare.
#
# The content checks prove pages render data from Directus without depending on
# editable text: / must carry the profile intro marker (data-cms="profile-intro")
# and /experience must list at least one role (an <h3>) instead of its empty state.
# SKIP_CONTENT_SMOKE=1 skips them, e.g. when rolling back to an image older than
# Phase 3, which has no CMS content.
#
# The api also gets a route check for /v1/github/activity: 200 or 503 both pass.
set -euo pipefail

PROJECT="${COMPOSE_PROJECT_NAME:-portfolio}"
ATTEMPTS="${SMOKE_ATTEMPTS:-20}"

# shellcheck disable=SC2329 # invoked indirectly through check "$@"
container() {
  docker ps -q \
    --filter "label=com.docker.compose.project=${PROJECT}" \
    --filter "label=com.docker.compose.service=$1" | head -n 1
}

check() {
  local name="$1"
  shift
  for ((i = 1; i <= ATTEMPTS; i++)); do
    if "$@" >/dev/null 2>&1; then
      echo "ok    ${name}"
      return 0
    fi
    sleep 3
  done
  echo "FAIL  ${name}" >&2
  return 1
}

# shellcheck disable=SC2329 # invoked indirectly through check "$@"
in_service() {
  local id
  id="$(container "$1")"
  [[ -n "${id}" ]] || return 1
  shift
  docker exec "${id}" "$@"
}

status=0
check "web /api/healthz" in_service web wget -qO- http://127.0.0.1:3000/api/healthz || status=1
check "api /health reports db ok" in_service api python -c \
  "import json,sys,urllib.request as u; sys.exit(json.load(u.urlopen('http://127.0.0.1:8000/health', timeout=3))['db'] != 'ok')" || status=1
# 200 (cached calendar) and 503 (nothing fetched yet / no token) both prove the route is wired.
check "api /v1/github/activity is routed" in_service api python -c "
import sys, urllib.error, urllib.request
try:
    status = urllib.request.urlopen('http://127.0.0.1:8000/v1/github/activity', timeout=3).status
except urllib.error.HTTPError as err:
    status = err.code
sys.exit(status not in (200, 503))" || status=1
check "directus /server/ping" in_service directus wget -qO- http://127.0.0.1:8055/server/ping || status=1
if [[ "${SKIP_CONTENT_SMOKE:-0}" == 1 ]]; then
  echo "skip  CMS content checks (SKIP_CONTENT_SMOKE=1)"
else
  check "web / renders the CMS profile" in_service web sh -c \
    "wget -qO- http://127.0.0.1:3000/ | grep -q 'data-cms=\"profile-intro\"'" || status=1
  check "web /experience renders CMS roles" in_service web sh -c \
    "page=\"\$(wget -qO- http://127.0.0.1:3000/experience)\" && ! printf '%s' \"\$page\" | grep -q 'No roles published yet.' && printf '%s' \"\$page\" | grep -q '<h3'" || status=1
fi
if [[ -n "${SMOKE_PUBLIC_URL:-}" ]]; then
  check "public ${SMOKE_PUBLIC_URL}/api/healthz" curl -fsS --max-time 10 "${SMOKE_PUBLIC_URL}/api/healthz" || status=1
fi
exit "${status}"

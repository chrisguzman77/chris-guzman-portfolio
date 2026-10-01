#!/usr/bin/env bash
# Post-deploy smoke test. Production publishes no host ports, so each service is
# probed from inside its own container. SMOKE_PUBLIC_URL adds an end-to-end check
# through Cloudflare.
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
check "directus /server/ping" in_service directus wget -qO- http://127.0.0.1:8055/server/ping || status=1
check "web / renders the profile" in_service web sh -c "wget -qO- http://127.0.0.1:3000/ | grep -q 'Christopher Guzman'" || status=1
check "web /experience renders CMS content" in_service web sh -c "wget -qO- http://127.0.0.1:3000/experience | grep -q 'SIEGE CyberOps'" || status=1
if [[ -n "${SMOKE_PUBLIC_URL:-}" ]]; then
  check "public ${SMOKE_PUBLIC_URL}/api/healthz" curl -fsS --max-time 10 "${SMOKE_PUBLIC_URL}/api/healthz" || status=1
fi
exit "${status}"

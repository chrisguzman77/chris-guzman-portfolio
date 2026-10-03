#!/usr/bin/env bash
# Deploy or roll back the production stack to IMAGE_TAG.
#
#   IMAGE_TAG=<git sha> scripts/deploy.sh                    # CI deploy, rollback
#   IMAGE_TAG=latest INCLUDE_RUNNER=1 scripts/deploy.sh      # first deploy on the VM (sudo)
#   IMAGE_TAG=<older sha> SKIP_MIGRATIONS=1 scripts/deploy.sh   # rollback across a migration
#
# Secrets are decrypted from infra/compose/prod.enc.env into a private temp file
# that is deleted on exit. ENV_FILE=<path> skips decryption (local testing only).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT}/infra/compose/compose.yaml"
: "${IMAGE_TAG:?set IMAGE_TAG to a git SHA or latest}"
SERVICES="${SERVICES:-postgres directus api web cloudflared prometheus grafana node-exporter cadvisor blackbox-exporter umami}"
if [[ "${INCLUDE_RUNNER:-0}" == 1 ]]; then
  SERVICES="${SERVICES} runner"
fi

env_file="${ENV_FILE:-}"
if [[ -z "${env_file}" ]]; then
  export SOPS_AGE_KEY_FILE="${SOPS_AGE_KEY_FILE:-/etc/portfolio/age.key}"
  env_file="$(mktemp)"
  trap 'rm -f "${env_file}"' EXIT
  sops decrypt --output-type dotenv "${ROOT}/infra/compose/prod.enc.env" >"${env_file}"
fi

export IMAGE_TAG
DOCKER_GID="${DOCKER_GID:-$(stat -c %g /var/run/docker.sock)}"
export DOCKER_GID

compose() { docker compose -f "${COMPOSE_FILE}" --env-file "${env_file}" "$@"; }

echo "==> Deploying ${IMAGE_TAG}: ${SERVICES}"
# shellcheck disable=SC2086 # SERVICES is an intentional word list
compose pull ${SERVICES}
compose up -d --wait postgres
if [[ "${SKIP_MIGRATIONS:-0}" == 1 ]]; then
  echo "==> Skipping migrations (SKIP_MIGRATIONS=1)"
else
  echo "==> Migrating"
  compose run --rm --no-deps api alembic upgrade head
fi
# shellcheck disable=SC2086
compose up -d --wait --wait-timeout 180 --remove-orphans ${SERVICES}
echo "==> CMS bootstrap"
compose exec -T directus node /directus/bootstrap/bootstrap.mjs
echo "==> Smoke testing"
"${ROOT}/scripts/smoke.sh"
docker image prune -f >/dev/null
echo "==> Deployed ${IMAGE_TAG}"

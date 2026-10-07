#!/usr/bin/env bash
# Registers an ephemeral, repo-scoped GitHub Actions runner, runs exactly one
# job, then exits. Compose restarts the container, which registers a fresh
# runner for the next job, so no state carries over between deploys.
#
# Auth: a GitHub App (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY) when both are set,
# otherwise the fine-grained PAT in GITHUB_RUNNER_TOKEN. See docs/setup.md.
set -euo pipefail

# shellcheck source=infra/runner/github-app.sh
# shellcheck disable=SC1091 # path differs between the image and the repo; linted on its own
source /usr/local/lib/runner-github-app.sh

: "${GITHUB_RUNNER_REPO:?set GITHUB_RUNNER_REPO to owner/repo}"
RUNNER_NAME="${RUNNER_NAME:-portfolio-vm}"
RUNNER_LABELS="${RUNNER_LABELS:-portfolio-deploy}"

cd /home/runner

if [[ -n "${GITHUB_APP_ID:-}" && -n "${GITHUB_APP_PRIVATE_KEY:-}" ]]; then
  echo "auth: github app"
  app_token="$(app_jwt "${GITHUB_APP_ID}" "${GITHUB_APP_PRIVATE_KEY}")"
  api_token="$(app_installation_token "${GITHUB_RUNNER_REPO}" "${app_token}")"
  unset app_token
elif [[ -n "${GITHUB_RUNNER_TOKEN:-}" ]]; then
  if [[ -n "${GITHUB_APP_ID:-}${GITHUB_APP_PRIVATE_KEY:-}" ]]; then
    echo "only one of GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY is set; falling back to the PAT" >&2
  fi
  echo "auth: pat"
  api_token="${GITHUB_RUNNER_TOKEN}"
else
  echo "set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (GitHub App), or GITHUB_RUNNER_TOKEN (fine-grained PAT, Administration: read and write)" >&2
  exit 1
fi

# Trade the app or PAT token for a one-hour registration token.
registration_token="$(
  github_api POST "/repos/${GITHUB_RUNNER_REPO}/actions/runners/registration-token" "${api_token}" |
    jq -r '.token // empty'
)"
unset api_token
if [[ -z "${registration_token}" ]]; then
  echo "could not obtain a runner registration token for ${GITHUB_RUNNER_REPO}" >&2
  exit 1
fi

# A restart that did not follow a completed job leaves local config behind;
# config.sh refuses to run over it. --replace handles the GitHub side.
rm -f .runner .credentials .credentials_rsaparams
./config.sh --unattended --ephemeral --replace --disableupdate \
  --url "https://github.com/${GITHUB_RUNNER_REPO}" \
  --token "${registration_token}" \
  --name "${RUNNER_NAME}" \
  --labels "${RUNNER_LABELS}"

# Jobs must never see any credential.
unset GITHUB_RUNNER_TOKEN GITHUB_APP_ID GITHUB_APP_PRIVATE_KEY registration_token
exec ./run.sh

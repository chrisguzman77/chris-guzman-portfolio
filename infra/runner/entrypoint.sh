#!/usr/bin/env bash
# Registers an ephemeral, repo-scoped GitHub Actions runner, runs exactly one
# job, then exits. Compose restarts the container, which registers a fresh
# runner for the next job, so no state carries over between deploys.
set -euo pipefail

: "${GITHUB_RUNNER_TOKEN:?set GITHUB_RUNNER_TOKEN to a fine-grained PAT (Administration: read and write)}"
: "${GITHUB_RUNNER_REPO:?set GITHUB_RUNNER_REPO to owner/repo}"
RUNNER_NAME="${RUNNER_NAME:-portfolio-vm}"
RUNNER_LABELS="${RUNNER_LABELS:-portfolio-deploy}"

cd /home/runner

# Trade the long-lived PAT for a one-hour registration token.
registration_token="$(
  curl -fsS -X POST \
    -H "Authorization: Bearer ${GITHUB_RUNNER_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${GITHUB_RUNNER_REPO}/actions/runners/registration-token" |
    jq -r '.token // empty'
)"
if [[ -z "${registration_token}" ]]; then
  echo "could not obtain a runner registration token for ${GITHUB_RUNNER_REPO}" >&2
  exit 1
fi

./config.sh --unattended --ephemeral --replace --disableupdate \
  --url "https://github.com/${GITHUB_RUNNER_REPO}" \
  --token "${registration_token}" \
  --name "${RUNNER_NAME}" \
  --labels "${RUNNER_LABELS}"

# Jobs must never see the PAT.
unset GITHUB_RUNNER_TOKEN registration_token
exec ./run.sh

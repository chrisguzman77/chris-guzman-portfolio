#!/usr/bin/env bash
# Put the VM checkout at a commit and keep it owned by the runner (uid 1001).
# Used by the release workflow (as uid 1001) and by the runbook (with sudo).
#
#   scripts/sync-repo.sh [ref]     # ref defaults to main; CI passes the commit SHA
#
# Everything lives in main() so bash has read the whole script before the
# checkout below replaces this file on disk.
set -euo pipefail

main() {
  local root ref="${1:-main}"
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  git -C "${root}" fetch --quiet origin "${ref}"
  git -C "${root}" checkout --quiet --detach --force FETCH_HEAD
  if [[ ${EUID} -eq 0 ]]; then
    chown -R 1001:1001 "${root}"
  fi
  git -C "${root}" log -1 --format='==> checkout at %h %s'
}

main "$@"
exit

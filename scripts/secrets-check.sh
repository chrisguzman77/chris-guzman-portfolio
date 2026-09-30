#!/usr/bin/env bash
# Checks the encrypted production secrets without printing any value:
# every key listed under "Stored in prod.enc.env" in prod.env.example must be
# present, and none may still be the change-me placeholder.
#   SECRETS_FILE (default infra/compose/prod.enc.env) is overridable for tests.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_FILE="${SECRETS_FILE:-${ROOT}/infra/compose/prod.enc.env}"
EXAMPLE="${ROOT}/infra/compose/prod.env.example"

count() { awk 'NF{n++} END{print n+0}'; }

decrypted="$(sops decrypt --input-type dotenv --output-type dotenv "${SECRETS_FILE}")"
required="$(awk '/^# Stored in prod.enc.env/{f=1; next} /^#/{next} f && /^[A-Z_]+=/{sub(/=.*/, ""); print}' "${EXAMPLE}" | sort -u)"
present="$(printf '%s\n' "${decrypted}" | awk -F= '/^[A-Z_]+=/{print $1}' | sort -u)"
placeholders="$(printf '%s\n' "${decrypted}" | awk -F= '/^[A-Z_]+=/ && $2 == "change-me"{print $1}' | sort -u)"
missing="$(comm -23 <(printf '%s\n' "${required}") <(printf '%s\n' "${present}"))"

printf '%d keys present, %d required\n' "$(printf '%s\n' "${present}" | count)" "$(printf '%s\n' "${required}" | count)"
status=0
# Key names are not secret; print them space-separated.
if [[ -n "${missing}" ]]; then
  echo "missing keys: $(printf '%s\n' "${missing}" | paste -sd ' ' -)"
  status=1
fi
if [[ -n "${placeholders}" ]]; then
  echo "still change-me: $(printf '%s\n' "${placeholders}" | paste -sd ' ' -)"
  status=1
fi
if [[ ${status} -eq 0 ]]; then
  echo "secrets look ready"
fi
exit "${status}"

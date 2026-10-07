#!/usr/bin/env bash
# Checks app_jwt (github-app.sh) against a throwaway RSA key: three base64url
# parts, the RS256 header, iss/iat/exp claims, and a signature that verifies.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/runner/github-app.sh
# shellcheck disable=SC1091 # path differs between the image and the repo; linted on its own
source "${here}/github-app.sh"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

openssl genrsa -out "${work}/key.pem" 2048 2>/dev/null
openssl rsa -in "${work}/key.pem" -pubout -out "${work}/pub.pem" 2>/dev/null

fail() { echo "FAIL: $*" >&2; exit 1; }

b64url_decode() {
  local s
  s="$(printf '%s' "$1" | tr '_-' '/+')"
  while (( ${#s} % 4 )); do s+="="; done
  printf '%s' "${s}" | openssl base64 -d -A
}

check_jwt() {
  local label="$1" jwt="$2" header payload sig iss iat exp
  [[ "${jwt}" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] || fail "${label}: not three base64url parts"
  IFS=. read -r header payload sig <<<"${jwt}"

  [[ "$(b64url_decode "${header}")" == '{"alg":"RS256","typ":"JWT"}' ]] || fail "${label}: header"

  iss="$(b64url_decode "${payload}" | jq -r '.iss')"
  iat="$(b64url_decode "${payload}" | jq -r '.iat')"
  exp="$(b64url_decode "${payload}" | jq -r '.exp')"
  [[ "${iss}" == "123456" ]] || fail "${label}: iss is ${iss}"
  (( exp - iat == 600 )) || fail "${label}: exp - iat is $((exp - iat))"
  (( iat <= $(date +%s) - 59 )) || fail "${label}: iat is not backdated 60 s"

  printf '%s' "${header}.${payload}" >"${work}/signed"
  b64url_decode "${sig}" >"${work}/sig"
  openssl dgst -sha256 -verify "${work}/pub.pem" -signature "${work}/sig" "${work}/signed" >/dev/null ||
    fail "${label}: signature does not verify"
  echo "ok: ${label}"
}

pem="$(cat "${work}/key.pem")"
check_jwt "multi-line PEM" "$(app_jwt 123456 "${pem}")"

# sops dotenv values are single-line: the PEM arrives with literal \n escapes.
escaped="$(awk 'NR > 1 { printf "\\n" } { printf "%s", $0 }' "${work}/key.pem")"
[[ "${escaped}" != *$'\n'* ]] || fail "escaped PEM still has newlines"
check_jwt "\\n-escaped PEM" "$(app_jwt 123456 "${escaped}")"

echo "app jwt: ok"

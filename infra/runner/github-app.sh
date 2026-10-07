# shellcheck shell=bash
# GitHub App auth for the runner entrypoint: app JWT -> installation token.
# Needs only bash, openssl, base64, tr and jq (plus curl for the API calls).
# Nothing here prints a credential; callers capture the output.

_b64url() { base64 | tr -d '\n=' | tr '+/' '-_'; }

# app_jwt APP_ID KEY_PEM -> RS256 JWT valid for 10 minutes, iat backdated 60 s
# for clock drift. KEY_PEM may be a real multi-line PEM or a single line with
# literal \n escapes (how sops dotenv stores multi-line values).
app_jwt() {
  local app_id="$1" key="${2//\\n/$'\n'}" iat header payload unsigned sig
  iat=$(($(date +%s) - 60))
  header="$(printf '%s' '{"alg":"RS256","typ":"JWT"}' | _b64url)"
  payload="$(jq -cn --arg iss "${app_id}" --argjson iat "${iat}" \
    '{iat: $iat, exp: ($iat + 600), iss: $iss}' | _b64url)"
  [[ -n "${header}" && -n "${payload}" ]] || return 1
  unsigned="${header}.${payload}"
  sig="$(printf '%s' "${unsigned}" |
    openssl dgst -sha256 -binary -sign <(printf '%s\n' "${key}") | _b64url)" || return 1
  [[ -n "${sig}" ]] || return 1
  printf '%s.%s\n' "${unsigned}" "${sig}"
}

# github_api METHOD PATH TOKEN -> response body. The Authorization header is
# fed on stdin so the token never appears in curl's argv.
github_api() {
  printf 'Authorization: Bearer %s\n' "$3" |
    curl -fsS -X "$1" -H @- \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com$2"
}

# app_installation_token REPO JWT -> one-hour installation access token.
app_installation_token() {
  local repo="$1" jwt="$2" id token
  # 404 here means a wrong GITHUB_APP_ID or key, or the app is not installed on the repo.
  id="$(github_api GET "/repos/${repo}/installation" "${jwt}" | jq -r '.id // empty')" || id=""
  if [[ -z "${id}" ]]; then
    echo "could not find the GitHub App installation on ${repo} (check GITHUB_APP_ID, the key, and that the app is installed)" >&2
    return 1
  fi
  token="$(github_api POST "/app/installations/${id}/access_tokens" "${jwt}" | jq -r '.token // empty')" || token=""
  if [[ -z "${token}" ]]; then
    echo "could not mint an installation token for ${repo}" >&2
    return 1
  fi
  printf '%s\n' "${token}"
}

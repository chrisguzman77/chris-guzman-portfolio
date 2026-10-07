#!/usr/bin/env bash
# Fails when an image shared by the prod compose, the dev compose and CI is
# pinned to different tags. Dependabot's docker-compose ecosystem reads only
# infra/compose, so tags in workflow files (and the supercronic ARG in
# infra/backup/Dockerfile) are bumped by hand; this keeps them in step.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
files=(
  "${root}/infra/compose/compose.yaml"
  "${root}/infra/compose/compose.dev.yaml"
  "${root}"/.github/workflows/*.yml
)
images=(pgvector/pgvector directus/directus prom/prometheus prom/blackbox-exporter)

status=0
for image in "${images[@]}"; do
  tags=()
  for file in "${files[@]}"; do
    # The tag ends at "@" (digest), whitespace or a quote.
    while IFS= read -r tag; do
      tags+=("${tag}")
    done < <(grep -ohE "${image}:[A-Za-z0-9._-]+" "${file}" || true)
  done
  if [[ ${#tags[@]} -eq 0 ]]; then
    echo "check-image-drift: no reference to ${image} found" >&2
    status=1
    continue
  fi
  unique="$(printf '%s\n' "${tags[@]}" | sort -u)"
  if [[ "$(wc -l <<<"${unique}")" -ne 1 ]]; then
    echo "check-image-drift: ${image} is pinned to different tags:" >&2
    while IFS= read -r line; do echo "  ${line}" >&2; done <<<"${unique}"
    status=1
  fi
done

# The supercronic version and its checksum must be bumped together.
dockerfile="${root}/infra/backup/Dockerfile"
if ! grep -q '^ARG SUPERCRONIC_VERSION=' "${dockerfile}" || ! grep -q '^ARG SUPERCRONIC_SHA256=' "${dockerfile}"; then
  echo "check-image-drift: SUPERCRONIC_VERSION/SUPERCRONIC_SHA256 ARGs missing in ${dockerfile}" >&2
  status=1
fi

[[ ${status} -eq 0 ]] && echo "check-image-drift: ok"
exit "${status}"

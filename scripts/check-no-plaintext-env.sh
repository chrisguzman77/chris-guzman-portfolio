#!/usr/bin/env bash
# pre-commit guard: env files may be committed only as *.example (documentation)
# or *.enc.env (sops-encrypted). Anything else is a leaked secret.
set -euo pipefail

status=0
for file in "$@"; do
  case "$file" in
    *.example) ;;
    *.enc.env)
      if ! grep -q '^sops_' "$file"; then
        echo "ERROR: $file is not sops-encrypted (no sops_ metadata)" >&2
        status=1
      fi
      ;;
    *)
      echo "ERROR: refusing to commit plaintext env file: $file" >&2
      status=1
      ;;
  esac
done
exit "$status"

#!/usr/bin/env bash
# apps/web/e2e/serve.sh: run the standalone production build the way the Docker image does.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
exec env PORT=3100 HOSTNAME=127.0.0.1 node .next/standalone/server.js

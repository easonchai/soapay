#!/usr/bin/env bash
# Build both apps for a single public origin (e.g. a Tailscale serve URL):
#   scripts/build-demo.sh https://my-machine.tailnet.ts.net:9443
# The company app (with CK's landing) is served at /, the employee app at /app/, the API at /api (see scripts/serve-demo.mjs).
# Other settings (chain, StealthDisperse, RPCs, bundler, attester) come from each app's .env.
set -euo pipefail
ORIGIN="${1:?usage: build-demo.sh <public-origin>}"
ORIGIN="${ORIGIN%/}"
cd "$(dirname "$0")/.."

pnpm --filter @soapay/sdk build >/dev/null
pnpm --filter @soapay/worldid-react build >/dev/null 2>&1 || true

VITE_API_URL="$ORIGIN/api" VITE_OTHER_APP_URL="$ORIGIN/" pnpm --filter @soapay/recipient exec vite build --base=/app/
VITE_API_URL="$ORIGIN/api" VITE_RECIPIENT_URL="$ORIGIN/app/" VITE_OTHER_APP_URL="$ORIGIN/app/" pnpm --filter @soapay/sender exec vite build
echo "built for $ORIGIN (company /, employee /app/, api /api)"

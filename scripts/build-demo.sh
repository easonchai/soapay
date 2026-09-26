#!/usr/bin/env bash
# Build both apps for a single public origin (e.g. a Tailscale serve URL):
#   scripts/build-demo.sh https://my-machine.tailnet.ts.net:9443
# Recipient is served at /, sender at /sender/, the API at /api (see scripts/serve-demo.mjs).
# Other settings (chain, StealthDisperse, RPCs, bundler, attester) come from each app's .env.
set -euo pipefail
ORIGIN="${1:?usage: build-demo.sh <public-origin>}"
ORIGIN="${ORIGIN%/}"
cd "$(dirname "$0")/.."

pnpm --filter @soapay/sdk build >/dev/null
pnpm --filter @soapay/worldid-react build >/dev/null 2>&1 || true

VITE_API_URL="$ORIGIN/api" VITE_OTHER_APP_URL="$ORIGIN/sender/" pnpm --filter @soapay/recipient exec vite build
VITE_API_URL="$ORIGIN/api" VITE_RECIPIENT_URL="$ORIGIN/" VITE_OTHER_APP_URL="$ORIGIN/" pnpm --filter @soapay/sender exec vite build --base=/sender/
echo "built for $ORIGIN (recipient /, sender /sender/, api /api)"

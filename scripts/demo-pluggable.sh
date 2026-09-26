#!/usr/bin/env bash
# Demo beat "plug it into anything", LIVE on Base Sepolia (docs/demo-flow.md):
#   1. an AI agent claims invoice-agent.soapay.eth over MCP (ENSIP-26 records);
#   2. ONE revenue-share run pays three people, a raw meta-address and the agent, with one CLI command;
#   3. one of the people scans with her recovery phrase and finds only her lines;
#   4. the agent scans over MCP, finds only its lines, and spends gaslessly (on Base Sepolia the gas is
#      sponsored through the API's /paymaster; on Base the Circle paymaster takes it in USDC).
# The payer needs Soapay mock USDC on Base Sepolia: scripts/fund-usdc.sh <payer> (D-52).
#
#   scripts/demo-pluggable.sh              # the whole beat (sends DIVIDEND_TOTAL, default 0.5 USDC)
#   DEMO_DRY=1 scripts/demo-pluggable.sh   # rehearse: dry-run plan only, nothing sent
#   DEMO_REPLAY=1 scripts/demo-pluggable.sh  # offline fallback: replay the recorded live run
#
# One-time setup: pnpm --filter @soapay/examples demo:setup (claims the people's names, writes
# examples/demo/holders.csv and the git-ignored scripts/.demo-recipients.local.json).
# The payer key comes from PAYER_PRIVATE_KEY, else PAYER_ENV_FILE (variable PAYER_ENV_VAR, default
# PAYER_PRIVATE_KEY), else scripts/.demo.local.env, else apps/mcp/.env (AGENT_PAYER_PRIVATE_KEY).
# Keys and phrases are only ever passed through the environment, never printed.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
# Offline fallback: replay the recorded live run (docs/demo-screens/beat4-pluggable-live.*).
if [ -n "${DEMO_REPLAY:-}" ]; then
  while IFS= read -r line; do printf '%s\n' "$line"; sleep "${DEMO_REPLAY_DELAY:-0.08}"; done <"$ROOT/docs/demo-screens/beat4-pluggable-live.ansi"
  exit 0
fi
API=${SOAPAY_DEMO_API:-https://soapay.up.railway.app/api}
RPC=${RPC_URL:-https://sepolia.base.org}
ENS_RPC=${ENS_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}
TOTAL=${DIVIDEND_TOTAL:-0.5}
CHUNK=${DIVIDEND_CHUNK:-0.05}
LOCAL_FILE=${SOAPAY_DEMO_FILE:-$ROOT/scripts/.demo-recipients.local.json}
export FORCE_COLOR=${FORCE_COLOR:-1} RPC_URL=$RPC ENS_RPC_URL=$ENS_RPC SOAPAY_MCP_API=$API

B=$'\033[1m'; D=$'\033[2m'; C=$'\033[36m'; G=$'\033[32m'; R=$'\033[0m'
[ "$FORCE_COLOR" = 0 ] && { B= D= C= G= R=; }
title() { printf '\n%s%s%s\n' "$B" "$1" "$R"; }
note() { printf '%s%s%s\n' "$D" "$1" "$R"; }
# Prints the command as typed (no environment, so no secrets).
show() { printf '%s$ %s%s\n' "$C" "$*" "$R"; }
soapay() { node "$ROOT/apps/cli/dist/index.js" "$@"; }
agent() { (cd "$ROOT/examples" && pnpm exec tsx demo/pluggable-agent.ts "$@"); }

[ -f "$LOCAL_FILE" ] || { echo "Missing $LOCAL_FILE: run pnpm --filter @soapay/examples demo:setup first." >&2; exit 1; }
[ -f "$ROOT/apps/cli/dist/index.js" ] || pnpm --filter @soapay/cli build >/dev/null 2>&1
[ -f "$ROOT/apps/mcp/dist/index.js" ] || pnpm --filter @soapay/mcp build >/dev/null 2>&1

if [ -z "${PAYER_PRIVATE_KEY:-}" ]; then
  for f in ${PAYER_ENV_FILE:+"$PAYER_ENV_FILE:${PAYER_ENV_VAR:-PAYER_PRIVATE_KEY}"} \
    "$ROOT/scripts/.demo.local.env:PAYER_PRIVATE_KEY" "$ROOT/apps/mcp/.env:AGENT_PAYER_PRIVATE_KEY"; do
    file=${f%%:*} var=${f##*:}
    if [ -f "$file" ]; then
      PAYER_PRIVATE_KEY=$( (grep -E "^${var}=" "$file" || true) | head -1 | cut -d= -f2- | tr -d "\"' ")
      [ -n "$PAYER_PRIVATE_KEY" ] && break
    fi
  done
fi
if [ -z "${DEMO_DRY:-}" ] && [ -z "${PAYER_PRIVATE_KEY:-}" ]; then
  echo "No payer key: set PAYER_PRIVATE_KEY (a funded Base Sepolia EOA) or DEMO_DRY=1." >&2
  exit 1
fi
export PAYER_PRIVATE_KEY=${PAYER_PRIVATE_KEY:-}

block_number() {
  printf '%d' "$(curl -s -m 10 -X POST -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' "$RPC" | sed -E 's/.*"result":"([^"]+)".*/\1/')"
}

if [ -z "${DEMO_DRY:-}" ]; then
  title "1. An AI agent gets a soapay name, like any employee"
  agent claim
fi

title "2. One payout run: three people, a raw meta-address and the agent"
note "holders.csv: a revenue-share register. Names resolve on ENSv2 and are cross-checked against ERC-6538."
START=$(block_number)
EXEC=(--execute)
[ -n "${DEMO_DRY:-}" ] && EXEC=()
show soapay distribute --preset dividend --csv examples/demo/holders.csv --asset usdc --total "$TOTAL" --chunk "$CHUNK" "${EXEC[@]}"
(cd "$ROOT" && soapay distribute --preset dividend --csv examples/demo/holders.csv --asset usdc --total "$TOTAL" --chunk "$CHUNK" \
  --rpc "$RPC" --ens-rpc "$ENS_RPC" "${EXEC[@]}")
[ -n "${DEMO_DRY:-}" ] && exit 0

title "3. dividend-ana.soapay.eth scans with her recovery phrase"
SOAPAY_PHRASE=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).holders[0].phrase)' "$LOCAL_FILE")
export SOAPAY_PHRASE
# The company's payer address (public), so the scan labels it as a known payer.
COMPANY=$(cd "$ROOT/apps/cli" && node --input-type=module -e \
  'import { privateKeyToAddress } from "viem/accounts"; process.stdout.write(privateKeyToAddress(process.env.PAYER_PRIVATE_KEY))')
show soapay scan --mnemonic-env SOAPAY_PHRASE --from "$START" --known-payer "$COMPANY"
# Public RPCs are load-balanced: retry until a node that has seen the pay tx answers.
for _ in $(seq 1 15); do
  OUT=$(soapay scan --mnemonic-env SOAPAY_PHRASE --from "$START" --known-payer "$COMPANY" --rpc "$RPC")
  grep -q ': 0 payment(s)' <<<"$OUT" || break
  sleep 2
done
printf '%s\n' "$OUT"
unset SOAPAY_PHRASE

title "4. The agent scans over MCP, finds only its lines, and spends without ETH"
AGENT_SINCE_BLOCK=$START agent receive

printf '\n%sSoapay does not care who gets paid: a person or an agent gets the same name, the same privacy, the same exit.%s\n' "$G" "$R"

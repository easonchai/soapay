#!/usr/bin/env bash
# Top up test USDC on Base Sepolia from Circle's faucet (D-47). Circle gives 20 USDC per address per
# chain every 2 hours, so this is for one address at a time; see docs/testnet-deployment.md, "Funding".
#
#   scripts/fund-usdc.sh                       # the deployer (DEPLOYER_PRIVATE_KEY in contracts/.env)
#   scripts/fund-usdc.sh 0xabc…                # any address
#   scripts/fund-usdc.sh 0xabc… --chain base-sepolia
#
# With CIRCLE_API_KEY (environment, else contracts/.env) it calls Circle's faucet API; the API faucet
# needs a Circle account that completed verification. Without a key it prints the manual faucet link.
# It always prints the address's Base Sepolia USDC balance before and after. Keys are never printed.
# FUND_USDC_ENV_FILE overrides the env file; FUND_USDC_DRY=1 skips the faucet call (tests).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE=${FUND_USDC_ENV_FILE:-$ROOT/contracts/.env}
RPC=${RPC_URL:-https://sepolia.base.org}
USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e
FAUCET_API=https://api.circle.com/v1/faucet/drips

usage() { echo "Usage: scripts/fund-usdc.sh [address] [--chain base-sepolia]" >&2; exit 2; }

ADDRESS=""
CHAIN=base-sepolia
while [ $# -gt 0 ]; do
  case "$1" in
    --chain) [ $# -ge 2 ] || usage; CHAIN=$2; shift 2 ;;
    --chain=*) CHAIN=${1#--chain=}; shift ;;
    -h | --help) usage ;;
    -*) echo "Unknown option: $1" >&2; usage ;;
    *) [ -z "$ADDRESS" ] || usage; ADDRESS=$1; shift ;;
  esac
done
if [ "$CHAIN" != base-sepolia ]; then
  echo "Only --chain base-sepolia is supported (the app's testnet)." >&2
  exit 2
fi

# Reads one variable from the env file without sourcing it (nothing in it is executed or printed).
env_value() {
  [ -f "$ENV_FILE" ] || return 0
  (grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$ENV_FILE" || true) | tail -1 | cut -d= -f2- | tr -d "\"' \r"
}

if [ -z "$ADDRESS" ]; then
  KEY=$(env_value DEPLOYER_PRIVATE_KEY)
  if [ -z "$KEY" ]; then
    echo "No address given and no DEPLOYER_PRIVATE_KEY in $ENV_FILE." >&2
    exit 1
  fi
  ADDRESS=$(cast wallet address --private-key "$KEY")
  unset KEY
fi
if ! [[ "$ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Not an address: $ADDRESS" >&2
  exit 2
fi

balance() {
  local raw
  if raw=$(cast call "$USDC" "balanceOf(address)(uint256)" "$ADDRESS" --rpc-url "$RPC" 2>/dev/null); then
    raw=${raw%% *} # cast appends a scientific form, e.g. "12200000 [1.22e7]"
    printf '%s USDC' "$(awk -v r="$raw" 'BEGIN { printf "%.2f", r / 1e6 }')"
  else
    printf 'unknown (RPC %s did not answer)' "$RPC"
  fi
}

echo "Address: $ADDRESS (Base Sepolia)"
echo "USDC before: $(balance)"

API_KEY=${CIRCLE_API_KEY:-$(env_value CIRCLE_API_KEY)}
if [ -z "$API_KEY" ]; then
  echo
  echo "No CIRCLE_API_KEY: request it by hand at https://faucet.circle.com"
  echo "  Network: Base Sepolia · Address: $ADDRESS · 20 USDC per address every 2 hours."
  echo "For the API: create a testnet API key in the Circle Developer Console (console.circle.com, a verified"
  echo "Circle account) and set CIRCLE_API_KEY in contracts/.env."
  exit 0
fi
if [ -n "${FUND_USDC_DRY:-}" ]; then
  echo "FUND_USDC_DRY set: not calling the faucet."
  exit 0
fi

BODY=$(printf '{"address":"%s","blockchain":"BASE-SEPOLIA","usdc":true}' "$ADDRESS")
RESP=$(mktemp)
HDRS=$(mktemp) # the key goes to curl through a private file, never on the command line
trap 'rm -f "$RESP" "$HDRS"' EXIT
chmod 600 "$HDRS"
REQ_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || true)
{
  printf 'Authorization: Bearer %s\n' "$API_KEY"
  printf 'Content-Type: application/json\n'
  if [ -n "$REQ_ID" ]; then printf 'X-Request-Id: %s\n' "$REQ_ID"; fi
} >"$HDRS"
unset API_KEY
CODE=$(curl -sS -m 30 -o "$RESP" -w '%{http_code}' -X POST "$FAUCET_API" -H @"$HDRS" --data "$BODY") || CODE=000
rm -f "$HDRS"
MSG=$(sed -E 's/.*"message" *: *"([^"]*)".*/\1/' "$RESP" | head -c 400)

echo
case "$CODE" in
  200 | 201 | 204)
    echo "Faucet: requested 20 USDC. It usually lands within a minute." ;;
  429)
    echo "Faucet: rate limited (${MSG:-too many requests}). Circle allows one drip per address per chain every"
    echo "2 hours; retry after that, or use https://faucet.circle.com for another chain and bridge (docs/testnet-deployment.md)." ;;
  401)
    echo "Faucet: the API key was rejected (${MSG:-unauthorized}). Check CIRCLE_API_KEY (a TEST_API_KEY:… key)." ;;
  403)
    echo "Faucet: refused (${MSG:-forbidden}). Circle's API faucet needs a Circle account that completed verification;"
    echo "until then use https://faucet.circle.com by hand." ;;
  000)
    echo "Faucet: no answer from $FAUCET_API." ;;
  *)
    echo "Faucet: HTTP $CODE: ${MSG:-no message}"
    if grep -qi 'verif' "$RESP"; then echo "The account must be verified to use Circle's API faucet; use https://faucet.circle.com meanwhile."; fi ;;
esac

case "$CODE" in
  200 | 201 | 204)
    # Public RPCs lag: wait up to ~60 s for the balance to move.
    BEFORE=$(balance)
    for _ in $(seq 1 12); do
      sleep 5
      [ "$(balance)" != "$BEFORE" ] && break
    done ;;
esac
echo "USDC after: $(balance)"
[ "$CODE" = 200 ] || [ "$CODE" = 201 ] || [ "$CODE" = 204 ]

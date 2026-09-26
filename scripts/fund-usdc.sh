#!/usr/bin/env bash
# Top up test USDC on Base Sepolia (D-52). The app's testnet pay token is Soapay's mock USDC, which we
# mint; Circle's faucet path (D-47) is kept for mainnet-like testing with real Circle USDC.
#
#   scripts/fund-usdc.sh                          # mock USDC to the deployer (DEPLOYER_PRIVATE_KEY in contracts/.env)
#   scripts/fund-usdc.sh 0xabc…                   # mock USDC to any address
#   scripts/fund-usdc.sh 0xabc… --amount 5000     # whole USDC (default 1000000)
#   scripts/fund-usdc.sh 0xabc… --via api         # the API's welcome drop (POST $API_URL/faucet, once per address)
#   scripts/fund-usdc.sh 0xabc… --token circle    # Circle's faucet instead (real Circle USDC, 20 per 2 hours)
#
# Mock mint (--via mint, the default) signs with MINTER_PRIVATE_KEY (environment), else the API relayer's
# RELAYER_PRIVATE_KEY from apps/api/.env (it holds MINTER_ROLE), else the deployer, which is the token's
# admin and grants itself MINTER_ROLE for the mint and revokes it right after. Keys are never printed.
#
# Circle (--token circle): with CIRCLE_API_KEY (environment, else contracts/.env) it calls Circle's
# faucet API; the API faucet needs a Circle account that completed verification. Without a key it
# prints the manual faucet link.
#
# It always prints the address's balance of the chosen token before and after.
# FUND_USDC_ENV_FILE / FUND_USDC_API_ENV_FILE override the env files; FUND_USDC_DRY=1 skips every send (tests).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE=${FUND_USDC_ENV_FILE:-$ROOT/contracts/.env}
API_ENV_FILE=${FUND_USDC_API_ENV_FILE:-$ROOT/apps/api/.env}
RPC=${RPC_URL:-https://sepolia.base.org}
MOCK_USDC=${PAY_TOKEN:-0x028D969c20b740582428f5043954c380686214Bb}
CIRCLE_USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e
FAUCET_API=https://api.circle.com/v1/faucet/drips
API_URL=${API_URL:-http://localhost:8787}

usage() { echo "Usage: scripts/fund-usdc.sh [address] [--amount N] [--via mint|api] [--token mock|circle] [--chain base-sepolia]" >&2; exit 2; }

ADDRESS=""
CHAIN=base-sepolia
TOKEN=mock
VIA=mint
AMOUNT=1000000
while [ $# -gt 0 ]; do
  case "$1" in
    --chain) [ $# -ge 2 ] || usage; CHAIN=$2; shift 2 ;;
    --chain=*) CHAIN=${1#--chain=}; shift ;;
    --token) [ $# -ge 2 ] || usage; TOKEN=$2; shift 2 ;;
    --token=*) TOKEN=${1#--token=}; shift ;;
    --via) [ $# -ge 2 ] || usage; VIA=$2; shift 2 ;;
    --via=*) VIA=${1#--via=}; shift ;;
    --amount) [ $# -ge 2 ] || usage; AMOUNT=$2; shift 2 ;;
    --amount=*) AMOUNT=${1#--amount=}; shift ;;
    -h | --help) usage ;;
    -*) echo "Unknown option: $1" >&2; usage ;;
    *) [ -z "$ADDRESS" ] || usage; ADDRESS=$1; shift ;;
  esac
done
if [ "$CHAIN" != base-sepolia ]; then
  echo "Only --chain base-sepolia is supported (the app's testnet)." >&2
  exit 2
fi
case "$TOKEN" in mock | circle) ;; *) echo "--token must be mock or circle" >&2; exit 2 ;; esac
case "$VIA" in mint | api) ;; *) echo "--via must be mint or api" >&2; exit 2 ;; esac
if ! [[ "$AMOUNT" =~ ^[0-9]{1,12}$ ]] || [ "$AMOUNT" = 0 ]; then
  echo "--amount must be a whole number of USDC" >&2
  exit 2
fi

# Reads one variable from an env file without sourcing it (nothing in it is executed or printed).
env_value() {
  local file=${2:-$ENV_FILE}
  [ -f "$file" ] || return 0
  (grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$file" || true) | tail -1 | cut -d= -f2- | tr -d "\"' \r"
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

USDC=$([ "$TOKEN" = circle ] && echo "$CIRCLE_USDC" || echo "$MOCK_USDC")
LABEL=$([ "$TOKEN" = circle ] && echo "Circle USDC" || echo "mock USDC")

balance() {
  local raw
  if raw=$(cast call "$USDC" "balanceOf(address)(uint256)" "$ADDRESS" --rpc-url "$RPC" 2>/dev/null); then
    raw=${raw%% *} # cast appends a scientific form, e.g. "12200000 [1.22e7]"
    printf '%s %s' "$(awk -v r="$raw" 'BEGIN { printf "%.2f", r / 1e6 }')" "$LABEL"
  else
    printf 'unknown (RPC %s did not answer)' "$RPC"
  fi
}

wait_for_change() {
  # Public RPCs lag: wait up to ~60 s for the balance to move.
  local before=$1
  for _ in $(seq 1 12); do
    sleep 5
    [ "$(balance)" != "$before" ] && break
  done
}

echo "Address: $ADDRESS (Base Sepolia)"
echo "Token:   $LABEL $USDC"
BEFORE=$(balance)
echo "Before:  $BEFORE"

# --- Mock USDC --------------------------------------------------------------------------------------
if [ "$TOKEN" = mock ]; then
  if [ -n "${FUND_USDC_DRY:-}" ]; then
    echo "FUND_USDC_DRY set: not sending (would $([ "$VIA" = api ] && echo "POST $API_URL/faucet" || echo "mint $AMOUNT mock USDC"))."
    exit 0
  fi
  if [ "$VIA" = api ]; then
    RESP=$(mktemp)
    trap 'rm -f "$RESP"' EXIT
    CODE=$(curl -sS -m 90 -o "$RESP" -w '%{http_code}' -X POST "${API_URL%/}/faucet" -H 'content-type: application/json' \
      --data "$(printf '{"address":"%s"}' "$ADDRESS")") || CODE=000
    echo
    case "$CODE" in
      200)
        if grep -q '"already_claimed"' "$RESP"; then
          echo "API faucet: this address already claimed its one-time drop. Use --via mint for more."
        else
          echo "API faucet: $(sed -E 's/.*"usdc":\{"amount":"([0-9]+)","txHash":"(0x[0-9a-f]+)".*/\1 base units, tx https:\/\/sepolia.basescan.org\/tx\/\2/' "$RESP")"
          wait_for_change "$BEFORE"
        fi ;;
      *) echo "API faucet: HTTP $CODE: $(head -c 300 "$RESP")" ;;
    esac
    echo "After:   $(balance)"
    [ "$CODE" = 200 ]
    exit
  fi

  UNITS="${AMOUNT}000000"
  SIGNER_KEY=${MINTER_PRIVATE_KEY:-$(env_value RELAYER_PRIVATE_KEY "$API_ENV_FILE")}
  MINTER_ROLE=$(cast keccak "MINTER_ROLE")
  if [ -n "$SIGNER_KEY" ]; then
    SIGNER=$(cast wallet address --private-key "$SIGNER_KEY")
    if [ "$(cast call "$USDC" "hasRole(bytes32,address)(bool)" "$MINTER_ROLE" "$SIGNER" --rpc-url "$RPC")" != true ]; then
      echo "$SIGNER has no MINTER_ROLE on $USDC; falling back to the deployer." >&2
      SIGNER_KEY=""
    fi
  fi
  TMPROLE=""
  if [ -z "$SIGNER_KEY" ]; then
    SIGNER_KEY=$(env_value DEPLOYER_PRIVATE_KEY)
    [ -n "$SIGNER_KEY" ] || { echo "No minter key: set MINTER_PRIVATE_KEY, RELAYER_PRIVATE_KEY in $API_ENV_FILE, or DEPLOYER_PRIVATE_KEY." >&2; exit 1; }
    SIGNER=$(cast wallet address --private-key "$SIGNER_KEY")
    if [ "$(cast call "$USDC" "hasRole(bytes32,address)(bool)" "$MINTER_ROLE" "$SIGNER" --rpc-url "$RPC")" != true ]; then
      echo "Deployer $SIGNER (token admin) grants itself MINTER_ROLE for this mint."
      cast send "$USDC" "grantRole(bytes32,address)" "$MINTER_ROLE" "$SIGNER" --private-key "$SIGNER_KEY" --rpc-url "$RPC" >/dev/null
      TMPROLE=1
    fi
  fi
  echo "Minting $AMOUNT mock USDC from $SIGNER…"
  TX=$(cast send "$USDC" "mint(address,uint256)" "$ADDRESS" "$UNITS" --private-key "$SIGNER_KEY" --rpc-url "$RPC" --json | sed -E 's/.*"transactionHash":"(0x[0-9a-f]+)".*/\1/')
  if [ -n "$TMPROLE" ]; then
    cast send "$USDC" "revokeRole(bytes32,address)" "$MINTER_ROLE" "$SIGNER" --private-key "$SIGNER_KEY" --rpc-url "$RPC" >/dev/null
    echo "Revoked the deployer's temporary MINTER_ROLE."
  fi
  unset SIGNER_KEY
  echo "Mint tx: https://sepolia.basescan.org/tx/$TX"
  wait_for_change "$BEFORE"
  echo "After:   $(balance)"
  exit 0
fi

# --- Circle USDC (mainnet-like testing, D-47) -------------------------------------------------------
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
  200 | 201 | 204) wait_for_change "$BEFORE" ;;
esac
echo "After:   $(balance)"
[ "$CODE" = 200 ] || [ "$CODE" = 201 ] || [ "$CODE" = 204 ]

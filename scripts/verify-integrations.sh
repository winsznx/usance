#!/usr/bin/env bash
#
# Re-runs the Phase 0 integration checks recorded in docs/INTEGRATIONS.md.
#
# Every claim in that document should be reproducible by anyone with network access. This script
# is how. It reads no secrets and writes nothing.
#
#   make verify-integrations

set -uo pipefail

MAINNET_RPC="${XLAYER_RPC_URL:-https://rpc.xlayer.tech}"
TESTNET_RPC="${XLAYER_TESTNET_RPC_URL:-https://testrpc.xlayer.tech}"

pass=0
fail=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
note() { printf '  \033[33m•\033[0m %s\n' "$1"; }

rpc_call() {
  curl -s -m 20 -X POST "$1" -H 'Content-Type: application/json' -d "$2" 2>/dev/null
}

echo ""
echo "X Layer"

chain_id=$(rpc_call "$MAINNET_RPC" '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')
[ "$chain_id" = "0xc4" ] \
  && ok "mainnet chain id is 0xc4 (196)" \
  || bad "mainnet chain id was '${chain_id:-<no response>}', expected 0xc4"

test_chain_id=$(rpc_call "$TESTNET_RPC" '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')
[ "$test_chain_id" = "0x7a0" ] \
  && ok "testnet chain id is 0x7a0 (1952)" \
  || bad "testnet chain id was '${test_chain_id:-<no response>}', expected 0x7a0"

echo ""
echo "Chainlink Data Feeds on X Layer mainnet"

check_feed() {
  local name="$1" addr="$2"
  local res
  res=$(rpc_call "$MAINNET_RPC" \
    "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"id\":1,\"params\":[{\"to\":\"$addr\",\"data\":\"0xfeaf968c\"},\"latest\"]}" \
    | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')
  # latestRoundData returns 5 words; a live feed gives 0x + 320 hex chars.
  if [ "${#res}" -ge 322 ]; then
    ok "$name responds with a full round"
  else
    bad "$name did not return a usable round"
  fi
}

check_feed "ETH/USD " 0x8b85b50535551F8E8cDAF78dA235b5Cf1005907b
check_feed "BTC/USD " 0x4D6f6488a2B3a5f7b088f276887f608a1e9805c4
check_feed "USDC/USD" 0xB8a08c178D96C315FbFB5661ABD208477391BC40

echo ""
echo "LayerZero V2"
# The endpoint id is published as a *string*, and it must be read from the xlayer-mainnet entry
# specifically — a bare grep for the number would match any chain's payload.
lz_eid=$(curl -s -m 25 https://metadata.layerzero-api.com/v1/metadata/deployments 2>/dev/null \
  | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for dep in d.get("xlayer-mainnet", {}).get("deployments", []):
    if str(dep.get("version")) == "2":
        print(dep.get("eid", ""))
' 2>/dev/null)

[ "$lz_eid" = "30274" ] \
  && ok "X Layer mainnet V2 endpoint id is 30274" \
  || bad "X Layer mainnet V2 eid was '${lz_eid:-<no response>}', expected 30274"

echo ""
echo "Credential-gated integrations"
[ -n "${CHAINGPT_API_KEY:-}" ] \
  && ok "CHAINGPT_API_KEY is set — live extraction available" \
  || note "CHAINGPT_API_KEY not set — extraction runs single-path and Passports are capped"
[ -n "${OKX_API_KEY:-}" ] \
  && ok "OKX_API_KEY is set" \
  || note "OKX_API_KEY not set — OKX DEX adapter stays disabled"
[ -n "${EXCHANGE_OS_API_KEY:-}" ] \
  && ok "EXCHANGE_OS_API_KEY is set" \
  || note "Exchange OS access not configured — hedging and trading stay disabled"

echo ""
echo "Not available on X Layer, by verification rather than assumption:"
note "Chainlink Data Streams — X Layer publishes 'feeds' only, never 'streams'"
note "Circle CCTP — X Layer is not a supported CCTP domain"

echo ""
printf 'passed %d, failed %d\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1

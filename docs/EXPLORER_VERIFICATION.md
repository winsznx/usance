# Explorer source verification — X Layer testnet (1952)

**Status as of 2026-09-07 (Phase 05):** `BLOCKED_EXTERNAL`.

## What is already true

`deployments/1952.json` carries `"verified": false` with the note *"Bytecode is live on chain.
Explorer source verification has not been performed."*

- **Bytecode match** is proven: `node scripts/live-xlayer.mjs` reads the deployed runtime bytecode
  for all 18 addresses and every one matches what this checkout builds (Phase 00 baseline; the
  drift gate `scripts/check-proof-currency.mjs` and `Deployment.t.sol` enforce it continuously).
- **Explorer source verification** is a different, additional proof — it publishes the Solidity
  source + compiler settings to the block explorer so a third party can read the code beside the
  bytecode. It has not been done.

These are not the same claim and this repo does not conflate them.

## Why it is blocked

| Path | Result |
|---|---|
| **OKLink API** (`www.oklink.com/api/v5/explorer/xlayer_test/api`) — the X Layer testnet explorer | Requires an `OK-ACCESS-KEY` header. `curl` without one returns `401 "Request header OK-ACCESS-KEY can not be blank."`. The key comes from an OKX / OKLink developer account; none is configured for this repo. |
| **Sourcify** (the keyless, explorer-independent verifier) | `GET sourcify.dev/server/check-by-addresses?...&chainIds=1952` → `404`. Sourcify's supported-chains list does not include X Layer testnet (1952). |
| **`forge verify-contract --verifier blockscout`** | X Layer testnet's explorer is OKLink, not a Blockscout instance, so there is no Blockscout verifier URL to target. |

## The exact action that would unblock it

An **OKLink API key** (free, from an OKLink/OKX account). With it, each deployed contract verifies
with:

```bash
forge verify-contract <address> <src/path:Contract> \
  --chain 1952 \
  --verifier oklink \
  --verifier-url https://www.oklink.com/api/v5/explorer/xlayer_test/api \
  --etherscan-api-key "$OKLINK_API_KEY" \
  --compiler-version 0.8.28 \
  --num-of-optimizations 200 \
  --constructor-args <abi-encoded args from the Deploy script broadcast>
```

Compiler settings to declare (from `contracts/foundry.toml`): solc `0.8.28`, `evm_version = cancun`,
`optimizer = true`, `optimizer_runs = 200`, `via_ir = false`, `bytecode_hash = "none"`,
`cbor_metadata = false`. Constructor arguments per contract come from
`contracts/broadcast/Deploy.s.sol/1952/run-latest.json`.

Contracts to verify (16, from `deployments/1952.json`): `authority`, `assetRegistry`,
`evidenceRegistry`, `passportRegistry`, `riskPolicyRegistry`, `oracleAdapter`, `collateralVault`,
`liquidityVault`, `financingEngine`, `clearingHouse`, `feeController`, `mandateRegistry`,
`delegationGateway`, `intentBook`, `sentinelTemplateRegistry`, `sentinelInstanceRegistry`.

## When it is done

- Run the verifications, record the explorer URLs and the per-contract status here.
- The deploy pipeline should set `"verified": true` in the manifest **only** after an explorer
  read-back confirms the published source (`AF.` in `MASTER_COMPLETION_CHECKLIST.md`), never from
  a bytecode match alone.
- Add `make verify-explorer` and wire it into the release checklist (not CI — it needs the key).

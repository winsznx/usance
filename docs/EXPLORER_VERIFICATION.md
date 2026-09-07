# Explorer source verification — X Layer testnet (1952)

**Status: `MANUAL_ACTION_REQUIRED`** (was `BLOCKED_EXTERNAL_API_KEY` through Phase 05).

The OKLink API-key creation path documented by OKLink is not reachable from the public account
flow, so automated `forge verify-contract` is not an option. The supported fallback is OKLink's
browser form:

> <https://www.oklink.com/x-layer-testnet/verify-contract-preliminary>

It accepts a Solidity **Standard JSON Input**, which is what this repo needs — the sources are
imported, not flat, so flattening is the wrong method.

## Bytecode match is a separate, standing proof

`deployments/1952.json` carries `"verified": false` with the note *"Bytecode is live on chain.
Explorer source verification has not been performed."*

- **Bytecode match** is proven and enforced continuously: `scripts/live-xlayer.mjs` reads the
  deployed runtime bytecode for all 16 addresses and compares it to what this checkout builds; the
  proof-currency gate and `Deployment.t.sol` back it. `scripts/gen-verification-package.mjs`
  additionally records, per contract, the on-chain runtime keccak, the local-build runtime keccak,
  and a length check — all 16 match (exact keccak for the immutable-free `Authority`; length +
  clean creation-code / constructor-args split for the rest).
- **Explorer source verification** is a different, additional proof: it publishes the Solidity
  source + compiler settings to the explorer so a third party can read the code beside the
  bytecode. That is the step that is `MANUAL_ACTION_REQUIRED`.

These are not the same claim and this repo does not conflate them.

## The package

`node scripts/gen-verification-package.mjs` regenerates, for the **current 1952 deployment only**
(14 core contracts from `Deploy.s.sol` broadcast `run-1787093382203` at `cf08fa1`; 2 Sentinel
registries from `DeploySentinels.s.sol` broadcast `run-1787215876793` at `a3d89fe`):

| File | Contents |
|---|---|
| `docs/verification/1952/CHECKLIST.md` | one section per contract — address, contract name for the form, Standard JSON path, ABI-encoded + decoded constructor args, source commit, expected on-chain runtime keccak, local-build runtime keccak, length check |
| `docs/verification/1952/standard-json/<Contract>.json` | the Standard JSON Input to paste into the form (28-ish inlined sources, `optimizer {enabled, runs:200}`, `evmVersion cancun`, `metadata {bytecodeHash:"none", appendCBOR:false}`; absolute-path remappings stripped) |
| `docs/verification/1952/package.json` | the same, machine-readable |

**Uniform settings for every contract** (from `contracts/foundry.toml`, and already baked into each
Standard JSON): solc `v0.8.28`, optimizer **on**, runs **200**, EVM `cancun`, via-IR **off**,
metadata bytecode hash **none**, CBOR metadata **off**, license `BUSL-1.1`. No linked libraries —
`RiskMath`, `Types`, `MerkleLib` are `internal` and inlined.

## Doing it

For each row in `CHECKLIST.md`, on the form:

1. paste the address;
2. compiler type **Solidity (Standard-Json-Input)**, version `v0.8.28`;
3. upload / paste `docs/verification/1952/standard-json/<Contract>.json`;
4. contract name: the `src/...:Name` from the checklist;
5. constructor arguments: the ABI-encoded hex from the checklist (`0x` for `Authority`-style
   no-arg contracts);
6. submit; the explorer runs its own bytecode match.

The API key stays out of the repo, logs, docs, fixtures and generated proof. When OKLink restores
the key path, `forge verify-contract --verifier oklink --verifier-url
https://www.oklink.com/api/v5/explorer/xlayer_test/api --etherscan-api-key "$OKLINK_API_KEY"` with
the same settings is the automated equivalent — the key is read from the environment only.

## When it is done

- Record each contract's explorer URL and status in `docs/verification/1952/CHECKLIST.md`.
- Set `deployments/1952.json` `"verified": true` **only** after an explorer read-back confirms the
  published source, never from a bytecode match alone.
- `make verify-explorer` may wrap the automated path once the key path is restored (not CI — it
  needs the key).

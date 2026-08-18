# Setup

Everything here works from a fresh clone. No developer-specific machine state, no absolute paths, no
global installs beyond the toolchain `make doctor` names.

## Toolchain

```
node     >= 20
pnpm     >= 9
forge    (foundry)
python3  (fixture generation)
```

Optional, only for the security gate:

```
pipx install slither-analyzer
```

```bash
make doctor      # confirms each is present and prints its version
make bootstrap   # installs every dependency
```

## Verify without touching a network

```bash
make test        # Forge + TypeScript + Rust, no network required
make build
make lint
```

Expected: 144 Forge, 197 TypeScript, 102 Rust. `make test-differential` alone proves the four
implementations of the risk pipeline agree to the wei across all 28 canonical scenarios.

```bash
make demo-local  # the whole mechanism, deterministically, with no wallet and no chain
```

## Read the live deployment

No key needed. This reads X Layer testnet and checks the committed manifest against it.

```bash
make test-live-xlayer
```

It verifies that every contract in the manifest has code, that deployed runtime bytecode matches
what this checkout compiles, that the risk epoch is non-zero and that the settlement asset is bound.
A manifest pointing at a superseded deployment fails here rather than passing — that is the specific
failure it was written for.

## Configuration

Every variable is optional. Nothing below is required to run the tests.

| Variable | Used for |
| --- | --- |
| `DEPLOYER_PRIVATE_KEY` | Deploying and running live scenarios |
| `XLAYER_TESTNET_RPC_URL` | Overrides the default testnet endpoint |
| `CHAINGPT_API_KEY` | The second extraction path, and `make audit-contracts` |
| `USANCE_GOVERNANCE` | Governance holder after deployment. Defaults to the deploy key |
| `USANCE_GUARDIAN` | Guardian. Defaults to the deploy key |
| `USANCE_SETTLEMENT_TOKEN` / `_FEED` | Required on mainnet. On testnet, stand-ins are deployed |

Put them in `.env`, which is gitignored. Nothing reads a credential at build time.

Two endpoints are tried for X Layer testnet. The public RPC drops DNS resolution for stretches, and
viem's `retryCount` does not cover `ENOTFOUND` — a name that will not resolve is not a request that
failed, so the retry never sees it.

## Deploy

```bash
make deployer-create        # generates a key into .env
make deployer               # prints the address and whether it is funded
# fund it from the X Layer testnet faucet
make deploy-testnet
```

`deploy-testnet` broadcasts, regenerates `deployments/manifest.ts` from the broadcast receipts, and
runs the live verifier. Manifest generation is part of deploying rather than a step to remember: it
was a separate manual step exactly once, and the manifest then described the previous deployment
while every check reported green.

The script refuses to run on any chain that is not X Layer, and refuses to create testnet fixture
tokens on mainnet.

## Prove the lifecycle on chain

```bash
node scripts/live-state.mjs                                   # read-only
node --experimental-transform-types scripts/commit-passport.mjs franklin-fobxx-2026
node scripts/live-scenario.mjs
```

`commit-passport` runs the pipeline fresh every time and regenerates its calldata; it never replays
a stored blob. It writes its proof record only after reading the commitment back from the chain.

`live-scenario` is re-runnable. It tops collateral up to a target rather than depositing
unconditionally, sources the interest that repay-all needs, and carries prior-run setup transactions
forward as provenance.

If a proof record is lost, do not re-commit to regenerate it — versions are permanent and "v2,
because a JSON file went stale" would be in the asset's history forever. Rebuild it from events:

```bash
node --experimental-transform-types scripts/reconcile-passport.mjs franklin-fobxx-2026
```

The `--experimental-transform-types` flag is needed wherever a script imports workspace TypeScript.
Node's strip-only mode rejects parameter properties, which `packages/schemas` uses.

## Security gate

```bash
make slither            # fails only on findings that have not been triaged
make slither-baseline   # re-seed after intentional changes; every new entry needs a written reason
```

## Web

```bash
pnpm --filter @usance/web dev
```

`/assets` and `/proof/:id` need no wallet. `/app` and the four action routes ask for one, and refuse
to show a quote when no chain data is available rather than rendering placeholder balances.

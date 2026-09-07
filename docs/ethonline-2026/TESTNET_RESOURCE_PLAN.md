# ETHOnline 2026 — testnet resource plan

Phase 07 is **Hedera + Sepolia + provider infrastructure only**. No Base resources are requested
(Base is Phase 08).

Resources are requested **one at a time, at the exact point implementation reaches the
dependency** (Phase 07 brief §28, §47). This table is the plan; the "Status" column is updated as
each is provided.

| # | Network | Account | Purpose | Required asset | Minimum practical balance | How obtained | Status |
|---|---|---|---|---|---|---|---|
| 1 | Hedera testnet (296) | deployer `0.0.x` / its EVM alias `0x…` | Deploy `FacilityValuation` + `InstitutionalFacility` + the ATS security tokens (A, B, C) + compliance config; run the substitution lifecycle | HBAR (testnet) | ~50 HBAR (ATS Diamond deploys are large; several contracts + config txs + lifecycle) | `portal.hedera.com` faucet (1000 HBAR/day) after creating a testnet account | **NEEDED FIRST** |
| 2 | Ethereum Sepolia | ENS org wallet `0x…` | Register `usance.eth` (or a beta test name) on the ENSv2 Sepolia app; create the subname hierarchy; grant / revoke the EAC facility role | Sepolia ETH | ~0.3 ETH (name registration + several EAC grant/revoke txs + a subregistry deploy) | Sepolia faucets (e.g. `sepolia-faucet.pk910.de`, Alchemy, Google Cloud) | pending (after step 5 of the execution order) |
| 3 | Privy | app `PRIVY_APP_ID` | Server wallet + authorization key / key quorum + policy + intent for the org approval | none (hosted) | n/a | `dashboard.privy.io` — create an app, copy `PRIVY_APP_ID` + `PRIVY_APP_SECRET` into the local shell (never chat, never git) | pending (after step 6) |
| 4 | Chainlink CRE | CRE CLI login / config | Run the confidential lender-policy workflow in CLI simulation; store the private policy inputs as CRE secrets | none for simulation | n/a | CRE CLI install + `cre login` (simulation needs no account-team enrollment); live-network deployment would need enrollment (tracked separately) | pending (after step 7) |

## Environment variables (names only — values set locally, never committed)

| Variable | Sponsor | Set by |
|---|---|---|
| `HEDERA_TESTNET_OPERATOR_ID` / `HEDERA_TESTNET_OPERATOR_KEY` | Hedera | user, local shell |
| `HEDERA_TESTNET_RPC_URL` | Hedera | default `https://testnet.hashio.io/api`, overridable |
| `ENS_SEPOLIA_DEPLOYER_KEY` | ENS | user, local shell |
| `SEPOLIA_RPC_URL` | ENS | user, local shell |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | Privy | user, local shell |
| `PRIVY_AUTHORIZATION_KEY` (if used) | Privy | user, local shell |
| `CRE_*` (per CRE CLI config) | Chainlink | user, local shell / CRE CLI |

All are read via `process.env` / `--env-file` at run time. `.env` is gitignored. `scripts/` that
touch chains read the key from the environment directly, matching the existing X Layer deployer
pattern (`DEPLOYER_PRIVATE_KEY`).

## What is NOT requested

- No Base Sepolia ETH, Base mainnet ETH, or Base USDC (Phase 08).
- No X Layer redeployment or OKLink API key (Phase 05 / 06 settled; `MANUAL_ACTION_REQUIRED`).
- No mainnet anything.

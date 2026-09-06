# COMPETITION_MATRIX.md

## Rule

The company does not change identity for competitions. Each program funds a distinct Usance market/module.

| Program | Company story | New judged delta | Existing work shown only as context | Critical external dependencies |
|---|---|---|---|---|
| Base Batches 004 | Usance company | Base default production, portfolio-backed programmable-equity credit | X Layer proof/history, generic core | Coinbase B20 assets, Base liquidity/oracles |
| ETHOnline 2026 | Usance Collateral | institutional facility + collateral substitution | existing Passport/risk/receipts/authority patterns | Hedera ATS, ENSv2, Privy, Chainlink CRE |
| OKX Dev Day 2026 | Usance X | xStocks capital market domain + OKX/X Layer production delta | existing X Layer testnet core | xStocks, USDC/CCTP, OKX surfaces, possible Exchange OS access |

## Base Batches 004

- Application deadline: 2026-09-09.
- Base allows multichain companies but explicitly expects Base to be the default network.
- Application is **Usance**, not a hackathon fork.
- Pitch:
  > Usance turns programmable real-world assets into usable capital, starting with portfolio-backed credit against tokenized stocks on Base.
- Do not claim exclusivity.
- Do not claim Usance invented stock lending; differentiate on instrument normalization, recovery-aware portfolio risk, facilities, collateral operations and bounded automation.

## ETHOnline 2026

At kickoff:

- freeze `baseline_commit`;
- capture current clean/dirty state;
- create `PREEXISTING.md`;
- create new-work manifest;
- verify Continuity eligibility and sponsor toggles in the actual dashboard.

Judging story:

> **Keep the financing open. Replace the collateral.**

Do not show Base/X Layer in the main sponsor diagram.

### Target integrations

- Hedera ATS — asset/lifecycle state;
- ENSv2 — public institution/facility authority/discovery;
- Privy — actual organizational signing/quorum;
- Chainlink CRE — confidential lender policy.

Current caution:

- Chainlink Confidential Workflow qualification requirements are not finalized on the current ETHOnline prize page.
- ENSv2 is beta/Sepolia.
- Hedera Continuity-specific prizes may have separate prior-Hedera requirements; do not assume eligibility.

## OKX Dev Day 2026

User-supplied program dates:

- applications close 2026-09-11 23:59 UTC;
- build 2026-09-17 to 2026-09-25;
- finalist selection 2026-09-28 to 2026-09-30;
- Singapore finale 2026-10-06.

Primary track:

**X Layer: Tokenized stocks and RWA**

New delta:

- production xStocks adapter;
- rebasing/corporate-action-safe collateral;
- xStocks portfolio capacity;
- native USDC financing;
- OKX Wallet/distribution;
- OKX DEX route/handoff;
- Builder Code proof;
- Exchange OS only if actual access is provided;
- Sentinel or collateral-substitution flow only if it compounds the above and is genuinely new work.

Pitch:

> OKX is bringing tokenized markets to X Layer. Usance makes those instruments reusable capital.

## Evidence isolation

`competitions/<event>/` must contain:

- baseline;
- commit range;
- sponsor dependencies;
- testnet/mainnet addresses;
- proof ids;
- demo path;
- claims safe to make;
- claims not safe to make;
- known limitations.

No competition-specific lie survives outside its folder.

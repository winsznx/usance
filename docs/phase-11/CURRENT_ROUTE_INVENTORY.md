# Current route inventory — Phase 11 entry

Captured 2026-09-09 from `apps/web/app`. Status means product/proof state, not an implied production claim.

| Route family | Audience | Read/write | Source | Environment | Status |
|---|---|---|---|---|---|
| `/` | Public | Read | Static product content | Public | Existing |
| `/assets`, `/assets/[assetId]` | Public/auditor | Read | Generated evidence fixtures + deterministic pipeline | Offchain proof | Existing; not facility admission |
| `/app` and account routes | Capital user | Read + wallet writes | X Layer 1952 manifest + live RPC | X Layer testnet | Existing |
| `/app/borrow`, `/repay`, `/withdraw`, `/collateral/add` | Capital user | Wallet writes | X Layer `ClearingHouse` path | X Layer testnet | Existing |
| `/earn`, `/earn/positions` | Liquidity provider | Read + wallet writes | X Layer liquidity-vault path | X Layer testnet | Existing |
| `/app/sentinels`, `/app/mandates` | Capital user | Read + bounded writes | X Layer mandate/Sentinel registries | X Layer testnet | Existing |
| `/proof/[receiptId]`, `/app/activity/*` | Auditor/counterparty | Read | Generated receipts + activity endpoint | X Layer testnet | Existing |
| `/status` | Public/operator | Read | Typed integration status | Mixed | Needs Phase 11 truthfulness update |
| `/capital`, `/api/capital/base-sepolia` | Capital user/auditor | Read | Pinned-block `PortfolioRevolvingCredit` reads; lifecycle JSON is evidence only | Base Sepolia | `LIVE_TESTNET` / `CANARY_PROVISIONAL`; fails closed on stale, unavailable, or unknown portfolio truth |
| `/developers/sentinels/*` | Developer | Read | Sentinel template registry/docs | X Layer testnet | Existing; narrow |
| `/api/account`, `/activity`, `/asset-position`, `/earn/*`, `/sentinels/*` | App client | Read | Active X Layer RPC/indexed read model | X Layer testnet | Existing, unversioned |
| `/api/ready`, `/api/health` | Operator/app client | Read | Manifest + RPC checks | X Layer testnet | Existing |

## Known absences at entry

- No institutional workspace route, even though the Hedera/ENS/Privy/CRE lifecycle is proven as a
  testnet/simulation composition.
- No generic developer v1 read API.
- No product surface for the NVDAx `BLOCKED_EXTERNAL` multiplier conflict.

## Boundary

The Base portfolio facility, X Layer credit facility, and Hedera institutional facility remain
separate authoritative domains. This inventory must not be read as authorization to aggregate them
into one borrowing-power number.

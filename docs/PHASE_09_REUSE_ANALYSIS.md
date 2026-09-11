# Phase 09 reuse analysis

Status: **decision record** — 2026-09-08.

| Component | Decision | Why |
|---|---|---|
| `PortfolioRevolvingCredit` | Reuse with an additive custody/quantity seam | Lifecycle, fees, policy epoch, stale-snapshot protection and `PortfolioRiskEngine` composition are provider-neutral. It currently hard-codes `ScaledCollateralVault`, `creditedRaw`, and `FACTOR_IN_PRICE` raw valuation, which must be abstracted. |
| `PortfolioRiskEngine` | Reuse as-is | Pure and provider-neutral; it consumes a correctly derived economic quantity/value. |
| `PortfolioRiskPolicyRegistry` | Reuse as-is | Policies and risk groups are keyed by instrument identity and have no B20 accounting behavior. X Layer receives a new provisional policy; the Base policy is not modified. |
| `ScaledCollateralVault` | Do not reuse for xStocks | It maintains nominal `creditedRaw` entitlements. A rebasing xStock's `balanceOf(vault)` changes on a corporate action, which can make this vault over-owe or orphan a balance delta. |
| Phase 03 corporate-action model | Reuse as-is | It already specifies the share-pool conservation, dust, surplus and activation-window rules needed for xStocks. Its Solidity consumer is not yet built. |
| `InstrumentAccountingMode` | Reuse as-is | `REBASING_BALANCE` and `SHARE_BASED_CUSTODY` precisely express xStocks and the Usance custody pool. Accounting mode remains outside `instrumentId`. |
| `IInstrumentAdapter` | Reuse shape; implement a new xStocks adapter | Identity, decimals, snapshot and transferability are reusable. Its `rawBalanceOf` naming/comment is B20-specific and must not drive xStocks valuation. |
| Oracle interface | Add a generic quantity-price adapter seam | Existing Base oracle assumes `FACTOR_IN_PRICE`. Exact xStocks/X Layer oracle convention is unverified, so production admission stays restricted; synthetic testnet uses a test-only oracle. |
| `ILiquidityObserver` | Reuse interface with X Layer adapter | Its method shape is provider-neutral. Production liquidity stays unready until an exact X Layer exit venue and size-aware observation source are verified. |
| `IExecutionVenue` | New only when a real route exists | Current OKX public documentation establishes X Layer DEX API access, not xStocks route support. Phase 09 will not fabricate execution. |
| `ICashTransport` | Deferred | Native X Layer settlement is sufficient for the facility. CCTP availability does not create a cross-domain lifecycle requirement. |

## Implementation decision

Implement one generic custody interface consumed by a provider-neutral revision of
`PortfolioRevolvingCredit`. Both `ScaledCollateralVault` and the new `RebasingCollateralVault`
implement it. The facility treats the custody claim as opaque and values only the vault's effective
economic quantity at the pinned corporate-action state.

This is preferable to an `XStocksPortfolioRevolvingCredit` fork and leaves the historical Base
Sepolia deployment tied to its prior immutable source/commit proof.

## External constraints

- xStocks EVM `balanceOf()` is multiplier-adjusted; `sharesOf()` is the stable internal quantity.
- xStocks wrappers may offer an ERC-4626 non-rebasing representation, but no exact X Layer wrapper
  deployment has been verified. Phase 09 therefore tests a clearly-labelled synthetic rebasing token
  on 1952-style semantics and keeps real xStocks mainnet evidence read-only.
- Native USDC/CCTP support is now available on X Layer according to Circle, but exact deployment
  addresses require current official registry and chain verification.
- Exact Chainlink xStocks/X Layer feed coverage remains unverified. No production oracle claim is
  made by this phase.

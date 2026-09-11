# PHASE 09 — X LAYER / XSTOCKS DOMAIN

Status: **TECHNICAL_MODEL_COMPLETE / PRODUCTION_ADMISSION_BLOCKED_EXTERNAL**.

## Baseline

| Item | Value |
| --- | --- |
| Starting SHA | `15b2790` |
| Legacy X Layer core | `deployments/1952.json`, untouched |
| New deployment | `deployments/phase09-xstocks-1952.json` — separate synthetic-only facility |

## Current official capability matrix

| Provider | Primitive | Environment | Status | Evidence |
| --- | --- | --- | --- | --- |
| xStocks | multiplier and stable-share semantics | EVM | `EXTERNAL_INTEGRATION` | xStocks multiplier documentation and public API contract |
| X Layer | RPC | mainnet `196`, testnet `1952` | `CONFIRMED` | OKX X Layer RPC documentation |
| Circle | CCTP | X Layer mainnet | `CCTP_V2_LIVE` | Circle's August 2026 launch and X Layer product page; contract-address table has not yet caught up |
| Circle | native USDC | X Layer | `CONFIRMED` | Circle launch identifies mainnet and testnet contracts |
| Chainlink | exact NVDAx/X Layer oracle | mainnet | `IDENTIFIED_NOT_INTEGRATED` | issuer API lists pull-based feed, verifier, and feed ID |
| OKX | xStocks execution route | X Layer | `BLOCKED_EXTERNAL` | no proven xStocks route or credentials; no venue adapter is claimed |
| Exchange OS | execution | X Layer | `ACCESS_REQUIRED` | no access/workflow available |

## Facility reuse decision

`PortfolioRevolvingCredit` is reused through `IPortfolioCollateralVault`. Its B20-specific raw
claim assumption is now confined to `ScaledCollateralVault`; the facility receives an opaque claim
and only prices the vault's `valuationQuantity`. `PortfolioRiskEngine` and
`PortfolioRiskPolicyRegistry` are reused unchanged. The legacy X Layer core is independent.

## xStocks custody model

```text
stable token shares -> stable Usance claim shares -> token balanceOf(vault)
    (adjusted once by the issuer multiplier) -> economic quantity -> oracle price
    -> PortfolioRiskEngine recognized value
```

`RebasingCollateralVault` measures before/after `sharesOf` on deposit, debits claim shares before
transfer, and classifies direct share donations as surplus. It does not use `ScaledCollateralVault`.
`XStocksInstrumentAdapter` binds the current onchain multiplier to a reporter for pending-action
state. A stale/mismatched reporter, transfer uncertainty, or pending action is fail-closed for new
risk.

## Test evidence

| Command | Result |
| --- | --- |
| `forge test --match-contract 'RebasingCollateralVaultTest|XStocksInstrumentAdapterTest|BasePortfolioLifecycleTest|B20CompatTest|PortfolioRiskConformanceTest' -vv` | 32 passed, 0 failed |

The xStocks tests use `SYNTHETIC_TEST_XSTOCK` only. They cover stable custody claims through
multiplier increase/reverse split, two-user pro-rata ownership, donation classification, and
pending/stale/mismatched corporate-action state. Existing Base lifecycle and conformance tests
continue to pass.

## Exact candidates and mainnet characterization

NVDAx is issuer-confirmed at `0xc845b2894dbddd03858fd2d643b4ef725fe0849d`; read-only evidence is
recorded in `PHASE_09_EXTERNAL_EVIDENCE.md`. It is not admitted: the issuer API multiplier result
does not yet reconcile to the current onchain multiplier, and no credible secondary liquidation
route has been characterized.

## X Layer testnet deployment

On September 9, 2026, Usance deployed a separate `PHASE09_SYNTHETIC_XSTOCKS_FACILITY_V1` on X
Layer testnet (`1952`). The deployment has its own manifest and does not replace, reference, or
modify `deployments/1952.json`. Its collateral is `SYNTHETIC_TEST_NVDAx`, its settlement token is
a test token, and its oracle is explicitly `TEST_ONLY`.

## Exit

**FAIL / not ready to close Phase 09.** Missing: exact mainnet instrument characterization, exact
native-USDC verification, an exact oracle/liquidity route, and a separately named X Layer testnet
deployment/lifecycle. CCTP and Exchange OS are not blockers because neither is required by this
custody proof.

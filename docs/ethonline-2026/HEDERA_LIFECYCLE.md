# ETHOnline 2026 — the live Hedera institutional lifecycle

Status: **`LIVE_TESTNET`** for the Hedera ATS + institutional-substitution portion. ENS / Privy / CRE
are the operator's own signatures in this run and are replaced by the real sponsor integrations in
the next steps.

Network: **Hedera testnet**, chain id 296, JSON-RPC relay `https://testnet.hashio.io/api`,
explorer `https://hashscan.io/testnet`. Operator `0.0.10405071` / `0x06622c6a328cc0a54C906Fde66Bc597B7FA904C1`.

## 1. The ATS securities (real ERC-1400, ATS v8 factory)

Issued by `packages/ethonline/src/hedera/issue-ats.cjs` against the canonical ATS testnet
deployment (factory `0.0.9213391`, BLR/resolver `0.0.9212226`). Proof:
`docs/ethonline-2026/proof/hedera-ats-issuance.json`.

| Series | Token id | Role | Compliance state |
|---|---|---|---|
| A | `0.0.10406896` (`0x93b8604abbcb68a353ccf5cc64bdda531ef48ff9`) | initially committed collateral | transferable |
| B | `0.0.10406931` (`0x2517f707c92c352fe15da6354038ee85a06c826d`) | eligible replacement | transferable |
| C | `0.0.10406957` (`0xd7aca3f93e37ae36bdf7d20bcf36f339e984d208`) | ineligible replacement | **PAUSED** (real ATS lifecycle op) |

Each: `Equity.create` → grant ISSUER+PAUSER → issue 10,000,000 whole shares to the borrower. C
additionally `Security.pause`. All tx hashes + HashScan links in the issuance proof.

## 2. The Usance stack on Hedera

Deployed by `packages/ethonline/src/hedera/deploy-facility.mjs`. Proof:
`docs/ethonline-2026/proof/hedera-facility-deployment.json`.

| Contract | Address |
|---|---|
| Authority | `0x7d8e033b7DA55399915Fb611c5d9159ba2410340` |
| EvidenceRegistry | `0xcd8d34a7c8E5fa667D27Cf3B6f926d340D85D3e0` |
| PassportRegistry | `0x58911762051b6cF8794303C5808194FC6352d7C6` |
| RiskPolicyRegistry | `0x680c9B81Fa081353cD08756a79d964e36398AAcd` |
| AssetRegistry | `0x54f4B891DBB8E660Adb06e32B47AF2019ff31E4e` |
| HederaTestOracleAdapter (§24 test price oracle) | `0xAfD56bD7ceb1f5b324880074C83175eFC0E64974` |
| FacilityValuation | `0x632F1B756E14D95B9E417126b06dC4E3C2d10DD8` |
| EthOnlineAuthorityVerifier | `0xF31eab8D779808b10E51682d69e45755e4f68003` |
| EthOnlinePolicyVerifier | `0xe625239733dD5282C5D2953e87B39C6A27F56deC` |
| SettlementToken (test USD, 6dp) | `0x69e4191B8Ed8Eb157010919afd785a189481C92D` |
| HederaAtsCollateralAdapter A / B / C | `0xA73fee136aCAE887251757a474c2D89811f32adD` / `0xC5E77C98165633c1B093b8bf76d1b923856dFf42` / `0x3F131Bde9dd165C303F27801fF32828B68C73f79` |
| **InstitutionalFacility** | **`0x6B0A0c10450E11C86e7b6b9A69068e43B28Ef8B7`** |

`facilityId` = `0x6534fdf67d36afeeb7118c7d81c7f4e06ab548735483ca249afcf12e6f75b1ee`
(`keccak256(abi.encode("USANCE_FACILITY_V1", "TERM_SECURED_CREDIT", homeDomainId, controller,
discriminator))`, home domain `hedera:testnet`).

## 3. Collateral commitment = the ATS Hold facet

`HederaAtsCollateralAdapter.commit` → `IAtsHold.createHoldFromByPartition(defaultPartition,
borrower, Hold{amount, expiry a century out, escrow = adapter, to = facility custody, data}, "")`.
`ThirdPartyType.AUTHORIZED` consumes an ERC-20 allowance the borrower grants the adapter. Once
held: the borrower cannot transfer the units and cannot reclaim them; only the adapter, driven by
the facility, releases (back to the borrower) or executes them. `committedOf` sums the live held
amounts from `getHoldForByPartition` — authoritative on-chain ATS state.

## 4. Positive lifecycle — A → B without unwinding

`node --env-file=.env packages/ethonline/src/hedera/run-substitution.mjs positive`. Proof:
`docs/ethonline-2026/proof/hedera-substitution-positive.json`.

| # | Step | Tx |
|---|---|---|
| 1 | lender approve + fund settlement | `0x725a15fd…`, `0x523fa1a4…` |
| 2 | borrower approve adapter A on the ATS token | `0xbe1251b7…` |
| 3 | borrower `commitInitialCollateral(150000)` → ATS Hold on A | `0xac201d6d…` |
| 4 | Privy org approval (ACTIVATE) submitted | `0x5ee1fc02…` |
| 5 | CRE ALLOW verdict (ACTIVATE) submitted | `0xda1f451c…` |
| 6 | lender `activate` → facility ACTIVE, fee + proceeds disbursed | `0x14a8ae7f…` |
| 7 | Privy org approval (SUBSTITUTE B) submitted | `0x45a75f8b…` |
| 8 | CRE ALLOW verdict (SUBSTITUTE B) submitted | `0x43051fc2…` |
| 9 | borrower approve adapter B on series B | `0xb29f0372…` |
| 10 | borrower `requestSubstitution(B, 150000)` | `0x2804b798…` |
| 11 | `commitReplacement` → **ATS Hold on B created; A still held** (`committedOf(A)=150000`, `committedOf(B)=150000`) | `0x1d6e3cb5…` |
| 12 | borrower `releaseOld` → A returned to the borrower, B is the collateral | `0x954e32ff…` |

**Result: the replacement (B) was committed before the old collateral (A) was released, and the
facility stayed `ACTIVE` throughout** (I-95, I-101 proven on chain).

## 5. Negative lifecycle — A → C is refused, collateral stays secured

`node --env-file=.env packages/ethonline/src/hedera/run-substitution.mjs negative`. Proof:
`docs/ethonline-2026/proof/hedera-substitution-negative.json`.

| # | Step | Result |
|---|---|---|
| 1 | Privy + CRE decisions for SUBSTITUTE C | submitted OK (the external systems said yes) |
| 2 | borrower approve adapter C on series C | **reverts `IsPaused()`** — C is paused |
| 3 | borrower `requestSubstitution(C, 150000)` | OK — the request is pinned (`0x5f51d382…`) |
| 4 | `commitReplacement` | **reverts** — the adapter's `canTransferByPartition` check fails on the paused C token |
| 5 | borrower `cancelSubstitution` | OK (`0x753c7e13…`) |

**Result: series C's ATS pause blocked the substitution; the current collateral stayed committed
and the facility stayed `ACTIVE`.** A load-bearing ATS control (§7, §40).

## 6. What is a test input here, and what is real

- **Real:** the ATS securities and their lifecycle (issue, pause); the ATS Hold custody; the
  Usance facility, its risk stack, and the substitution invariant enforced on chain; the
  `IAuthorityVerifier` / `IPolicyVerifier` signature checks.
- **Test input (documented):** the mark price (`HederaTestOracleAdapter`, §24 — no Chainlink feed
  exists for these securities on Hedera and faking one is forbidden). The settlement token is a
  test ERC-20.
- **Operator-played, replaced next:** the Privy org-approval signature, the CRE confidential-policy
  verdict signature, and the ENS EAC evidence digest are all the operator's own key in this run.
  ENS (Sepolia), Privy and CRE replace those in the following steps; the on-chain verifier
  contracts do not change.

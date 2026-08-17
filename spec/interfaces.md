# spec/interfaces.md — the frozen interface catalogue

Status: **frozen**. Adding a member to an enum, reordering a struct field, or widening a method
signature listed here is an RFC-level change, because three implementations and every adapter
encode these shapes.

Build state was verified by reading `contracts/src/`, `packages/*/src/`, `crates/` and `services/`
during this pass. The tree is under active construction, so §11 gives the mechanical way to
re-check rather than asking anyone to trust a table.

---

## 1. The rule

> **No external SDK type may appear in core accounting.** Not in a parameter, not in a return
> value, not in a struct field, not behind a type alias.

An SDK is somebody else's release schedule. The moment `viem`'s `Address`, LayerZero's
`MessagingParams` or Chainlink's `AggregatorV3Interface` appears in a function that decides how
much someone may borrow, an upgrade to a dependency becomes a change to the accounting, and the
differential property in `invariants.md` D-01 stops being checkable because two of the three
implementations cannot express the type at all.

The rule is not a preference. It is what makes `RiskMath.evaluate` a pure function of an argument
list that Solidity, TypeScript, Python and Rust can each hold.

### Where each layer may look

| Layer | May depend on | May never depend on |
|---|---|---|
| `contracts/src/libraries/` | `Types.sol` and nothing else | OpenZeppelin, any interface, any vendor type |
| `contracts/src/core/` | `Types`, `RiskMath`, sibling core contracts, `contracts/src/interfaces/`, OpenZeppelin token and utility primitives | anything under `adapters/`, any vendor interface |
| `contracts/src/interfaces/` | `Types.sol` | vendor SDK types in any Usance-facing signature |
| `contracts/src/adapters/` | everything above, plus the vendor's own interface | writing core state except through a guarded core function |
| `packages/domain/src/` | nothing | every npm package, `viem` included |
| `packages/xlayer/src/` | nothing at runtime | vendor types in exported signatures |
| `services/`, `apps/web/` | vendor SDKs freely | exporting a vendor type across a provider interface |

`IAggregatorV3` is the worked example. It lives in `contracts/src/interfaces/IOracleAdapter.sol`
next to `IOracleAdapter`, and it is imported by exactly one file: `ChainlinkFeedAdapter`.
`ClearingHouse` imports `IOracleAdapter` and has never heard of Chainlink. Replacing the price
source is one constructor argument and one `setOracle` call.

### Checks that hold today

Runnable, and each returns nothing when the rule holds:

```bash
grep -rn '^import' packages/domain/src/                                  # zero npm imports
grep -rln 'IAggregatorV3' contracts/src/core contracts/src/libraries     # no vendor type in core
grep -rn '^import' contracts/src/libraries/ | grep -v 'Types.sol'        # libraries import Types only
```

`packages/domain` and `packages/xlayer` both declare **zero runtime dependencies**; `vitest` and
`typescript` are devDependencies. `apps/web` depends on `viem` and `wagmi`, which is where vendor
types belong.

---

## 2. Conventions across every boundary

Applies to Solidity, TypeScript and any future language binding.

| Concept | Solidity | TypeScript | Never |
|---|---|---|---|
| USD amount | `uint256` at `1e18` | `bigint` | `number`, float, decimal string |
| Token amount | `uint256` raw units + `uint8 decimals` | `bigint` + `number` | a "human" amount |
| Ratio | `uint16` bps, `BPS = 10_000` | `number` | percentage float |
| Index, health factor | `uint256` at `1e18` | `bigint` | |
| Timestamp | `uint64` unix seconds | `number` | `Date`, ISO string on the wire |
| Identifier | `bytes32` | `` `0x${string}` `` | plain `string` |
| Duration | `uint64` seconds | `number` | milliseconds |

Timestamps and basis points are `number` in TypeScript because both are small integers by
construction and stay exact well below `2^53`. Money is never `number`. `packages/domain/src/risk.ts`
holds that line today, and `formatUsd` does string arithmetic rather than `Number(x) / 1e18`
precisely because the latter loses digits above `2^53` and would let the UI show a figure the
contract disagrees with.

Identifier derivation is frozen in `accounting.md §2` and implemented as pure functions so any
language can reproduce it:

```
assetId    = keccak256(abi.encode(chainId, tokenAddress))     AssetRegistry.assetIdFor
accountId  = keccak256(abi.encode("USANCE_ACCOUNT_V1", owner)) MandateRegistry.accountIdFor
evidenceId = keccak256(abi.encode(sourceHash, contentHash, effectiveAt))  EvidenceRegistry.evidenceIdFor
passportId = keccak256(abi.encode(assetId, version))          PassportRegistry.passportIdFor
intentId   = keccak256(abi.encode(accountId, mandateId, nonce, planHash)) IntentBook.intentIdFor
```

---

## 3. The frozen domain shapes

`contracts/src/libraries/Types.sol`. Enum **ordinals are load-bearing**: `status = max(base,
gateFloor, override)` depends on `AccountStatus` being monotone in restrictiveness, and
`EvidenceRegistry.supersede` depends on `SourceClass` being monotone in authority.

| Type | Members / fields | Mirrored in |
|---|---|---|
| `AccountStatus` | `NORMAL, NO_NEW_RISK, REDUCE_ONLY, MARGIN_CALL, LIQUIDATING, SETTLED, BAD_DEBT` | `risk.ts` `ACCOUNT_STATUS`, `gen_fixtures.py` `statusOrder` |
| `PassportStatus` | `NONE, ACTIVE, STALE, CONFLICTED, SUSPENDED, REVOKED` | `risk.ts` `PassportStatus` |
| `AssetStatus` | `UNREGISTERED, ACTIVE, PAUSED, SUSPENDED, RETIRED` | `risk.ts` `AssetStatus` |
| `SourceClass` | `SOCIAL, NEWS, MARKET_DATA, INDEPENDENT_PROVIDER, ISSUER_DOC, REGULATORY_FILING, ISSUER_SIGNED` | `evidence-model.md §4` |
| `Capability` | `HOLD, COLLATERAL, TRADE, BORROW, LEND, REPO, CROSSCHAIN_ESCROW, PERP_UNDERLYING, OUTCOME_UNDERLYING` | bitmask in `AssetRegistry` |
| gate bits | `ORACLE_STALE(1<<0) … SEQUENCER_GRACE(1<<6)` | `risk.ts` `Gate` |
| `ExitTier` | `thresholdUsd18`, `recoveryBps` | all three risk implementations |
| `RiskParameters` | 3 LTVs, concentration, 5 haircuts, 2 max ages | all three |
| `AssetRiskInput` | the complete per-asset input to the pipeline | all three |
| `AccountInput` | `scaledPrincipal, borrowIndex, reservedUsd18, statusOverride` | all three |
| `SequencerInput` | `up, lastRestartAt, gracePeriod` | all three |
| `AssetValuation`, `RiskResult` | the pipeline's outputs | all three |

Any change to a row above must land in every implementation in the same commit, and
`make test-differential` is what proves it did.

---

## 4. Solidity, built

Signatures below are the load-bearing ones. `Authority` roles are as in `system.md §4`.

### `IOracleAdapter`, the only shape the risk pipeline knows about a price source

```solidity
interface IOracleAdapter {
    /// @return priceUsd18 18-decimal price, or 0 when no valid price exists
    /// @return updatedAt  observation timestamp
    function getPrice(bytes32 assetId) external view returns (uint256 priceUsd18, uint64 updatedAt);
    function sequencerStatus() external view returns (bool up, uint64 lastRestartAt, uint64 gracePeriod);
}
```

Three obligations on any implementation, and `ChainlinkFeedAdapter` meets all three:

1. **Never revert.** Wrap every external call in `try/catch` and degrade to `(0, 0)`, which the
   pipeline reads as `GATE_ORACLE_INVALID`. An adapter that reverts bricks every account holding
   the asset, including their ability to repay.
2. **Never interpolate, extrapolate or hold a last-known-good value.** Report what the source
   said and how old it is. Whether that is fresh enough is `maxOracleAge`'s decision, not the
   adapter's.
3. **Normalise to 18 decimals by multiplication only.** `ChainlinkFeedAdapter` refuses a feed with
   more than 18 decimals (`BadDecimals`), because dividing would introduce a rounding decision,
   and rounding decisions belong in `accounting.md`.

X Layer publishes Chainlink **Data Feeds** (`AggregatorV3Interface`, 8 decimals, verified live on
2026-08-17) and an L2 Sequencer Uptime Status Feed. Chainlink **Data Streams** is not available on
X Layer: the registry lists `supportedFeatures: ["feeds"]` and every X Layer product carries
`deliveryChannelCode: "DF"`. Any adapter written against Data Streams is dead code on this chain
until that changes.

### Core contract surfaces

| Contract | Entry points that change state | Guard |
|---|---|---|
| `Authority` | `grantRole`, `revokeRole` | `GOVERNANCE` |
| `AssetRegistry` | `registerAsset(chainId, token, underlyingId, decimals) → assetId`, `setCapabilities`, `bindPassport` | `ADMISSION` |
| | `bindRiskPolicy`, `setStatus` | `GOVERNANCE`; `GUARDIAN` may only raise the status ordinal |
| `EvidenceRegistry` | `commit(assetId, contentHash, sourceHash, effectiveAt, retrievedAt, sourceClass) → evidenceId`, `supersede` | `ADMISSION`, source class may not weaken |
| | `invalidate(evidenceId, reason)` | `ADMISSION` or `GUARDIAN` |
| `PassportRegistry` | `commitPassport(assetId, version, evidenceRoot, claimsRoot, expiresAt, redemptionSupported, redemptionFloorBps, singleSource) → passportId` | `ADMISSION`, `version == current + 1` |
| | `restrict(assetId, version, status)` | `ADMISSION` or `GUARDIAN`, ordinal must increase |
| `RiskPolicyRegistry` | `createPolicy`, `updatePolicy`, `setExitCurve` | `GOVERNANCE`; risk-increasing changes queue for `TIMELOCK = 2 days` |
| | `executeQueuedChange` | permissionless after `eta` |
| | `cancelQueuedChange` | `GOVERNANCE` or `GUARDIAN` |
| | `bumpEpoch(cause)` | `ADMISSION`, `GOVERNANCE` or `GUARDIAN` |
| `CollateralVault` | `deposit(assetId, from, account, amount) → credited`, `withdraw` | `onlyClearingHouse` |
| `LiquidityVault` | `supply(amount, receiver) → shares`, `withdraw(shares, receiver) → assets` | permissionless |
| | `lend`, `onRepaid`, `accrue`, `recordBadDebt`, `reserveCash`, `releaseCash` | `CLEARING` |
| `FinancingEngine` | `onBorrow`, `onRepay(account, amountUsd18, repayAll) → applied`, `writeOff` | `onlyClearingHouse` |
| | `accrue() → index` | permissionless |
| `ClearingHouse` | `addCollateral`, `withdrawCollateral`, `borrow(amountUsd18, expectedEpoch)`, `repay(amountUsd18, repayAll) → applied` | `msg.sender`-scoped |
| | `reserve(account, amountUsd18, intentId)`, `releaseReservation` | `CLEARING` |
| | `setAccountRiskState` | `GUARDIAN` or `GOVERNANCE`, ordinal must increase |
| `ChainlinkFeedAdapter` | `setFeed`, `setSequencerFeed` | `GOVERNANCE` |
| | `disableFeed` | `GOVERNANCE` or `GUARDIAN` |

Read-only surfaces worth naming, because the product depends on them being exact rather than
indicative:

```solidity
ClearingHouse.accountHealth(address) returns (Types.RiskResult, Types.AssetValuation[])
ClearingHouse.riskInputs(address)    returns (AssetRiskInput[], AccountInput, SequencerInput)
ClearingHouse.availableBorrow(address) returns (uint256 amountUsd18, bool limitedByLiquidity)
ClearingHouse.maxWithdrawable(address, bytes32) returns (uint256)
LiquidityVault.availableCash() / totalAssets() / maxWithdraw(address)
FinancingEngine.currentIndex() / currentRateBps() / debtOf(address)
PassportRegistry.effectiveStatus(bytes32)
```

`availableBorrow` returns two values because "add collateral" and "wait for lenders" are different
advice. `availableCash` and `totalAssets` are separate functions because a vault with $10m of
assets and $200k of idle cash cannot honour a $1m withdrawal.

### Recently added core contracts

Present in `contracts/src/core/` as of this pass, authored in the same session as this document.
Their shapes are summarised rather than transcribed; the source is authoritative.

| Contract | Owns | Identity | Notable guard |
|---|---|---|---|
| `MandateRegistry` | EIP-712 delegation envelopes and their consumed budgets | `mandateIdFor(owner, nonce)` | `MandateAction` has six members and **no withdrawal, transfer, approval or redemption verb**; `ACTION_VOCABULARY` hashes the list so widening it fails a test |
| `IntentBook` | the external-execution state machine, `NONE → … → RECONCILED` | `intentIdFor(accountId, mandateId, nonce, planHash)` | new `EXECUTOR` role, deliberately not `CLEARING`; fills bounded by the reservation |
| `EmergencyController` | guardian actions as one auditable surface | — | every entry point requires a non-zero `reason`; lifting anything is `GOVERNANCE` |

`MandateRegistry.MandateState` splits `ownerPaused` from `guardianPaused` so an owner cannot clear
a guardian's freeze, and `nonceConsumed` is set at registration and never cleared, which is what
makes revocation irreversible (`I-27`) and replay impossible (`I-29`).

---

## 5. Solidity, specified and not built

No source file exists for any of these. The shape is frozen so that writing them is filling in a
body rather than choosing a design.

| Interface / contract | Purpose | Invariants it must satisfy |
|---|---|---|
| `ILiquidationManager` | route a breached account to an exit: venue, backstop, or auction | `I-11` liquidation cannot increase directional risk or debt |
| `IFeeController` | split interest between lenders, reserves and insurance | `I-06` fee conservation, `accounting.md §7` |
| `IRemoteCollateralAdapter` | credit a non-transferable collateral position from a verified remote lock | `I-02`, `I-21`, `I-22` |
| `IRemoteAssetEscrow` | lock and release on the source chain | `I-02`, `I-22` |
| `IVenueAdapter` (Solidity side) | onchain half of an execution route | `I-19`, `I-23`, `I-24` |
| `ICashTransport` (Solidity side) | move settlement cash between domains | idempotent under duplicate delivery |
| `IStreamsOracleAdapter` | Chainlink Data Streams | **not deployable on X Layer**; keep unregistered |

Three obligations bind every one of them, and they are the reason the shapes are frozen before the
code:

1. **An adapter never holds accounting.** No per-account storage. `system.md §1`.
2. **Unknown is not zero.** An `EXECUTION_UNKNOWN` or `DELIVERY_UNKNOWN` result releases no
   reservation and credits no fill (`I-23`).
3. **Every external identifier is consumed exactly once** (`I-20`, `I-21`).

---

## 6. TypeScript, built

`packages/domain` exports the risk pipeline and its presentation helpers. It has **no authority**:
every value it produces must be reproducible by `RiskMath.sol`, and `make test-differential`
proves it on 22 scenarios.

```typescript
// packages/domain/src/risk.ts
export function evaluate(assets: AssetRiskInput[], account: AccountInput,
                         seq: SequencerInput, now: number): RiskResult;
export function valueAsset(a: AssetRiskInput): AssetValuation;
export function selectRecoveryBps(curve: ExitTier[], marketValue: bigint): number;
export function borrowRateBps(cash: bigint, borrows: bigint,
                              base: number, slope1: number, slope2: number, kink: number): bigint;
export function accrueIndex(index: bigint, rateBps: bigint, dt: bigint): bigint;
export function mulDiv(a: bigint, b: bigint, d: bigint): bigint;      // round down
export function mulDivUp(a: bigint, b: bigint, d: bigint): bigint;    // round up
export function formatUsd(usd18: bigint, decimals?: number): string;
export function explainHaircut(v: AssetValuation): string;
export const GATE_COPY: Record<Gate, { title: string; body: string; repair: string }>;
```

`packages/xlayer` exports chain configuration and ERC-8021 builder-code encoding:

```typescript
export const xLayerMainnet: ChainConfig;   // id 196,  LayerZero eid 30274
export const xLayerTestnet: ChainConfig;   // id 1952, LayerZero eid 40269
export function withBuilderCode(data: `0x${string}`, code?: string): `0x${string}`;  // idempotent
export function decodeBuilderCodes(data: string): string[] | null;
export const CHAINLINK_FEEDS_XLAYER_MAINNET: Record<string, `0x${string}`>;
```

---

## 7. TypeScript provider interfaces

**Specified. None is implemented.** `services/` is empty, `packages/chaingpt` and
`packages/schemas` are empty. Everything in this section is a contract for code that does not
exist yet, written now so that the first implementation is an adapter rather than a design.

Shared conventions for all eight: money is `bigint`, every field is `readonly`, every async method
accepts an optional `AbortSignal`, and **no vendor type crosses the interface**. A ChainGPT client,
a viem client and an HTTP client are implementation details of the module behind the interface.

```typescript
export type Hex32 = `0x${string}`;
export type EvmAddress = `0x${string}`;
export type AssetId = Hex32;
export type Usd18 = bigint;
export type Bps = number;
export type UnixSeconds = number;
```

### 7.1 `EvidenceExtractor`

```typescript
export interface CanonicalDocument {
  readonly evidenceId: Hex32;
  readonly contentHash: Hex32;
  readonly sourceHash: Hex32;
  readonly sourceClass: SourceClass;
  /** Which canonicaliser produced `bytes`. Changing it changes every hash it ever produced. */
  readonly canonicalizerVersion: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly retrievedAt: UnixSeconds;
  readonly effectiveAt: UnixSeconds;
}

export interface Extraction {
  readonly extractor: string;
  readonly documentEvidenceId: Hex32;
  readonly claims: readonly EvidenceClaim[];
  readonly startedAt: UnixSeconds;
  readonly finishedAt: UnixSeconds;
  /** Non-fatal problems. A fatal one throws; a partial extraction is never returned as a full one. */
  readonly warnings: readonly string[];
}

export interface EvidenceExtractor {
  readonly id: string;
  /**
   * Extractors sharing a group cannot corroborate each other. Two prompts against one model are
   * one path wearing two hats, and counting them as two defeats the entire corroboration rule.
   */
  readonly independenceGroup: string;
  extract(input: CanonicalDocument, signal?: AbortSignal): Promise<Extraction>;
}
```

`EvidenceClaim` is defined in `evidence-model.md §5`. An extractor must emit `UNKNOWN` for any
field the document does not support, and must never infer a legal right.

### 7.2 `EvidenceCorroborator`

```typescript
export type FieldOutcome = "AGREED" | "CONFLICT" | "SINGLE" | "ABSENT";

export interface FieldComparison {
  readonly field: string;
  readonly outcome: FieldOutcome;
  readonly byExtractor: ReadonlyMap<string, ClaimValue | typeof UNKNOWN>;
}

export interface Corroboration {
  readonly outcome: "CORROBORATED" | "SINGLE_SOURCE" | "CLAIM_CONFLICT";
  readonly fields: readonly FieldComparison[];
  /** Distinct `independenceGroup` values that produced at least one non-UNKNOWN claim. */
  readonly independentPathCount: number;
}

export interface EvidenceCorroborator {
  compare(claims: readonly ClaimSet[], signal?: AbortSignal): Promise<Corroboration>;
}
```

Comparison is exact equality after type-directed normalisation (`evidence-model.md §6`). A
corroborator that returns `CORROBORATED` with `independentPathCount < 2` is a defect.

### 7.3 `ObservationProvider`

```typescript
export interface ObservationQuery {
  readonly topics: readonly string[];
  readonly assetIds: readonly AssetId[];
  readonly since: UnixSeconds;
  readonly limit: number;
}

export interface Observation {
  readonly observationId: string;
  /** Low-trust classes only. An observation is never promoted to a claim. */
  readonly sourceClass: SourceClass.SOCIAL | SourceClass.NEWS | SourceClass.MARKET_DATA;
  readonly headline: string;
  readonly uri: string;
  readonly observedAt: UnixSeconds;
  readonly assetIds: readonly AssetId[];
}

export interface ObservationProvider {
  poll(query: ObservationQuery, signal?: AbortSignal): Promise<readonly Observation[]>;
}
```

An `Observation` may trigger a refresh or an alert. It may never be an input to `commitPassport`,
and it may never raise a limit (`I-18`).

### 7.4 `ContractAuditProvider`

```typescript
export interface ContractBundle {
  readonly commit: string;
  readonly solcVersion: string;
  readonly files: readonly { readonly path: string; readonly source: string }[];
}

export interface AuditFinding {
  readonly findingId: string;
  readonly severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly contract: string;
  readonly line: number | null;
  readonly title: string;
  readonly detail: string;
  readonly source: string;
}

export interface AuditReport {
  readonly provider: string;
  readonly commit: string;
  readonly producedAt: UnixSeconds;
  /**
   * There is no "SECURE". An audit provider reports findings or reports that it could not run.
   * A CI gate that can print "secure" is a gate that will print it while unconfigured.
   */
  readonly status: "COMPLETED" | "AUDIT_UNAVAILABLE";
  readonly findings: readonly AuditFinding[];
}

export interface ContractAuditProvider {
  audit(bundle: ContractBundle, signal?: AbortSignal): Promise<AuditReport>;
}
```

### 7.5 `OracleProvider`

The offchain counterpart of `IOracleAdapter`, used for previews, monitoring and alerting. It never
feeds a contract.

```typescript
export interface PriceObservation {
  readonly assetId: AssetId;
  readonly priceUsd18: Usd18;
  readonly updatedAt: UnixSeconds;
  readonly sourceDecimals: number;
  readonly feed: EvmAddress;
  readonly roundId: bigint;
}

export interface SequencerObservation {
  readonly up: boolean;
  readonly lastRestartAt: UnixSeconds;
  readonly gracePeriodSeconds: number;
}

export interface OracleProvider {
  /** `null` when the source produced no valid price. Never a guess, never a cached last-good. */
  getPrice(assetId: AssetId, signal?: AbortSignal): Promise<PriceObservation | null>;
  sequencerStatus(signal?: AbortSignal): Promise<SequencerObservation>;
}
```

Returning `null` rather than throwing mirrors the onchain adapter's `(0, 0)`, so the preview and
the contract degrade the same way.

### 7.6 `LiquidityObservationProvider`

This is the measurement that a human turns into an exit curve. It is **not** consulted at decision
time by anything.

```typescript
export interface DepthSample {
  readonly notionalUsd18: Usd18;
  /** Total proceeds from liquidating the whole notional, not the marginal price at that depth. */
  readonly estimatedProceedsUsd18: Usd18;
  readonly venue: string;
}

export interface LiquidityObservation {
  readonly assetId: AssetId;
  readonly method: "ORDERBOOK_WALK" | "AMM_SIMULATION" | "EXECUTED_FILLS";
  readonly samples: readonly DepthSample[];
  readonly observedAt: UnixSeconds;
}

export interface LiquidityObservationProvider {
  observe(assetId: AssetId, notionalsUsd18: readonly Usd18[],
          signal?: AbortSignal): Promise<LiquidityObservation>;
}
```

`estimatedProceedsUsd18` is average proceeds over the whole notional because
`stressedExit = marketValue × recoveryBps / BPS` multiplies the entire position by one number
(`risk-model.md §4`). A provider that reports marginal depth will produce a curve that overstates
recovery, and nothing downstream can detect it.

Output feeds a governance proposal to `RiskPolicyRegistry.setExitCurve`. Wiring it to the risk
pipeline would make recognised value a function of a live quote, which is the fake-liquidity
attack in `threat-model.md §2`.

### 7.7 `VenueAdapter`

```typescript
export type ExecutionState =
  | "CREATED" | "VALIDATED" | "RESERVED" | "SUBMITTED"
  | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED"
  | "EXECUTION_UNKNOWN" | "RECONCILIATION_REQUIRED" | "RECONCILED";

export interface ExecutionIntent {
  readonly intentId: Hex32;
  readonly accountId: Hex32;
  readonly mandateId: Hex32;
  readonly venueId: string;
  readonly action: "SPOT_BUY" | "SPOT_SELL" | "PERP_OPEN" | "PERP_CLOSE"
                 | "OUTCOME_BUY" | "OUTCOME_SELL";
  readonly assetId: AssetId;
  readonly notionalUsd18: Usd18;
  readonly maxSlippageBps: Bps;
  /** The budget ClearingHouse already committed. The adapter may consume at most this. */
  readonly reservationUsd18: Usd18;
  readonly riskEpoch: number;
  readonly expiresAt: UnixSeconds;
}

export interface Quote {
  readonly intentId: Hex32;
  readonly expectedProceedsUsd18: Usd18;
  readonly feeUsd18: Usd18;
  readonly quotedAt: UnixSeconds;
  readonly expiresAt: UnixSeconds;
}

export interface Fill {
  readonly intentId: Hex32;
  readonly filledUsd18: Usd18;
  readonly feeUsd18: Usd18;
  readonly venueReceiptId: string;
  readonly observedAt: UnixSeconds;
  readonly confirmations: number;
}

export interface ExecutionStatus {
  readonly intentId: Hex32;
  readonly state: ExecutionState;
  readonly fills: readonly Fill[];
  readonly cumulativeFilledUsd18: Usd18;
  readonly observedAt: UnixSeconds;
}

export interface Reconciliation {
  readonly intentId: Hex32;
  readonly filledUsd18: Usd18;
  readonly releaseUsd18: Usd18;
  readonly terminal: boolean;
}

export interface VenueAdapter {
  readonly venueId: string;
  quote(intent: ExecutionIntent, signal?: AbortSignal): Promise<Quote>;
  submit(intent: ExecutionIntent, signal?: AbortSignal): Promise<ExecutionStatus>;
  query(intentId: Hex32, signal?: AbortSignal): Promise<ExecutionStatus>;
  cancel(intentId: Hex32, signal?: AbortSignal): Promise<ExecutionStatus>;
  reconcile(intentId: Hex32, signal?: AbortSignal): Promise<Reconciliation>;
}
```

Five obligations, each of which is an invariant with a name:

1. `query` returns `EXECUTION_UNKNOWN` when it cannot determine the outcome. It never throws to
   mean "probably nothing happened", and it never returns `CANCELLED` on a timeout (`I-23`).
2. `reconcile` is the only method whose result may release a reservation, and
   `filledUsd18 + releaseUsd18 <= intent.reservationUsd18` (`I-19`, `I-24`).
3. `submit` is idempotent on `intentId`. A retry after a lost response returns the existing status
   and does not create a second order (`I-20`).
4. Duplicate or out-of-order venue observations have zero incremental effect.
5. `venueReceiptId` is an independent observation of the venue's own record. A 200 response is not
   a fill.

**Deviation recorded.** The PRD lists `reserve(...)` among the venue adapter's methods. It is
absent here. Reservation is `ClearingHouse.reserve`, which is built and guarded by the `CLEARING`
role; an adapter that could reserve capital would be holding accounting, which `system.md §1`
forbids. The adapter receives a budget in `ExecutionIntent.reservationUsd18` and spends against
it.

### 7.8 `CashTransport`

```typescript
export type TransportState =
  | "PREPARED" | "SENT" | "IN_FLIGHT" | "DELIVERED" | "FAILED" | "DELIVERY_UNKNOWN";

export interface TransportRequest {
  readonly ticketId: Hex32;
  readonly srcChainId: number;
  readonly dstChainId: number;
  readonly token: EvmAddress;
  /** Raw token units, with `decimals` alongside. A transport moves tokens, not dollars. */
  readonly amount: bigint;
  readonly decimals: number;
  readonly recipient: EvmAddress;
}

export interface TransportQuote {
  readonly ticketId: Hex32;
  readonly route: string;
  readonly feeAmount: bigint;
  readonly estimatedSeconds: number;
}

export interface TransportTicket {
  readonly ticketId: Hex32;
  readonly state: TransportState;
  readonly srcTxHash: Hex32 | null;
  readonly dstTxHash: Hex32 | null;
  readonly deliveredAmount: bigint | null;
  readonly observedAt: UnixSeconds;
}

export interface CashTransport {
  readonly transportId: string;
  prepare(req: TransportRequest, signal?: AbortSignal): Promise<TransportQuote>;
  send(req: TransportRequest, signal?: AbortSignal): Promise<TransportTicket>;
  status(ticketId: Hex32, signal?: AbortSignal): Promise<TransportTicket>;
  reconcile(ticketId: Hex32, signal?: AbortSignal): Promise<TransportTicket>;
}
```

Amounts are raw token units carrying their own `decimals` rather than `usd18`, because a transport
moves a token and a token is not a dollar. Converting at the boundary is what makes a unit
mismatch possible, and `system.md §11 D-S1` records what that costs when it happens.

Circle CCTP does not support X Layer, so this interface has no implementation and Circle is not a
dependency of any current path. The interface exists so that adding one later is an adapter rather
than a redesign.

---

## 8. Obligations on every provider

Non-negotiable, and they apply to implementations that do not exist yet as much as to the two that
do.

| Obligation | Why |
|---|---|
| No vendor type in any signature | §1 |
| No floating point in any field | `accounting.md §1` |
| Every method cancellable via `AbortSignal` | a hung provider must not hold a request open forever |
| Unknown is an explicit state, never `null`-as-zero or a thrown error meaning "no" | `I-23` |
| Deterministic given the same inputs, or the non-determinism is a declared field | corroboration compares outputs |
| No provider holds per-account financial state | `system.md §1` |
| A missing credential yields an explicit unavailable status, never a synthetic result | `docs/INTEGRATIONS.md` |

The last row is the one that gets broken under demo pressure. `AuditReport.status` has no
`SECURE`, `OracleProvider.getPrice` returns `null` rather than a stale cache, and a venue with no
access renders as unavailable with the reason shown rather than as an empty order book.

---

## 9. Change control

| Change | Process |
|---|---|
| New adapter implementing an existing interface | ordinary PR |
| New method on a provider interface | ordinary PR, all implementations updated in the same commit |
| Widening or reordering a `Types.sol` enum or struct | **RFC**, plus every risk implementation in the same commit |
| Changing an identifier derivation | **RFC**, and it invalidates historic ids |
| Changing a rounding direction or a formula | **RFC** against `accounting.md` |
| Changing which fields of a Passport reach the risk pipeline | **RFC**, plus `evidence-model.md §7` |

`make test-differential` is the gate for the middle three rows. It regenerates the fixtures from
the spec transcription, compares them by content against what is committed, and runs the Solidity
and TypeScript conformance suites. A one-wei disagreement fails the build.

---

## 10. What the interfaces are for

Three things, in order of how much each has already saved:

1. **Parallel work.** Frozen shapes are what let several implementation sessions run at once
   without producing semantic divergence faster than they produce code.
2. **Replaceability.** Every named external dependency sits behind exactly one interface, so
   losing one is a configuration change. ChainGPT has no key, Exchange OS has no access, xStocks
   has no verified address, and Chainlink Data Streams does not exist on X Layer. In each case the
   interface stands and the implementation is disabled with the reason recorded, which is what
   `docs/INTEGRATIONS.md` is.
3. **Testability.** An interface with a fixture implementation is testable before the real one
   arrives, including the cases the real one will never reproduce on demand: the 37% partial fill
   that then times out, the duplicate observation, the out-of-order event.

---

## 11. Status

Verified by reading the tree during this pass. Re-check mechanically rather than trusting this
table:

```bash
ls contracts/src/core contracts/src/adapters contracts/src/interfaces
find services packages/chaingpt packages/schemas crates -type f
make build && make test
```

| Surface | Location | State |
|---|---|---|
| `Types.sol` frozen shapes | `contracts/src/libraries/Types.sol` | built |
| `RiskMath` pipeline | `contracts/src/libraries/RiskMath.sol` | built |
| `IOracleAdapter`, `IAggregatorV3` | `contracts/src/interfaces/IOracleAdapter.sol` | built |
| `ChainlinkFeedAdapter` | `contracts/src/adapters/` | built, Data Feeds only |
| Core registries, vaults, `ClearingHouse`, `FinancingEngine` | `contracts/src/core/` | built |
| `MandateRegistry`, `IntentBook`, `EmergencyController` | `contracts/src/core/` | built this session |
| TypeScript risk pipeline | `packages/domain/src/risk.ts` | built |
| X Layer config, ERC-8021 | `packages/xlayer/src/` | built |
| Rust reference engine | `crates/risk-core/` | built this session; a root `Cargo.toml` now exists and `make test-differential` runs the Rust conformance suite alongside Solidity and TypeScript |
| `LiquidationManager`, `FeeController` | — | specified only |
| Remote collateral (`RemoteAssetEscrow`, `LayerZeroCollateralAdapter`) | — | specified only |
| Venue adapters (`ExchangeOSAdapter`, `OkxDexAdapter`) | — | specified only |
| `XStocksAdapter`, `CashTransportAdapter`, `ChainlinkStreamsAdapter` | — | specified only |
| All eight TypeScript provider interfaces (§7) | — | specified only; `services/`, `packages/chaingpt`, `packages/schemas` are empty |

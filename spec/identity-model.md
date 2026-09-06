# spec/identity-model.md — instrument identity

Status: **frozen**. This document is additive to a live deployment. Introducing it moves no trust
boundary and gives no component new authority, so it is a spec extension and not an RFC — see §9.
Changing a derivation formula here, once an id has been committed anywhere, is an RFC in
`spec/rfcs/`, because a changed formula produces a different id for the same thing.

This document answers one question the deployed system currently answers only by accident: **what
exactly is a tokenized instrument, as distinct from the company or fund it refers to, and as
distinct from its own economic state at a point in time.**

Formulas that already ship live in `accounting.md §2`. This file adds the product-identity layer
that sits above them. Nothing in `accounting.md`, `risk-model.md` or the deployed contracts
changes.

---

## 1. The problem this fixes

The deployed `AssetRegistry` derives `assetId = keccak256(abi.encode(chainId, tokenAddress))`. That
is a correct **financial key** — it names one token contract on one chain, and the risk pipeline,
the vault and the clearing house are all keyed by it. It is not an **instrument identity**. It
carries no issuer, no legal wrapper, no instrument standard, no version, and it cannot express that
two tokens referencing Apple — a Coinbase B20 asset on Base and an xStocks tracker certificate on
X Layer — are different instruments with different rights, custody and corporate-action behaviour.

`registerAsset` already takes an `underlyingId` argument, so the *intent* to separate the two is
present. The type does not enforce it and nothing downstream reads it as identity.

The permanent shape:

```
legacy deployed financial identity
    assetId = H(chainId, token)                     ← unchanged, still the money key
        │
        │  explicit, provenance-bearing, versioned binding
        ▼
InstrumentIdentity                                   ← new: what the instrument IS
        │
        ├── DomainId              which chain/environment is authoritative
        ├── canonical reference   the exact token contract or native asset
        ├── IssuerIdentity        the legal issuer of THIS wrapper
        ├── instrument standard   ERC-20 / B20 / xStocks cert / HTS / ATS-1400 / …
        ├── instrument version    bumped only on a genuine identity change
        ├── UnderlyingReference   the company/fund/asset it economically tracks (separate id)
        └── InstrumentAccountingMode   how a held quantity relates to economic value
```

## 2. Identifiers

All ids are `bytes32`, all are `keccak256(abi.encode(...))` of value types, and all are pinned
against `cast` in `packages/schemas/test/instrument.test.ts` so a drift between the TypeScript
derivation and what a chain would compute fails a test rather than producing two ids for one
instrument. The domain-tag strings follow the existing `USANCE_ACCOUNT_V1` convention in
`accounting.md §2`.

```
domainId = keccak256(abi.encode("USANCE_DOMAIN_V1", caip2))

    caip2 is the CAIP-2 chain id string, lower-cased and trimmed:
      "eip155:1952"   X Layer testnet
      "eip155:196"    X Layer mainnet
      "eip155:8453"   Base
      "eip155:84532"  Base Sepolia
      "hedera:testnet" / "hedera:mainnet"
    A human authors the caip2 string. The id is derived from it.

issuerId = keccak256(abi.encode(legalName, jurisdiction))

    Identical to canonical.ts::issuerId, which already binds evidence sources. legalName is
    trimmed, NFC-normalised and lower-cased; jurisdiction is trimmed and upper-cased. Reused,
    not redefined. The same normalisation (trim, NFC, lower-case) applies to the `name` field
    of an UnderlyingReference.

canonicalRef =
    EVM instrument:    bytes32(uint256(uint160(tokenAddress)))          (left-padded address)
    native instrument: keccak256(abi.encode("USANCE_NATIVE_REF_V1", nativeId))
                       where nativeId is the chain-native asset identifier as a string
                       (e.g. a Hedera token id "0.0.1234567")

instrumentStandardId = keccak256(abi.encode("USANCE_INSTRUMENT_STANDARD_V1", standard))

    standard is one of a closed vocabulary (§4). It names the token/legal mechanism, not the
    underlying asset class.

instrumentVersion : uint32, starts at 1 (§5)

instrumentId = keccak256(abi.encode(
    domainId,
    canonicalRef,
    issuerId,
    instrumentStandardId,
    instrumentVersion
))

underlyingReferenceId = keccak256(abi.encode(
    "USANCE_UNDERLYING_REF_V1",
    assetClass,   // closed vocabulary (§4)
    isin,         // "" when unavailable or unlawful to record
    figi,         // ""
    ticker,       // "" — a hint, never sufficient on its own
    name          // NFC-normalised, lower-cased, whitespace-collapsed common/legal name
))
```

**`underlyingReferenceId` is not an input to `instrumentId`.** Learning an instrument's ISIN later
must not change its identity, and two instruments over the same underlying must stay distinct. The
underlying id is a *field* on the `InstrumentIdentity` record, resolved and displayed, never
hashed into the instrument's own id.

## 3. The binding: `legacyAssetId → instrumentId`

The existing deployment keeps its keys. An explicit binding record connects each one to an
instrument identity. The binding is a first-class fact with its own provenance; it is never a
reinterpretation of the old `bytes32`.

```
InstrumentBinding {
    bindingId          keccak256(abi.encode(legacyAssetId, instrumentId, boundAt))
    legacyAssetId      bytes32     H(chainId, token) — the deployed financial key, verbatim
    legacyAssetIdKind  enum        DERIVED | FIXTURE_LABEL   (see below)
    instrumentId       bytes32
    boundAt            uint64      unix seconds
    boundAtBlock       uint64      0 when the binding is an offchain migration record
    boundBy            string      the actor/process that authored the binding
    boundAtDomain      string      caip2 of the deployment the legacyAssetId belongs to
    deploymentDigest   string      the deployment manifest digest current when bound
    supersedes         bytes32     prior bindingId, or 0 for the first binding of this legacyAssetId
    note               string      human provenance, required, non-empty
}
```

`legacyAssetIdKind`:

- `DERIVED` — the id is `keccak256(abi.encode(chainId, token))` as the spec intends.
- `FIXTURE_LABEL` — the id is a UTF-8 string packed into `bytes32`, not a derived value. The
  Franklin FOBXX Passport committed on X Layer testnet
  (`proof/passport-franklin-fobxx-2026-v1.json`) carries
  `assetId = 0x7573616e63652d666978747572652d61737365743a6672616e6b6c696e2d666f`, which decodes to
  the ASCII `usance-fixture-asset:franklin-fo…`. This is exactly the ticker-shaped, non-derived
  identity the Product Lock forbids for production, and it exists in the historical proof set. The
  binding records it as `FIXTURE_LABEL`, maps it to a real `InstrumentIdentity` for the fund, and
  the historical proof stays valid and unedited.

Historical ids are never rewritten. A binding *links* an old id to a new one; the old
`passportId = H(assetId, version)`, `receiptId`, `evidenceId` and `assetId` values are unchanged
and remain the identifiers those artifacts were committed under.

## 4. Closed vocabularies

`instrumentStandard`:

```
ERC20                  a plain fungible token with no wrapper-specific economics
B20                    Coinbase-issued tokenized equity on Base
XSTOCKS_TRACKER_CERT   an xStocks issuer-defined tracker certificate
HTS                    a Hedera Token Service native token
ATS_ERC1400            a Hedera ATS digital security using ERC-1400-family partitions
```

`assetClass` (for `UnderlyingReference`):

```
EQUITY  FUND  MONEY_MARKET_FUND  TREASURY  PRIVATE_CREDIT  COMMODITY  CASH  OTHER
```

`InstrumentAccountingMode`:

```
FIXED_UNIT           a held quantity is the economic quantity; 1 token in = 1 token of claim.
                     Plain ERC-20 stablecoins and T-bill tokens without a rebase mechanism.
REBASING_BALANCE     balanceOf() reflects issuer multiplier / corporate-action adjustments.
                     xStocks on EVM, and B20 variants that implement the same. The vault must
                     account by measured delta and re-read balances, never by a stored
                     "deposited amount".
SHARE_BASED          the token is a claim on a pool whose per-share value moves (vault shares).
EXTERNALLY_MANAGED   transferability and balance are gated by an external compliance/partition
                     system (ATS). The adapter, not a generic ERC-20 path, owns the semantics.
```

`InstrumentAccountingMode` is a field on the `InstrumentIdentity` record. It is **not** an input to
`instrumentId`. An instrument does not acquire a new identity because it rebased.

## 5. Three concepts that must never be confused

| Concept | Identifier | Advances when | Stable across |
|---|---|---|---|
| **Instrument identity / version** | `instrumentId`, `instrumentVersion` | the domain, canonical token, issuer, or instrument standard genuinely changes; or a deliberate `instrumentVersion` bump records a legal/economic identity change to the same deployed token | corporate actions, Passport updates, learning a better ISIN/FIGI |
| **Passport version** | `passportId = H(assetId, version)` (unchanged) | any new evidence or fact about the instrument is committed | the instrument's canonical identity |
| **Corporate-action state** | none — mutable adapter/vault state; `InstrumentAccountingMode` says how to read it | dividends, splits, reverse splits, multiplier activations | instrument identity, and every historical Passport version |

`instrumentVersion` exists so that one deployed token address is **not** permanently assumed to map
to one fixed set of semantics. If an issuer re-papers a wrapper — same token contract, materially
different legal terms or standard — a new `InstrumentIdentity` is derived (new `issuerId`,
`instrumentStandardId`, or an explicit `instrumentVersion` bump) and a new `InstrumentBinding` is
recorded with `supersedes` pointing at the prior one. Walking `legacyAssetId` yields the ordered
chain of bindings, and a Passport committed at time *t* resolves through the binding that was
active at *t*.

## 6. Ambiguity guards

Enforced in `packages/schemas/src/instrument.ts`:

- An `UnderlyingReference` with `isin`, `figi` and `name` all empty is rejected. A ticker alone
  never identifies an underlying.
- `assetClass` must be in the closed vocabulary.
- `instrumentStandard` must be in the closed vocabulary.
- `caip2` must match `^[a-z0-9]+:[a-zA-Z0-9._-]+$` after normalisation.
- `instrumentVersion` must be `>= 1`.
- A `canonicalRef` for an EVM instrument must be a left-padded 20-byte address (top 12 bytes zero);
  a native instrument must carry a non-empty `nativeId`.
- Two `InstrumentIdentity` records that share every field except `instrumentStandardId` or
  `issuerId` derive different `instrumentId` values — asserted, not assumed.
- Two instruments that share an `underlyingReferenceId` but differ in domain, issuer or standard
  are distinct instruments — asserted.

## 7. Read-model obligations

- `deployments/instrument-bindings.json` is a generated artifact (`scripts/gen-instrument-bindings.mjs`),
  carrying generator version, input digests and the deployment digest it was bound against, under
  the same freshness discipline as every other artifact (`spec/evidence-model.md`, D-015).
- `services/indexer` resolves `legacyAssetId → instrumentId`, exposes the binding chain, and
  exposes `homeDomain(instrumentId)`. Existing projections keyed by `assetId` are unchanged.
- The public asset view distinguishes, on the page, the instrument (issuer, domain, standard,
  version, accounting mode) from the underlying reference (company/fund, class, ticker). If two
  instruments reference the same company they render as two instruments.

## 8. What does not change

- `AssetRegistry`, `ClearingHouse`, `CollateralVault`, `PassportRegistry`, `RiskPolicyRegistry`,
  `FinancingEngine` — no bytecode, no storage layout, no interface. The live X Layer testnet
  deployment (1952) stays byte-for-byte the current source.
- `accounting.md §2` derivations `assetId`, `accountId`, `evidenceId`, `passportId`, `intentId`,
  `receiptId` — unchanged. This document adds ids; it redefines none.
- `fixtures/canonical/` and the differential conformance property — untouched. The risk pipeline
  stays a pure function of an opaque `bytes32` key.
- Every historical `assetId`, `passportId`, `receiptId`, `evidenceId` and proof reference — valid,
  unedited, and now additionally resolvable to an instrument identity.

## 9. Why this is not an RFC

`system.md §1`: an RFC is required to "change a trust boundary or move ownership of a fact".

- The instrument-identity layer owns a fact nothing currently owns (the exact legal/economic
  identity of a wrapper). It takes ownership from no one.
- It holds no role over any money contract, is read by no money contract, and cannot move a limit,
  a balance or a status. It is in the same category as `EvidenceRegistry`: it hands the system an
  observation the system is free to use for display and admission and free to ignore for
  settlement.
- The deployed financial keys and their authority are unchanged.

The decision to introduce it, and to keep the on-chain `InstrumentRegistry` for a future
deliberate deployment migration rather than forcing one now, is recorded as `DECISIONS.md` D-021.

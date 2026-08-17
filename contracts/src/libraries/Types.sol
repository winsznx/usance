// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title Usance canonical domain types
/// @notice Frozen by spec/accounting.md. Changing an enum ordinal or a struct field here is an
///         RFC-level change, because the Rust reference model and the TypeScript preview
///         library encode the same ordinals.
library Types {
    // ---------------------------------------------------------------------------------
    // Scales — spec/accounting.md §1.1
    // ---------------------------------------------------------------------------------

    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant USD = 1e18;
    uint256 internal constant SECONDS_PER_YEAR = 31_536_000;

    // ---------------------------------------------------------------------------------
    // Status — total order, spec/accounting.md §5.1
    // ---------------------------------------------------------------------------------

    /// @dev Ordinals are load-bearing. `status = max(base, gateFloor, override)` relies on the
    ///      ordering being monotone in restrictiveness, which is what makes invariant I-07
    ///      structural rather than reviewed.
    enum AccountStatus {
        NORMAL, //        0
        NO_NEW_RISK, //   1
        REDUCE_ONLY, //   2
        MARGIN_CALL, //   3
        LIQUIDATING, //   4
        SETTLED, //       5
        BAD_DEBT //       6
    }

    enum PassportStatus {
        NONE, //          0  never committed
        ACTIVE, //        1
        STALE, //         2  past its freshness window
        CONFLICTED, //    3  extraction paths disagreed
        SUSPENDED, //     4  issuer or guardian suspension
        REVOKED //        5
    }

    enum AssetStatus {
        UNREGISTERED,
        ACTIVE,
        PAUSED,
        SUSPENDED,
        RETIRED
    }

    /// @dev Evidence authority hierarchy — spec/evidence-model.md. Higher is stronger.
    ///      A claim may only be superseded by a source of equal or greater class, which is how
    ///      invariant I-18 ("weak evidence cannot raise a limit") is enforced.
    enum SourceClass {
        SOCIAL, //              0  unverified observation
        NEWS, //                1
        MARKET_DATA, //         2
        INDEPENDENT_PROVIDER, //3
        ISSUER_DOC, //          4
        REGULATORY_FILING, //   5
        ISSUER_SIGNED //        6  signed attestation or onchain state
    }

    /// @dev Capabilities are independent. An asset may be good collateral and a bad perp
    ///      underlying; admission returns a set, never a score.
    enum Capability {
        HOLD,
        COLLATERAL,
        TRADE,
        BORROW,
        LEND,
        REPO,
        CROSSCHAIN_ESCROW,
        PERP_UNDERLYING,
        OUTCOME_UNDERLYING
    }

    // ---------------------------------------------------------------------------------
    // Risk gates — bitmask, spec/accounting.md §5.1
    // ---------------------------------------------------------------------------------

    uint32 internal constant GATE_ORACLE_STALE = 1 << 0;
    uint32 internal constant GATE_ORACLE_INVALID = 1 << 1;
    uint32 internal constant GATE_PASSPORT_STALE = 1 << 2;
    uint32 internal constant GATE_CLAIM_CONFLICT = 1 << 3;
    uint32 internal constant GATE_ASSET_SUSPENDED = 1 << 4;
    uint32 internal constant GATE_SEQUENCER_DOWN = 1 << 5;
    uint32 internal constant GATE_SEQUENCER_GRACE = 1 << 6;

    // ---------------------------------------------------------------------------------
    // Structs
    // ---------------------------------------------------------------------------------

    struct ExitTier {
        uint256 thresholdUsd18;
        uint16 recoveryBps;
    }

    struct RiskParameters {
        uint16 initialLtvBps;
        uint16 maintenanceLtvBps;
        uint16 liquidationLtvBps;
        uint16 maxConcentrationBps;
        uint16 haircutMarketBps;
        uint16 haircutLiquidityBps;
        uint16 haircutIssuerBps;
        uint16 haircutSettlementBps;
        uint16 haircutCrosschainBps;
        uint64 maxOracleAge;
        uint64 maxPassportAge;
    }

    /// @notice Everything the risk pipeline needs about one held asset, fully materialised.
    /// @dev The pipeline is a pure function of this array. It reads no storage, so the
    ///      conformance fixtures can drive it directly and the Rust reference model can be
    ///      compared against it line for line.
    struct AssetRiskInput {
        bytes32 assetId;
        uint256 quantity;
        uint8 decimals;
        uint256 priceUsd18;
        uint64 priceUpdatedAt;
        uint64 passportCommittedAt;
        PassportStatus passportStatus;
        bool redemptionSupported;
        uint16 redemptionFloorBps;
        AssetStatus assetStatus;
        RiskParameters params;
        ExitTier[] exitCurve;
    }

    struct AccountInput {
        uint256 scaledPrincipal;
        uint256 borrowIndex;
        uint256 reservedUsd18;
        AccountStatus statusOverride;
    }

    struct SequencerInput {
        bool up;
        uint64 lastRestartAt;
        uint64 gracePeriod;
    }

    struct AssetValuation {
        bytes32 assetId;
        uint256 marketValueUsd18;
        uint256 haircutMarkUsd18;
        uint256 stressedExitUsd18;
        uint256 redemptionFloorUsd18;
        uint256 recognizedUsd18;
        uint256 cappedUsd18;
    }

    struct RiskResult {
        uint256 totalRecognizedUsd18;
        uint256 borrowLimitUsd18;
        uint256 maintenanceLimitUsd18;
        uint256 liquidationLimitUsd18;
        uint256 debtUsd18;
        uint256 availableBorrowUsd18;
        uint256 healthFactorWad;
        AccountStatus status;
        uint32 gates;
    }
}

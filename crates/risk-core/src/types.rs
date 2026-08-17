//! The canonical domain types, frozen by `spec/accounting.md`.
//!
//! Every enum ordinal and field here is shared with `contracts/src/libraries/Types.sol` and
//! `packages/domain/src/risk.ts`. Changing one is an RFC-level change, not a refactor: the
//! status ordering is what makes "degraded inputs can only restrict" (invariant `I-07`) a
//! structural property rather than a reviewed one, and the gate bits are a wire format that
//! crosses a chain boundary.

use core::fmt;

/// An internal USD amount with 18 decimal places. `1 USD` is `1_000_000_000_000_000_000`.
///
/// 128 bits holds ~3.4e38, which is 3.4e20 USD — twenty orders of magnitude past the value of
/// everything that has ever been tokenized. The width that actually matters is the intermediate,
/// not the amount; see [`crate::U256`].
pub type Usd18 = u128;

/// A `bytes32` identifier, `keccak256(abi.encode(chainId, tokenAddress))` for an asset.
///
/// Compared as an unsigned big-endian integer, which for a fixed-width byte array is the same as
/// lexicographic byte order — so the derived [`Ord`] is the canonical ordering from
/// `spec/accounting.md` §1.3 and not merely a convenient one.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct AssetId([u8; 32]);

impl AssetId {
    /// Wrap 32 raw bytes.
    #[must_use]
    pub const fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// The raw bytes.
    #[must_use]
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Parse `0x`-prefixed or bare hex. `None` unless the input is exactly 32 bytes.
    ///
    /// Identifiers cross every boundary as hex strings — fixtures, JSON, calldata — and a
    /// short-hex identifier that silently zero-extended would collide two different assets into
    /// one collateral position.
    #[must_use]
    pub fn from_hex(text: &str) -> Option<Self> {
        let body = text.strip_prefix("0x").unwrap_or(text);
        if body.len() != 64 {
            return None;
        }
        let mut bytes = [0u8; 32];
        for (i, byte) in bytes.iter_mut().enumerate() {
            let hi = hex_nibble(body.as_bytes()[i * 2])?;
            let lo = hex_nibble(body.as_bytes()[i * 2 + 1])?;
            *byte = (hi << 4) | lo;
        }
        Some(Self(bytes))
    }
}

fn hex_nibble(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

impl fmt::Display for AssetId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("0x")?;
        for byte in &self.0 {
            write!(f, "{byte:02x}")?;
        }
        Ok(())
    }
}

impl fmt::Debug for AssetId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

/// Account status, as a total order — `spec/accounting.md` §5.1.
///
/// `NORMAL < NO_NEW_RISK < REDUCE_ONLY < MARGIN_CALL < LIQUIDATING < SETTLED < BAD_DEBT`.
///
/// The derived [`Ord`] follows declaration order, and the whole degradation model rests on it:
/// status is `max(base, gateFloor, statusOverride)`, so a stale oracle, a conflicted Passport or
/// a guardian action can only ever move an account further along this order. There is no code
/// path in which degraded input makes an account healthier because there is no expressible one.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(u8)]
pub enum AccountStatus {
    /// Everything is permitted.
    #[default]
    Normal = 0,
    /// Repay, add collateral, withdraw within maintenance, close positions. No new risk.
    NoNewRisk = 1,
    /// Repay, add collateral, close positions. No withdrawals.
    ReduceOnly = 2,
    /// Repay or add collateral only.
    MarginCall = 3,
    /// Liquidation in progress.
    Liquidating = 4,
    /// Position closed out; residual equity is withdrawable.
    Settled = 5,
    /// Debt exceeded recoverable collateral.
    BadDebt = 6,
}

impl AccountStatus {
    /// Every status in ascending order of restriction.
    pub const ALL: [Self; 7] = [
        Self::Normal,
        Self::NoNewRisk,
        Self::ReduceOnly,
        Self::MarginCall,
        Self::Liquidating,
        Self::Settled,
        Self::BadDebt,
    ];

    /// The `SCREAMING_SNAKE_CASE` name shared with Solidity, TypeScript and the fixtures.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "NORMAL",
            Self::NoNewRisk => "NO_NEW_RISK",
            Self::ReduceOnly => "REDUCE_ONLY",
            Self::MarginCall => "MARGIN_CALL",
            Self::Liquidating => "LIQUIDATING",
            Self::Settled => "SETTLED",
            Self::BadDebt => "BAD_DEBT",
        }
    }

    /// Parse the shared name. `None` for anything else — an unrecognised status is never
    /// defaulted to `NORMAL`, because defaulting an unknown restriction to "no restriction" is
    /// how a degraded account becomes a healthy one.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.as_str() == name)
    }
}

impl fmt::Display for AccountStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Passport lifecycle — `spec/state-machines.md` §6. Ordinals match `Types.sol`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(u8)]
pub enum PassportStatus {
    /// Never committed.
    #[default]
    None = 0,
    /// Committed and current.
    Active = 1,
    /// Past its freshness window.
    Stale = 2,
    /// Two extraction paths disagreed. A restriction, never a coin flip between readings.
    Conflicted = 3,
    /// Issuer or guardian suspension.
    Suspended = 4,
    /// Withdrawn by its issuer.
    Revoked = 5,
}

impl PassportStatus {
    /// Every status, in ordinal order.
    pub const ALL: [Self; 6] = [
        Self::None,
        Self::Active,
        Self::Stale,
        Self::Conflicted,
        Self::Suspended,
        Self::Revoked,
    ];

    /// The shared `SCREAMING_SNAKE_CASE` name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::None => "NONE",
            Self::Active => "ACTIVE",
            Self::Stale => "STALE",
            Self::Conflicted => "CONFLICTED",
            Self::Suspended => "SUSPENDED",
            Self::Revoked => "REVOKED",
        }
    }

    /// Parse the shared name.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.as_str() == name)
    }
}

/// Registry-level asset status. Ordinals match `Types.sol`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(u8)]
pub enum AssetStatus {
    /// Not known to the registry.
    #[default]
    Unregistered = 0,
    /// Admitted and usable.
    Active = 1,
    /// Temporarily halted for new activity.
    Paused = 2,
    /// Suspended; existing exposure stays measurable, new risk does not.
    Suspended = 3,
    /// Permanently withdrawn.
    Retired = 4,
}

impl AssetStatus {
    /// Every status, in ordinal order.
    pub const ALL: [Self; 5] = [
        Self::Unregistered,
        Self::Active,
        Self::Paused,
        Self::Suspended,
        Self::Retired,
    ];

    /// The shared `SCREAMING_SNAKE_CASE` name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unregistered => "UNREGISTERED",
            Self::Active => "ACTIVE",
            Self::Paused => "PAUSED",
            Self::Suspended => "SUSPENDED",
            Self::Retired => "RETIRED",
        }
    }

    /// Parse the shared name.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.as_str() == name)
    }
}

/// The set of degradations observed while evaluating an account — `spec/accounting.md` §5.1.
///
/// A bitmask rather than a list because it is emitted onchain and read back by the UI, and
/// because the whole set is needed: the user is told *which* input degraded, not merely that
/// something did. Any non-empty set floors the account at [`AccountStatus::NoNewRisk`].
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Gates(u32);

/// The gate bits paired with the names the fixtures and the UI use.
///
/// Authored in name order, not bit order, because `expected.gates` in the canonical fixtures is a
/// sorted set of names. Sorting the table once, here, means [`Gates::names`] cannot drift and a
/// future reordering of the bits cannot silently change the serialised form.
const GATE_NAMES: [(Gates, &str); 7] = [
    (Gates::ASSET_SUSPENDED, "ASSET_SUSPENDED"),
    (Gates::CLAIM_CONFLICT, "CLAIM_CONFLICT"),
    (Gates::ORACLE_INVALID, "ORACLE_INVALID"),
    (Gates::ORACLE_STALE, "ORACLE_STALE"),
    (Gates::PASSPORT_STALE, "PASSPORT_STALE"),
    (Gates::SEQUENCER_DOWN, "SEQUENCER_DOWN"),
    (Gates::SEQUENCER_GRACE, "SEQUENCER_GRACE"),
];

impl Gates {
    /// No degradation observed.
    pub const NONE: Self = Self(0);
    /// A held asset's price is older than its policy allows.
    pub const ORACLE_STALE: Self = Self(1 << 0);
    /// A held asset has no usable price. A non-positive answer is not a price.
    pub const ORACLE_INVALID: Self = Self(1 << 1);
    /// A held asset's Passport is older than its policy allows.
    pub const PASSPORT_STALE: Self = Self(1 << 2);
    /// Two extraction paths disagreed about a held asset.
    pub const CLAIM_CONFLICT: Self = Self(1 << 3);
    /// A held asset, or its Passport, is suspended.
    pub const ASSET_SUSPENDED: Self = Self(1 << 4);
    /// The L2 sequencer is down, so no price can be arbitraged.
    pub const SEQUENCER_DOWN: Self = Self(1 << 5);
    /// The L2 sequencer restarted recently and is still inside its grace period.
    pub const SEQUENCER_GRACE: Self = Self(1 << 6);

    /// The raw bitmask, as emitted onchain.
    #[must_use]
    pub const fn bits(self) -> u32 {
        self.0
    }

    /// True when no gate is set.
    #[must_use]
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    /// True when every bit of `other` is set.
    #[must_use]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }

    /// Set the bits of `other`.
    pub fn insert(&mut self, other: Self) {
        self.0 |= other.0;
    }

    /// The names of the set gates, ascending by name — the exact form `expected.gates` takes in
    /// `fixtures/canonical/risk-scenarios.json`.
    #[must_use]
    pub fn names(self) -> Vec<&'static str> {
        GATE_NAMES
            .iter()
            .filter(|(gate, _)| self.contains(*gate))
            .map(|(_, name)| *name)
            .collect()
    }
}

impl core::ops::BitOr for Gates {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

impl core::ops::BitOrAssign for Gates {
    fn bitor_assign(&mut self, rhs: Self) {
        self.0 |= rhs.0;
    }
}

impl fmt::Debug for Gates {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Gates({:?})", self.names())
    }
}

/// One tier of an exit curve — `spec/accounting.md` §4.3.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct ExitTier {
    /// Position size, in usd18, at or below which this tier's recovery applies.
    pub threshold_usd18: Usd18,
    /// Fraction of market value recoverable at this size, in basis points.
    pub recovery_bps: u16,
}

/// Per-asset policy, owned by `RiskPolicyRegistry`.
///
/// Every field is a governance decision, not a statistical estimate. In particular the five
/// haircuts are deterministic policy bands and are **not** assumed independent — they are applied
/// in sequence, not summed (§4.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct RiskParameters {
    /// Borrowing capacity per unit of recognised value.
    pub initial_ltv_bps: u16,
    /// Threshold below which the account may take no new risk.
    pub maintenance_ltv_bps: u16,
    /// Threshold below which the account is liquidatable.
    pub liquidation_ltv_bps: u16,
    /// Share of the portfolio's uncapped recognised total this asset may contribute.
    pub max_concentration_bps: u16,
    /// Price volatility buffer.
    pub haircut_market_bps: u16,
    /// Market-depth buffer.
    pub haircut_liquidity_bps: u16,
    /// Issuer credit buffer.
    pub haircut_issuer_bps: u16,
    /// Settlement and custody buffer.
    pub haircut_settlement_bps: u16,
    /// Buffer for collateral whose custody is on another chain.
    pub haircut_crosschain_bps: u16,
    /// Seconds after which this asset's price is stale.
    pub max_oracle_age: u64,
    /// Seconds after which this asset's Passport is stale.
    pub max_passport_age: u64,
}

/// Everything the pipeline needs about one held position, fully materialised.
///
/// The pipeline reads no storage, no clock and no oracle: everything arrives here. That is what
/// lets the canonical fixtures drive all four implementations from the same bytes, and what makes
/// a differential test meaningful rather than a comparison of two different environments.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct AssetRiskInput {
    /// `keccak256(abi.encode(chainId, tokenAddress))`.
    pub asset_id: AssetId,
    /// Raw token units held by `CollateralVault`.
    pub quantity: u128,
    /// Token decimals; `10^decimals` is one whole unit.
    pub decimals: u8,
    /// Price in usd18. The Chainlink adapter converts 8dp answers once, exactly.
    pub price_usd18: Usd18,
    /// When the price was last published.
    pub price_updated_at: u64,
    /// When the Passport was last committed.
    pub passport_committed_at: u64,
    /// Passport lifecycle state.
    pub passport_status: PassportStatus,
    /// Whether the Passport evidences a redemption path at all (§4.4).
    pub redemption_supported: bool,
    /// The guaranteed fraction of market value on redemption, in basis points.
    pub redemption_floor_bps: u16,
    /// Registry-level asset state.
    pub asset_status: AssetStatus,
    /// Policy for this asset.
    pub params: RiskParameters,
    /// Exit curve: strictly ascending in threshold, non-increasing in recovery.
    pub exit_curve: Vec<ExitTier>,
}

/// The account state the pipeline consumes — `spec/accounting.md` §3.
///
/// There is no recognised-collateral field, here or onchain. Recognised value is derived on every
/// evaluation and never stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct AccountInput {
    /// Debt principal, scaled by the borrow index at the time it was taken.
    pub scaled_principal: u128,
    /// The current borrow index, in WAD. `1e18` at genesis, monotone non-decreasing.
    pub borrow_index: u128,
    /// Capital committed to in-flight external execution (§3.2).
    pub reserved_usd18: Usd18,
    /// Guardian floor. Never a ceiling: it enters the status computation through `max`.
    pub status_override: AccountStatus,
}

/// L2 sequencer liveness. A price nobody can arbitrage is not a price we lend against.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct SequencerInput {
    /// Whether the sequencer is currently up.
    pub up: bool,
    /// When it last restarted.
    pub last_restart_at: u64,
    /// How long after a restart prices remain untrusted.
    pub grace_period: u64,
}

impl SequencerInput {
    /// A sequencer that has been up since `last_restart_at`, with no grace period remaining.
    #[must_use]
    pub const fn up_since(last_restart_at: u64) -> Self {
        Self {
            up: true,
            last_restart_at,
            grace_period: 0,
        }
    }
}

/// The valuation of one position, with every intermediate kept.
///
/// The intermediates are not debug output. The asset page answers "why is this lower than the
/// market price?" by naming the binding constraint, and it can only do that if the pipeline
/// reports which term of the `min` won.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct AssetValuation {
    /// Which position this is.
    pub asset_id: AssetId,
    /// §4.1 `quantity × price ÷ 10^decimals`.
    pub market_value_usd18: Usd18,
    /// §4.2 market value after the five haircuts, applied in order.
    pub haircut_mark_usd18: Usd18,
    /// §4.3 market value at the recovery of the tier this position's size selects.
    pub stressed_exit_usd18: Usd18,
    /// §4.4 `None` when the Passport evidences no redemption path.
    ///
    /// `None` and `Some(0)` are different facts — "there is no redemption" versus "redemption
    /// guarantees nothing" — and only the second one binds the `min`. Collapsing them to zero, as
    /// the planning material's unconditional formula does, would value every asset without a
    /// redemption path at zero.
    pub redemption_floor_usd18: Option<Usd18>,
    /// §4.5 `min` of the applicable candidates.
    pub recognized_usd18: Usd18,
    /// §4.6 recognised value after the concentration cap.
    pub capped_usd18: Usd18,
}

#[cfg(test)]
mod tests {
    use super::{AccountStatus, AssetId, AssetStatus, Gates, PassportStatus, GATE_NAMES};

    #[test]
    fn status_order_is_the_frozen_total_order() {
        let names: Vec<&str> = AccountStatus::ALL.iter().map(|s| s.as_str()).collect();
        assert_eq!(
            names,
            [
                "NORMAL",
                "NO_NEW_RISK",
                "REDUCE_ONLY",
                "MARGIN_CALL",
                "LIQUIDATING",
                "SETTLED",
                "BAD_DEBT"
            ]
        );
        assert!(AccountStatus::ALL.windows(2).all(|w| w[0] < w[1]));
        assert_eq!(AccountStatus::default(), AccountStatus::Normal);
    }

    #[test]
    fn status_names_round_trip() {
        for status in AccountStatus::ALL {
            assert_eq!(AccountStatus::from_name(status.as_str()), Some(status));
        }
        assert_eq!(AccountStatus::from_name("HEALTHY"), None);
        for status in PassportStatus::ALL {
            assert_eq!(PassportStatus::from_name(status.as_str()), Some(status));
        }
        for status in AssetStatus::ALL {
            assert_eq!(AssetStatus::from_name(status.as_str()), Some(status));
        }
    }

    #[test]
    fn gate_bits_match_types_sol() {
        assert_eq!(Gates::ORACLE_STALE.bits(), 1 << 0);
        assert_eq!(Gates::ORACLE_INVALID.bits(), 1 << 1);
        assert_eq!(Gates::PASSPORT_STALE.bits(), 1 << 2);
        assert_eq!(Gates::CLAIM_CONFLICT.bits(), 1 << 3);
        assert_eq!(Gates::ASSET_SUSPENDED.bits(), 1 << 4);
        assert_eq!(Gates::SEQUENCER_DOWN.bits(), 1 << 5);
        assert_eq!(Gates::SEQUENCER_GRACE.bits(), 1 << 6);
    }

    #[test]
    fn gate_name_table_is_sorted_and_complete() {
        let names: Vec<&str> = GATE_NAMES.iter().map(|(_, n)| *n).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(names, sorted, "fixtures serialise gates sorted by name");

        let all = GATE_NAMES.iter().fold(Gates::NONE, |acc, (g, _)| acc | *g);
        assert_eq!(all.bits(), 0b111_1111, "every bit has a name");
        assert_eq!(all.names().len(), 7);
        assert!(Gates::NONE.is_empty());
        assert!(Gates::NONE.names().is_empty());
    }

    #[test]
    fn asset_ids_order_as_big_endian_integers() {
        let small =
            AssetId::from_hex("0x0000000000000000000000000000000000000000000000000000000000000a01")
                .unwrap();
        let large =
            AssetId::from_hex("0x0000000000000000000000000000000000000000000000000000000000000b02")
                .unwrap();
        assert!(small < large);
        assert_eq!(
            small.to_string(),
            "0x0000000000000000000000000000000000000000000000000000000000000a01"
        );
        assert_eq!(AssetId::from_hex("0x0a01"), None, "short hex is rejected");
        assert_eq!(AssetId::from_hex(&"z".repeat(64)), None);
    }
}

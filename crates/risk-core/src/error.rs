//! Every way the pipeline can refuse to produce a number.
//!
//! It refuses rather than approximating. Each variant corresponds to a revert in
//! `contracts/src/libraries/RiskMath.sol`, so a differential test can compare "both refused" as
//! readily as it compares two amounts, and a reference model that panicked where the chain
//! reverts would make that comparison impossible.

use core::fmt;

/// A refusal to value or evaluate.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RiskError {
    /// A division by zero was requested. Mirrors `RiskMath.ZeroDenominator`.
    ZeroDenominator,
    /// A value did not fit the 128-bit money domain. Solidity reverts on the same condition at
    /// 256 bits; either way, the answer is that this position cannot be valued, not that it is
    /// worth the wrapped remainder.
    Overflow,
    /// An exit curve with no tiers. Mirrors `RiskMath.ExitCurveEmpty`. A curve is the only thing
    /// that answers "what would this actually sell for", so its absence is not a zero haircut.
    ExitCurveEmpty,
    /// Positions were not strictly ascending by `assetId`. Mirrors `RiskMath.AssetsNotOrdered`.
    ///
    /// Truncated sums are order-dependent, so an unordered portfolio does not merely look odd,
    /// it totals differently from the onchain authority.
    AssetsNotOrdered {
        /// Index of the first position that is not strictly greater than its predecessor.
        index: usize,
    },
    /// `10^decimals` does not fit in 128 bits.
    DecimalsTooLarge {
        /// The offending decimals value.
        decimals: u8,
    },
    /// A basis-point input exceeded `BPS`, which would make a haircut negative.
    ///
    /// `RiskPolicyRegistry` rejects such a parameter on write, so this means policy validation
    /// was bypassed.
    BpsOutOfRange {
        /// The offending value, in basis points.
        value: u128,
    },
}

impl fmt::Display for RiskError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ZeroDenominator => f.write_str("division by zero"),
            Self::Overflow => f.write_str("value does not fit in the 128-bit money domain"),
            Self::ExitCurveEmpty => f.write_str("exit curve has no tiers"),
            Self::AssetsNotOrdered { index } => {
                write!(f, "assets must ascend by assetId; index {index} does not")
            }
            Self::DecimalsTooLarge { decimals } => {
                write!(f, "10^{decimals} does not fit in 128 bits")
            }
            Self::BpsOutOfRange { value } => write!(f, "{value} bps exceeds 10000"),
        }
    }
}

impl std::error::Error for RiskError {}

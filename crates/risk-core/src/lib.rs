//! The Usance risk pipeline, in Rust.
//!
//! `spec/accounting.md` names four readings of one document: Solidity is the onchain authority,
//! TypeScript previews values in the browser, Python transcribes the spec to generate the frozen
//! fixtures, and this crate is the reference model. Reference model means it has no authority
//! over funds and no reason to take shortcuts: where the Solidity implementation is shaped by gas
//! and the TypeScript one by the browser, this one is shaped only by the spec, so a disagreement
//! between it and the chain is the cheapest possible place to discover that a formula was read
//! two different ways.
//!
//! Every line maps to a numbered section of `spec/accounting.md`. If the two disagree, the spec
//! is right and this crate is a bug.
//!
//! ## What is deliberately absent
//!
//! - **Floating point.** Neither binary float type appears anywhere in this crate, including in
//!   the tests, and `tests/properties.rs` scans the sources to keep it that way. Money is `u128`
//!   at 18 decimals ([`Usd18`]); everything wider goes through [`U256`]. A binary fraction cannot
//!   represent a cent, and a risk engine that is occasionally off by an unrepresentable amount is
//!   a risk engine that occasionally over-lends.
//! - **Dependencies.** Including the fixture reader. See `Cargo.toml`.
//! - **`unsafe`.** Forbidden at the crate level, not merely discouraged.
//! - **Stored risk numbers.** [`evaluate`] is pure. Recognised value is derived on every read
//!   because a cached risk number that disagrees with the inputs justifying it is the exact
//!   failure this protocol exists to prevent (`spec/accounting.md` §3).
//!
//! ## Shape of the pipeline
//!
//! ```text
//! quantity × price  ──► market value        §4.1
//!                   ──► haircut mark        §4.2  five factors, fixed order, each flooring
//!                   ──► stressed exit       §4.3  size-dependent, not best-bid
//!                   ──► redemption floor    §4.4  only when a redemption path exists
//!   min of those    ──► recognised          §4.5
//!   cap vs total    ──► capped              §4.6  single pass over the *uncapped* total
//!   × LTV bands     ──► limits              §5
//!   vs debt + gates ──► status, capacity    §5.1
//! ```
//!
//! ## Example
//!
//! ```
//! use risk_core::{evaluate, AccountInput, SequencerInput};
//!
//! let report = evaluate(&[], &AccountInput::default(), &SequencerInput::up_since(0), 1_000)
//!     .expect("an empty portfolio always evaluates");
//!
//! assert_eq!(report.borrow_limit_usd18, 0);
//! assert_eq!(report.status.as_str(), "NORMAL");
//! // No debt means no maintenance requirement to breach, so health is unbounded rather than
//! // arbitrarily large — see `RiskReport::health_factor_wad`.
//! assert!(report.health_factor_wad.is_max());
//! ```

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![deny(missing_debug_implementations)]
// Restriction lints. Floating point is banned by `spec/accounting.md` §1, so it is denied by the
// compiler rather than by review; `tests/properties.rs` additionally scans the sources for the
// types themselves, since a lint only fires on arithmetic that was actually written.
#![deny(clippy::float_arithmetic)]
#![deny(clippy::float_cmp)]
#![deny(clippy::lossy_float_literal)]

mod error;
mod interest;
mod math;
mod portfolio;
mod types;
mod u256;
mod valuation;

pub use error::RiskError;
pub use interest::{
    accrue_index, borrow_rate_bps, borrow_rate_bps_at_utilisation, debt_usd18,
    scaled_principal_after_repay, scaled_principal_for_borrow, utilisation_bps, INDEX_GENESIS,
};
pub use math::{mul_div, mul_div_up, mul_div_wide, BPS, SECONDS_PER_YEAR, USD, WAD};
pub use portfolio::{evaluate, RiskReport};
pub use types::{
    AccountInput, AccountStatus, AssetId, AssetRiskInput, AssetStatus, AssetValuation, ExitTier,
    Gates, PassportStatus, RiskParameters, SequencerInput, Usd18,
};
pub use u256::U256;
pub use valuation::{asset_gates, select_recovery_bps, value_asset};

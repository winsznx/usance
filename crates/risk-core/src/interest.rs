//! The interest rate model and the borrow index — `spec/accounting.md` §3.1 and §6.
//!
//! Accrual is linear within a step and compounds by stepping the index. The step is taken on
//! every state-changing interaction, so the effective compounding frequency is "every
//! interaction" and never depends on how often anyone happened to call a poke function.

use crate::error::RiskError;
use crate::math::{mul_div, mul_div_up, BPS, SECONDS_PER_YEAR, WAD};

/// §3.1 — the scaled principal a borrow of `amount` adds, rounded **up**.
///
/// Debt is reconstructed from this number, so understating it by a single wei would hand the
/// borrower that wei permanently. Rounding up here is what makes [`debt_usd18`] of a fresh borrow
/// at least the amount borrowed.
///
/// # Errors
///
/// [`RiskError::ZeroDenominator`] for a zero index — the index starts at [`INDEX_GENESIS`] and
/// only grows, so a zero index means uninitialised state, not a free loan.
pub fn scaled_principal_for_borrow(amount: u128, index: u128) -> Result<u128, RiskError> {
    mul_div_up(amount, WAD, index)
}

/// §3.1 — the scaled principal remaining after repaying `amount`.
///
/// The *reduction* rounds down, which is round-up on the residual debt: a repayment can never
/// retire more debt than it pays for. It also means a repayment of exactly [`debt_usd18`] can
/// leave one wei behind, which is precisely why `FinancingEngine` gives "repay everything" its own
/// code path that zeroes the principal instead of relying on rounding to land on it.
///
/// # Errors
///
/// As [`scaled_principal_for_borrow`].
pub fn scaled_principal_after_repay(
    scaled_principal: u128,
    amount: u128,
    index: u128,
) -> Result<u128, RiskError> {
    let reduction = mul_div(amount, WAD, index)?;
    Ok(scaled_principal.saturating_sub(reduction))
}

/// §3.1 — debt reconstructed from scaled principal, rounded **up**.
///
/// # Errors
///
/// [`RiskError::Overflow`] when the debt leaves the money domain.
pub fn debt_usd18(scaled_principal: u128, index: u128) -> Result<u128, RiskError> {
    mul_div_up(scaled_principal, index, WAD)
}

/// §6 — utilisation in basis points, `borrows ÷ (cash + borrows)`, rounded down.
///
/// Zero borrows is zero utilisation by definition rather than by division: an empty market has no
/// utilisation, and `0/0` has no answer.
///
/// # Errors
///
/// [`RiskError::Overflow`] when `cash + borrows` leaves the money domain.
pub fn utilisation_bps(cash: u128, borrows: u128) -> Result<u128, RiskError> {
    if borrows == 0 {
        return Ok(0);
    }
    let total = cash.checked_add(borrows).ok_or(RiskError::Overflow)?;
    mul_div(borrows, BPS, total)
}

/// §6 — the two-slope curve evaluated at a given utilisation. Returns an annualised borrow rate
/// in basis points.
///
/// Split out from [`borrow_rate_bps`] so the curve can be exercised across its whole domain
/// directly, including at the kink, where the two branches must meet: at `u == kink` the first
/// branch yields `base + slope1` exactly, which is where the second branch starts.
///
/// # Errors
///
/// [`RiskError::BpsOutOfRange`] when `utilisation_bps` exceeds `BPS`, and
/// [`RiskError::ZeroDenominator`] when `kink_bps` is zero — `FinancingEngine._setRate` rejects
/// that parameter, so reaching it means policy validation was bypassed, and silently returning
/// the base rate would hide a market whose whole curve is misconfigured.
pub fn borrow_rate_bps_at_utilisation(
    utilisation_bps: u128,
    base_bps: u16,
    slope1_bps: u16,
    slope2_bps: u16,
    kink_bps: u16,
) -> Result<u128, RiskError> {
    if utilisation_bps > BPS {
        return Err(RiskError::BpsOutOfRange {
            value: utilisation_bps,
        });
    }
    let kink = u128::from(kink_bps);

    if utilisation_bps <= kink {
        return Ok(u128::from(base_bps) + mul_div(utilisation_bps, u128::from(slope1_bps), kink)?);
    }

    Ok(u128::from(base_bps)
        + u128::from(slope1_bps)
        + mul_div(utilisation_bps - kink, u128::from(slope2_bps), BPS - kink)?)
}

/// §6 — the annualised borrow rate in basis points for a market holding `cash` against
/// `borrows`.
///
/// Lender cash and account borrowing capacity are different constraints and are never conflated:
/// a borrow is limited by `min(availableBorrow, vault.availableCash())`, and this function is
/// only ever the price of the second.
///
/// # Errors
///
/// As [`utilisation_bps`] and [`borrow_rate_bps_at_utilisation`].
pub fn borrow_rate_bps(
    cash: u128,
    borrows: u128,
    base_bps: u16,
    slope1_bps: u16,
    slope2_bps: u16,
    kink_bps: u16,
) -> Result<u128, RiskError> {
    if borrows == 0 {
        return Ok(u128::from(base_bps));
    }
    let utilisation = utilisation_bps(cash, borrows)?;
    borrow_rate_bps_at_utilisation(utilisation, base_bps, slope1_bps, slope2_bps, kink_bps)
}

/// §3.1 — advance the borrow index over `dt_seconds` at `rate_bps`.
///
/// Growth is floored, which is round-down on the index. That is the one quantity where rounding
/// down is the conservative direction even though the index sits on the debt side: the index only
/// ever grows, and flooring each step keeps it monotone without ever letting rounding alone
/// inflate what borrowers owe.
///
/// # Errors
///
/// [`RiskError::Overflow`] when `rate × dt` or the resulting index leaves the money domain.
pub fn accrue_index(index: u128, rate_bps: u128, dt_seconds: u64) -> Result<u128, RiskError> {
    if dt_seconds == 0 || rate_bps == 0 {
        return Ok(index);
    }
    let elapsed_rate = rate_bps
        .checked_mul(u128::from(dt_seconds))
        .ok_or(RiskError::Overflow)?;
    let growth = mul_div(index, elapsed_rate, BPS * u128::from(SECONDS_PER_YEAR))?;
    index.checked_add(growth).ok_or(RiskError::Overflow)
}

/// The index at genesis: `1e18`.
pub const INDEX_GENESIS: u128 = WAD;

#[cfg(test)]
mod tests {
    use super::{
        accrue_index, borrow_rate_bps, borrow_rate_bps_at_utilisation, debt_usd18,
        scaled_principal_after_repay, scaled_principal_for_borrow, utilisation_bps, INDEX_GENESIS,
    };
    use crate::error::RiskError;
    use crate::math::{BPS, SECONDS_PER_YEAR, USD, WAD};

    // A conventional configuration: 1% base, 4% to the kink at 80%, then 60% beyond it.
    const BASE: u16 = 100;
    const SLOPE1: u16 = 400;
    const SLOPE2: u16 = 6_000;
    const KINK: u16 = 8_000;

    #[test]
    fn a_borrow_is_never_recorded_as_less_than_it_was() {
        // The index has grown, so the scaled principal is smaller than the amount — and the
        // rounding must still leave the reconstructed debt at or above what was handed out.
        let index = 1_053_700_000_000_000_000;
        for amount in [1u128, 7, 999, USD, 1_234_567_890_123_456_789, 50_000 * USD] {
            let scaled = scaled_principal_for_borrow(amount, index).unwrap();
            let debt = debt_usd18(scaled, index).unwrap();
            assert!(debt >= amount, "borrowing {amount} recorded {debt} of debt");
            assert!(debt <= amount + 1, "and never more than a wei of rounding");
        }
    }

    #[test]
    fn a_repayment_retires_no_more_debt_than_it_pays_for() {
        let index = 1_053_700_000_000_000_000;
        let scaled = scaled_principal_for_borrow(1_000 * USD, index).unwrap();
        let before = debt_usd18(scaled, index).unwrap();

        let payment = 400 * USD;
        let remaining = scaled_principal_after_repay(scaled, payment, index).unwrap();
        let after = debt_usd18(remaining, index).unwrap();

        assert!(after <= before, "a repayment cannot increase debt");
        assert!(
            before <= after + payment + 1,
            "a repayment cannot retire more than it pays for, beyond the one wei that the \
             dedicated repay-all path exists to absorb"
        );
    }

    #[test]
    fn over_repayment_clears_rather_than_underflowing() {
        let index = INDEX_GENESIS;
        let scaled = scaled_principal_for_borrow(100 * USD, index).unwrap();
        let remaining = scaled_principal_after_repay(scaled, 1_000_000 * USD, index).unwrap();
        assert_eq!(remaining, 0);
        assert_eq!(debt_usd18(remaining, index), Ok(0));
    }

    #[test]
    fn utilisation_is_zero_for_an_unborrowed_market() {
        assert_eq!(utilisation_bps(1_000 * USD, 0), Ok(0));
        assert_eq!(utilisation_bps(0, 0), Ok(0));
    }

    #[test]
    fn utilisation_rounds_down() {
        // 1 borrowed against 3 total is 3333.33 bps.
        assert_eq!(utilisation_bps(2, 1), Ok(3_333));
        assert_eq!(utilisation_bps(0, 1_000), Ok(BPS), "fully utilised");
    }

    #[test]
    fn the_curve_is_continuous_at_the_kink() {
        let at_kink =
            borrow_rate_bps_at_utilisation(u128::from(KINK), BASE, SLOPE1, SLOPE2, KINK).unwrap();
        assert_eq!(at_kink, u128::from(BASE) + u128::from(SLOPE1));

        let just_past =
            borrow_rate_bps_at_utilisation(u128::from(KINK) + 1, BASE, SLOPE1, SLOPE2, KINK)
                .unwrap();
        assert!(just_past >= at_kink);
    }

    #[test]
    fn the_curve_spans_base_to_base_plus_both_slopes() {
        assert_eq!(
            borrow_rate_bps_at_utilisation(0, BASE, SLOPE1, SLOPE2, KINK),
            Ok(u128::from(BASE))
        );
        assert_eq!(
            borrow_rate_bps_at_utilisation(BPS, BASE, SLOPE1, SLOPE2, KINK),
            Ok(u128::from(BASE) + u128::from(SLOPE1) + u128::from(SLOPE2))
        );
    }

    #[test]
    fn an_unborrowed_market_prices_at_base_without_touching_the_kink() {
        // kink = 0 would divide by zero on the first branch; zero borrows never reaches it.
        assert_eq!(
            borrow_rate_bps(1_000 * USD, 0, BASE, SLOPE1, SLOPE2, 0),
            Ok(u128::from(BASE))
        );
        assert_eq!(
            borrow_rate_bps_at_utilisation(0, BASE, SLOPE1, SLOPE2, 0),
            Err(RiskError::ZeroDenominator)
        );
    }

    #[test]
    fn utilisation_beyond_full_is_refused() {
        assert_eq!(
            borrow_rate_bps_at_utilisation(BPS + 1, BASE, SLOPE1, SLOPE2, KINK),
            Err(RiskError::BpsOutOfRange { value: BPS + 1 })
        );
    }

    #[test]
    fn a_full_year_at_ten_percent_grows_the_index_by_ten_percent() {
        let grown = accrue_index(INDEX_GENESIS, 1_000, SECONDS_PER_YEAR).unwrap();
        assert_eq!(grown, 1_100_000_000_000_000_000);
    }

    #[test]
    fn accrual_is_the_identity_for_a_zero_step_or_a_zero_rate() {
        assert_eq!(accrue_index(WAD, 1_000, 0), Ok(WAD));
        assert_eq!(accrue_index(WAD, 0, SECONDS_PER_YEAR), Ok(WAD));
    }

    #[test]
    fn a_one_second_step_at_a_low_rate_floors_to_no_growth() {
        // 1 bp for one second on a 1e18 index is 3.17e6 wei of growth — but on an index of 1 wei
        // it is a millionth of a wei, and flooring keeps it at 1 rather than inventing debt.
        assert_eq!(accrue_index(1, 1, 1), Ok(1));
        assert!(accrue_index(WAD, 1, 1).unwrap() > WAD);
    }

    #[test]
    fn stepping_compounds_and_never_falls_behind_a_single_step() {
        let single = accrue_index(WAD, 1_000, SECONDS_PER_YEAR).unwrap();
        let mut stepped = WAD;
        for _ in 0..12 {
            stepped = accrue_index(stepped, 1_000, SECONDS_PER_YEAR / 12).unwrap();
        }
        assert!(
            stepped >= single,
            "monthly stepping compounds: {stepped} vs {single}"
        );
    }
}

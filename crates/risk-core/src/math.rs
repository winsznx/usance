//! Scales and rounding primitives — `spec/accounting.md` §1.
//!
//! Rounding direction is a property of the quantity, never of the call site: round in whichever
//! direction reduces the protocol's risk. Collateral, limits and withdrawable amounts round
//! down; debt, accrued interest and scaled principal round up. There is one rule and it has no
//! exceptions, which is why there are exactly two primitives here and no third that takes a
//! direction as an argument — a caller that can choose is a caller that can choose wrong.

use crate::error::RiskError;
use crate::u256::U256;

/// Basis points. Every ratio, haircut and LTV in the protocol is denominated in these.
pub const BPS: u128 = 10_000;

/// The fixed-point scale for the interest index and the health factor: `1e18`.
pub const WAD: u128 = 1_000_000_000_000_000_000;

/// The fixed-point scale for every internal USD amount: `1e18`. `1 USD` is `1e18`.
pub const USD: u128 = 1_000_000_000_000_000_000;

/// 365 days. Not 365.25, not a leap-year table — interest must be reproducible from a timestamp
/// difference alone, by four implementations, without a calendar.
pub const SECONDS_PER_YEAR: u64 = 31_536_000;

/// `a × b ÷ d`, rounded **down**, with a 256-bit intermediate.
///
/// Truncation toward zero is round-down for the non-negative domain this protocol lives in, so
/// there is no explicit flooring step; the width of the intermediate is the part that matters.
/// See [`U256`] for why 128 bits is not enough to hold `a × b`.
///
/// # Errors
///
/// [`RiskError::ZeroDenominator`] for `d == 0`, and [`RiskError::Overflow`] when the quotient
/// does not fit back into the 128-bit money domain.
pub fn mul_div(a: u128, b: u128, d: u128) -> Result<u128, RiskError> {
    let (quotient, _) = U256::mul_u128(a, b)
        .div_rem_u128(d)
        .ok_or(RiskError::ZeroDenominator)?;
    quotient.try_into_u128().ok_or(RiskError::Overflow)
}

/// `a × b ÷ d`, rounded **up**. Used for every quantity the user owes.
///
/// Computed as `(a·b - 1)/d + 1` on the 256-bit product rather than as "divide, then add one if
/// there was a remainder", so that a zero product short-circuits and no case can round `0` up to
/// `1`. A protocol that invents one wei of debt out of an empty position cannot satisfy invariant
/// `I-04` ("repaying the exact debt clears the account").
///
/// # Errors
///
/// As [`mul_div`].
pub fn mul_div_up(a: u128, b: u128, d: u128) -> Result<u128, RiskError> {
    if d == 0 {
        return Err(RiskError::ZeroDenominator);
    }
    let product = U256::mul_u128(a, b);
    if product.is_zero() {
        return Ok(0);
    }
    let (quotient, _) = product
        .checked_sub(U256::ONE)
        .ok_or(RiskError::Overflow)?
        .div_rem_u128(d)
        .ok_or(RiskError::ZeroDenominator)?;
    quotient
        .checked_add(U256::ONE)
        .ok_or(RiskError::Overflow)?
        .try_into_u128()
        .ok_or(RiskError::Overflow)
}

/// `a × b ÷ d`, rounded down, keeping the full 256-bit quotient.
///
/// Only the health factor needs this: `maintenanceLimit × 1e18 ÷ debt` against a one-wei debt is
/// far wider than 128 bits, and the onchain authority returns a `uint256` there. Narrowing it
/// would turn a healthy account into an arithmetic error at exactly the moment the number stops
/// mattering.
///
/// # Errors
///
/// [`RiskError::ZeroDenominator`] for `d == 0`.
pub fn mul_div_wide(a: u128, b: u128, d: u128) -> Result<U256, RiskError> {
    let (quotient, _) = U256::mul_u128(a, b)
        .div_rem_u128(d)
        .ok_or(RiskError::ZeroDenominator)?;
    Ok(quotient)
}

/// `BPS - value`, rejecting a basis-point input that exceeds `BPS`.
///
/// The Solidity authority reverts on the underflow; naming the condition is the same behaviour
/// with a legible cause. `RiskPolicyRegistry` rejects such a parameter on write, so reaching
/// this error means a caller bypassed policy validation.
///
/// # Errors
///
/// [`RiskError::BpsOutOfRange`] when `value > BPS`.
pub(crate) fn complement_bps(value: u16) -> Result<u128, RiskError> {
    let value = u128::from(value);
    BPS.checked_sub(value)
        .ok_or(RiskError::BpsOutOfRange { value })
}

#[cfg(test)]
mod tests {
    use super::{mul_div, mul_div_up, mul_div_wide, BPS, WAD};
    use crate::error::RiskError;
    use crate::u256::U256;

    #[test]
    fn rounding_directions_differ_by_at_most_one() {
        assert_eq!(mul_div(7, 3, 2), Ok(10));
        assert_eq!(mul_div_up(7, 3, 2), Ok(11));
        assert_eq!(mul_div(8, 2, 4), Ok(4));
        assert_eq!(
            mul_div_up(8, 2, 4),
            Ok(4),
            "exact division must not round up"
        );
    }

    #[test]
    fn zero_never_rounds_up_to_one() {
        assert_eq!(mul_div_up(0, u128::MAX, 1), Ok(0));
        assert_eq!(mul_div_up(u128::MAX, 0, 1), Ok(0));
        assert_eq!(mul_div_up(1, 1, u128::MAX), Ok(1), "one wei is not zero");
    }

    #[test]
    fn intermediate_exceeds_128_bits_without_failing() {
        // 1e30 raw units of an 18-decimal asset at $100: the product is 1e50, twelve orders of
        // magnitude past `u128::MAX`, while the result is an ordinary 1e32.
        let quantity = 10u128.pow(30);
        let price = 100 * WAD;
        assert!(
            quantity.checked_mul(price).is_none(),
            "128 bits is not enough"
        );
        assert_eq!(mul_div(quantity, price, WAD), Ok(10u128.pow(32)));
    }

    #[test]
    fn overflowing_result_is_an_error_not_a_wrap() {
        assert_eq!(mul_div(u128::MAX, u128::MAX, 1), Err(RiskError::Overflow));
        assert_eq!(
            mul_div_up(u128::MAX, u128::MAX, 1),
            Err(RiskError::Overflow)
        );
    }

    #[test]
    fn zero_denominator_is_an_error_not_a_panic() {
        assert_eq!(mul_div(1, 1, 0), Err(RiskError::ZeroDenominator));
        assert_eq!(mul_div_up(1, 1, 0), Err(RiskError::ZeroDenominator));
        assert_eq!(mul_div_wide(1, 1, 0), Err(RiskError::ZeroDenominator));
    }

    #[test]
    fn wide_quotient_survives_a_one_wei_denominator() {
        // The health factor of an account with a large maintenance limit and one wei of debt.
        let maintenance = u128::MAX;
        let wide = mul_div_wide(maintenance, WAD, 1).unwrap();
        assert!(wide > U256::from_u128(u128::MAX));
        assert_eq!(wide, U256::mul_u128(maintenance, WAD));
    }

    #[test]
    fn basis_point_haircut_of_a_typical_position() {
        // 1,000 tokens at $1, 0.5% market haircut.
        let market = 1_000 * WAD;
        assert_eq!(mul_div(market, BPS - 50, BPS), Ok(995 * WAD));
    }
}

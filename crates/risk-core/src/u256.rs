//! A 256-bit unsigned integer, only as much of one as the pipeline needs.
//!
//! Two reasons this type exists, and neither is convenience.
//!
//! **Intermediates.** A realistic tokenized position is ~1e30 raw units and every price is
//! 1e18-scaled, so `quantity × price` reaches ~1e48 while `u128` stops at ~3.4e38. The *result*
//! of `mulDiv` fits comfortably; the product on the way there does not. An implementation that
//! multiplies in 128 bits and divides afterwards does not produce a slightly different number,
//! it produces a panic on exactly the large positions the protocol most wants to value
//! correctly. `spec/accounting.md` §1.2 calls this out as a bug rather than a rounding
//! difference, and the Solidity authority carries a 512-bit intermediate for the same reason.
//!
//! **Unbounded health.** `healthFactor` is `type(uint256).max` when there is no debt
//! (§5). That sentinel does not fit in 128 bits, and neither does a finite health factor against
//! a one-wei debt, so [`crate::RiskReport::health_factor_wad`] is a `U256` and the fixture's
//! decimal string round-trips through [`U256::from_dec_str`] exactly.
//!
//! Hand-rolled rather than taken from a crate: see `Cargo.toml`.

use core::cmp::Ordering;
use core::fmt;

/// Low 64 bits, used to split a `u128` into halves that can be multiplied without overflow.
const MASK64: u128 = u64::MAX as u128;

/// An unsigned 256-bit integer, stored as two 128-bit limbs.
///
/// Field order is load-bearing: the derived [`Ord`] compares `hi` before `lo`, which is the
/// ordering of the underlying big-endian integer. Swapping the declaration order would silently
/// reverse comparisons on large values, so the derive is kept and the order is documented here
/// rather than the comparison being hand-written.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct U256 {
    hi: u128,
    lo: u128,
}

impl U256 {
    /// Zero.
    pub const ZERO: Self = Self { hi: 0, lo: 0 };

    /// One.
    pub const ONE: Self = Self { hi: 0, lo: 1 };

    /// `2^256 - 1`, the value `healthFactor` takes when an account carries no debt.
    pub const MAX: Self = Self {
        hi: u128::MAX,
        lo: u128::MAX,
    };

    /// Widen a 128-bit value.
    #[must_use]
    pub const fn from_u128(value: u128) -> Self {
        Self { hi: 0, lo: value }
    }

    /// Narrow to 128 bits, or `None` when the value does not fit.
    ///
    /// Every money quantity in the protocol is a `u128` ([`crate::Usd18`]); this is the single
    /// point where a 256-bit intermediate is admitted back into that domain, and it refuses
    /// rather than truncating.
    #[must_use]
    pub const fn try_into_u128(self) -> Option<u128> {
        if self.hi == 0 {
            Some(self.lo)
        } else {
            None
        }
    }

    /// True when the value is zero.
    #[must_use]
    pub const fn is_zero(self) -> bool {
        self.hi == 0 && self.lo == 0
    }

    /// True when the value is [`U256::MAX`], i.e. the "no debt, unbounded health" sentinel.
    #[must_use]
    pub const fn is_max(self) -> bool {
        self.hi == u128::MAX && self.lo == u128::MAX
    }

    /// The exact 256-bit product of two 128-bit values. Cannot overflow: `(2^128-1)^2 < 2^256`.
    #[must_use]
    pub const fn mul_u128(a: u128, b: u128) -> Self {
        let (a_hi, a_lo) = (a >> 64, a & MASK64);
        let (b_hi, b_lo) = (b >> 64, b & MASK64);

        // Each partial product is a 64×64 multiply, so each fits in 128 bits exactly.
        let ll = a_lo * b_lo;
        let lh = a_lo * b_hi;
        let hl = a_hi * b_lo;
        let hh = a_hi * b_hi;

        // The cross terms sum to at most 2·(2^64-1)^2, which is one bit wider than a `u128`;
        // that carry lands at bit 192, hence the `<< 64` when it is folded into `hi`.
        let (mid, mid_carry) = lh.overflowing_add(hl);
        let (lo, lo_carry) = ll.overflowing_add(mid << 64);
        let hi = hh + (mid >> 64) + (lo_carry as u128) + ((mid_carry as u128) << 64);

        Self { hi, lo }
    }

    /// Addition, `None` on overflow past `2^256`.
    #[must_use]
    pub const fn checked_add(self, other: Self) -> Option<Self> {
        let (lo, carry) = self.lo.overflowing_add(other.lo);
        let hi = match self.hi.checked_add(other.hi) {
            Some(h) => h,
            None => return None,
        };
        match hi.checked_add(carry as u128) {
            Some(hi) => Some(Self { hi, lo }),
            None => None,
        }
    }

    /// Subtraction, `None` on underflow below zero.
    #[must_use]
    pub const fn checked_sub(self, other: Self) -> Option<Self> {
        let (lo, borrow) = self.lo.overflowing_sub(other.lo);
        let hi = match self.hi.checked_sub(other.hi) {
            Some(h) => h,
            None => return None,
        };
        match hi.checked_sub(borrow as u128) {
            Some(hi) => Some(Self { hi, lo }),
            None => None,
        }
    }

    /// Multiplication by a 128-bit value, `None` on overflow past `2^256`.
    #[must_use]
    pub const fn checked_mul_u128(self, multiplier: u128) -> Option<Self> {
        let lo_part = Self::mul_u128(self.lo, multiplier);
        let hi_part = Self::mul_u128(self.hi, multiplier);
        if hi_part.hi != 0 {
            return None;
        }
        match lo_part.hi.checked_add(hi_part.lo) {
            Some(hi) => Some(Self { hi, lo: lo_part.lo }),
            None => None,
        }
    }

    /// Euclidean division by a 128-bit divisor, returning `(quotient, remainder)`.
    ///
    /// Returns `None` only for a zero divisor, which the callers surface as
    /// [`crate::RiskError::ZeroDenominator`] rather than as a panic — the Solidity authority
    /// reverts there too, and a reference model that panicked would be harder to differentially
    /// test against a chain that reverts.
    ///
    /// Restoring bitwise long division: 256 iterations, no lookup tables, no reciprocal
    /// estimation. Knuth's algorithm D would be perhaps twenty times faster and considerably
    /// harder to check by eye. This is a reference model, and `tests/properties.rs` verifies
    /// `q·d + r == a·b` with `r < d` over the full 128-bit input range, which is the property
    /// that matters.
    #[must_use]
    pub fn div_rem_u128(self, divisor: u128) -> Option<(Self, u128)> {
        if divisor == 0 {
            return None;
        }

        let mut quotient = Self::ZERO;
        let mut remainder: u128 = 0u128;

        let mut i: u32 = 256;
        while i > 0 {
            i -= 1;

            // `remainder` is always < divisor <= 2^128-1, so shifting it left can push exactly
            // one bit out of the 128-bit window. When it does, the true value is >= 2^128 and
            // therefore certainly >= divisor, so a subtraction is owed; `wrapping_sub` then
            // yields the correct low bits because the difference is < 2^128 again.
            let carried_out = remainder >> 127 != 0;
            remainder = (remainder << 1) | self.bit(i);

            if carried_out || remainder >= divisor {
                remainder = remainder.wrapping_sub(divisor);
                quotient.set_bit(i);
            }
        }

        Some((quotient, remainder))
    }

    /// Parse an unsigned decimal string. `None` on an empty string, a non-digit, or overflow.
    ///
    /// Big integers cross every boundary in this protocol as decimal strings — the canonical
    /// fixtures, the JSON API and the browser all use them, because a JSON number cannot carry
    /// 78 digits without becoming a float and losing the last twenty.
    #[must_use]
    pub fn from_dec_str(text: &str) -> Option<Self> {
        if text.is_empty() {
            return None;
        }
        let mut acc = Self::ZERO;
        for byte in text.bytes() {
            if !byte.is_ascii_digit() {
                return None;
            }
            acc = acc
                .checked_mul_u128(10)?
                .checked_add(Self::from_u128(u128::from(byte - b'0')))?;
        }
        Some(acc)
    }

    /// Bit `i`, counted from the least significant.
    const fn bit(self, i: u32) -> u128 {
        if i >= 128 {
            (self.hi >> (i - 128)) & 1
        } else {
            (self.lo >> i) & 1
        }
    }

    /// Set bit `i`, counted from the least significant.
    const fn set_bit(&mut self, i: u32) {
        if i >= 128 {
            self.hi |= 1u128 << (i - 128);
        } else {
            self.lo |= 1u128 << i;
        }
    }
}

impl From<u128> for U256 {
    fn from(value: u128) -> Self {
        Self::from_u128(value)
    }
}

impl PartialEq<u128> for U256 {
    fn eq(&self, other: &u128) -> bool {
        self.hi == 0 && self.lo == *other
    }
}

impl PartialOrd<u128> for U256 {
    fn partial_cmp(&self, other: &u128) -> Option<Ordering> {
        Some(if self.hi != 0 {
            Ordering::Greater
        } else {
            self.lo.cmp(other)
        })
    }
}

impl fmt::Display for U256 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_zero() {
            return f.write_str("0");
        }
        // 2^256 - 1 is 78 digits.
        let mut digits = Vec::with_capacity(78);
        let mut value = *self;
        while !value.is_zero() {
            let (quotient, remainder) = value.div_rem_u128(10).expect("10 is not zero");
            digits.push(b'0' + u8::try_from(remainder).expect("a remainder mod 10 is one digit"));
            value = quotient;
        }
        digits.reverse();
        f.write_str(core::str::from_utf8(&digits).expect("digits are ASCII"))
    }
}

/// Decimal, same as [`fmt::Display`]. A 256-bit value printed in hex limbs is unreadable in a test
/// failure, and a test failure here is someone comparing against a fixture written in decimal.
impl fmt::Debug for U256 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

#[cfg(test)]
mod tests {
    use super::U256;

    const U128_MAX: u128 = u128::MAX;

    #[test]
    fn max_round_trips_through_decimal() {
        let text = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
        assert_eq!(U256::from_dec_str(text), Some(U256::MAX));
        assert_eq!(U256::MAX.to_string(), text);
        assert!(U256::MAX.is_max());
    }

    #[test]
    fn decimal_parsing_rejects_junk() {
        assert_eq!(U256::from_dec_str(""), None);
        assert_eq!(U256::from_dec_str("12a"), None);
        assert_eq!(U256::from_dec_str("-1"), None);
        assert_eq!(U256::from_dec_str("1.0"), None);
        // 2^256, one past the top.
        assert_eq!(
            U256::from_dec_str(
                "115792089237316195423570985008687907853269984665640564039457584007913129639936"
            ),
            None
        );
    }

    #[test]
    fn widest_product_is_exact() {
        // (2^128-1)^2 = 2^256 - 2^129 + 1.
        let product = U256::mul_u128(U128_MAX, U128_MAX);
        let expected = U256::MAX
            .checked_sub(U256::from_dec_str("680564733841876926926749214863536422910").unwrap())
            .unwrap();
        assert_eq!(product, expected, "2^256 - 2^129 + 1");
        assert_eq!(product.try_into_u128(), None);
    }

    #[test]
    fn division_reconstructs_the_dividend() {
        let a = 0x0123_4567_89ab_cdef_0123_4567_89ab_cdefu128;
        let b = 0xfedc_ba98_7654_3210_fedc_ba98_7654_3210u128;
        let d = 1_000_000_000_000_000_000u128;

        let product = U256::mul_u128(a, b);
        let (q, r) = product.div_rem_u128(d).unwrap();
        assert!(r < d);
        assert_eq!(
            q.checked_mul_u128(d)
                .unwrap()
                .checked_add(r.into())
                .unwrap(),
            product
        );
    }

    #[test]
    fn division_by_zero_is_none_not_a_panic() {
        assert_eq!(U256::from_u128(1).div_rem_u128(0), None);
    }

    #[test]
    fn ordering_compares_the_high_limb_first() {
        let big = U256::mul_u128(U128_MAX, U128_MAX);
        assert!(big > U256::from_u128(U128_MAX));
        assert!(big > U128_MAX);
        assert!(U256::from_u128(7) < U256::from_u128(8));
        assert!(U256::from_u128(7) == 7u128);
    }
}

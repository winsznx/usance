//! Per-position valuation — `spec/accounting.md` §4, plus the per-asset half of §5.1.

use crate::error::RiskError;
use crate::math::{complement_bps, mul_div, BPS};
use crate::types::{
    AssetRiskInput, AssetStatus, AssetValuation, ExitTier, Gates, PassportStatus, Usd18,
};

/// §4.3 — the recovery band for a position of this size.
///
/// First tier whose threshold is at or above the position; past the last threshold, the last and
/// therefore worst tier. `RiskPolicyRegistry` guarantees the curve ascends in threshold and does
/// not increase in recovery (invariant `I-14`), which is what makes "last" mean "worst" — a curve
/// that recovered better at larger size would not be a liquidity curve, it would be a typo.
///
/// # Errors
///
/// [`RiskError::ExitCurveEmpty`] when the curve has no tiers.
pub fn select_recovery_bps(curve: &[ExitTier], market_value: Usd18) -> Result<u16, RiskError> {
    if curve.is_empty() {
        return Err(RiskError::ExitCurveEmpty);
    }
    for tier in curve {
        if market_value <= tier.threshold_usd18 {
            return Ok(tier.recovery_bps);
        }
    }
    Ok(curve[curve.len() - 1].recovery_bps)
}

/// §4.1–§4.5 — value one position, keeping every intermediate.
///
/// # Errors
///
/// [`RiskError::DecimalsTooLarge`] for an unrepresentable unit, [`RiskError::BpsOutOfRange`] for
/// a haircut above `BPS`, [`RiskError::ExitCurveEmpty`] for a missing curve, and
/// [`RiskError::Overflow`] when a value leaves the 128-bit money domain.
pub fn value_asset(asset: &AssetRiskInput) -> Result<AssetValuation, RiskError> {
    let unit =
        10u128
            .checked_pow(u32::from(asset.decimals))
            .ok_or(RiskError::DecimalsTooLarge {
                decimals: asset.decimals,
            })?;

    // §4.1
    let market_value_usd18 = mul_div(asset.quantity, asset.price_usd18, unit)?;

    // §4.2 — five haircuts in a fixed order, each flooring separately. Summing them instead
    // would let the total exceed BPS and drive the mark negative; sequential application is
    // monotone, stays inside [0, marketValue], and leaves every intermediate explainable to a
    // user. The order is frozen because truncation makes it observable.
    let params = &asset.params;
    let mut mark = market_value_usd18;
    for haircut in [
        params.haircut_market_bps,
        params.haircut_liquidity_bps,
        params.haircut_issuer_bps,
        params.haircut_settlement_bps,
        params.haircut_crosschain_bps,
    ] {
        mark = mul_div(mark, complement_bps(haircut)?, BPS)?;
    }

    // §4.3 — what the position would actually recover at this size, not what the best bid says.
    let recovery_bps = select_recovery_bps(&asset.exit_curve, market_value_usd18)?;
    let stressed_exit_usd18 = mul_div(market_value_usd18, u128::from(recovery_bps), BPS)?;

    // §4.5
    let mut recognized_usd18 = mark.min(stressed_exit_usd18);

    // §4.4 — the redemption floor is an alternative exit path, so it joins the `min` only when
    // the Passport evidences one. Applying it unconditionally would read a missing redemption
    // path as a floor of zero and value every non-redeemable asset at nothing.
    let redemption_floor_usd18 = if asset.redemption_supported {
        let floor = mul_div(
            market_value_usd18,
            u128::from(asset.redemption_floor_bps),
            BPS,
        )?;
        recognized_usd18 = recognized_usd18.min(floor);
        Some(floor)
    } else {
        None
    };

    Ok(AssetValuation {
        asset_id: asset.asset_id,
        market_value_usd18,
        haircut_mark_usd18: mark,
        stressed_exit_usd18,
        redemption_floor_usd18,
        recognized_usd18,
        capped_usd18: 0,
    })
}

/// §5.1 — the restrictions this position's inputs imply at `now`.
///
/// A zero-quantity position contributes nothing. Holding none of a suspended asset must not
/// restrict an account, or every retired asset anyone ever touched would freeze the protocol.
#[must_use]
pub fn asset_gates(asset: &AssetRiskInput, now: u64) -> Gates {
    if asset.quantity == 0 {
        return Gates::NONE;
    }

    let mut gates = Gates::NONE;

    // Saturating, so a timestamp in the future reads as "zero seconds old" rather than wrapping
    // into maximal staleness. A clock skewed forward by a second is a degraded input; treating
    // it as a 584-billion-year-old price would be a fabricated one.
    if now.saturating_sub(asset.price_updated_at) > asset.params.max_oracle_age {
        gates.insert(Gates::ORACLE_STALE);
    }
    if asset.price_usd18 == 0 {
        gates.insert(Gates::ORACLE_INVALID);
    }
    if now.saturating_sub(asset.passport_committed_at) > asset.params.max_passport_age {
        gates.insert(Gates::PASSPORT_STALE);
    }
    if asset.passport_status == PassportStatus::Conflicted {
        gates.insert(Gates::CLAIM_CONFLICT);
    }
    if asset.passport_status == PassportStatus::Suspended
        || asset.asset_status == AssetStatus::Suspended
    {
        gates.insert(Gates::ASSET_SUSPENDED);
    }

    gates
}

#[cfg(test)]
mod tests {
    use super::{asset_gates, select_recovery_bps, value_asset};
    use crate::error::RiskError;
    use crate::math::{USD, WAD};
    use crate::types::{
        AssetId, AssetRiskInput, AssetStatus, ExitTier, Gates, PassportStatus, RiskParameters,
    };

    fn tier(threshold_usd: u128, recovery_bps: u16) -> ExitTier {
        ExitTier {
            threshold_usd18: threshold_usd * USD,
            recovery_bps,
        }
    }

    fn tbill(quantity_tokens: u128) -> AssetRiskInput {
        AssetRiskInput {
            asset_id: AssetId::new([0u8; 32]),
            quantity: quantity_tokens * WAD,
            decimals: 18,
            price_usd18: USD,
            price_updated_at: 1_000,
            passport_committed_at: 1_000,
            passport_status: PassportStatus::Active,
            redemption_supported: true,
            redemption_floor_bps: 9_900,
            asset_status: AssetStatus::Active,
            params: RiskParameters {
                initial_ltv_bps: 8_500,
                maintenance_ltv_bps: 9_000,
                liquidation_ltv_bps: 9_300,
                max_concentration_bps: 10_000,
                haircut_market_bps: 50,
                haircut_liquidity_bps: 25,
                haircut_issuer_bps: 100,
                haircut_settlement_bps: 25,
                haircut_crosschain_bps: 0,
                max_oracle_age: 86_400,
                max_passport_age: 2_592_000,
            },
            exit_curve: vec![tier(100_000, 9_990), tier(500_000, 9_960)],
        }
    }

    #[test]
    fn exit_curve_selects_the_first_tier_at_or_above_the_position() {
        let curve = [tier(100, 9_990), tier(500, 9_960), tier(2_000, 9_900)];
        assert_eq!(select_recovery_bps(&curve, 0), Ok(9_990));
        assert_eq!(
            select_recovery_bps(&curve, 100 * USD),
            Ok(9_990),
            "boundary"
        );
        assert_eq!(select_recovery_bps(&curve, 100 * USD + 1), Ok(9_960));
        assert_eq!(select_recovery_bps(&curve, 2_000 * USD), Ok(9_900));
        assert_eq!(
            select_recovery_bps(&curve, 2_000 * USD + 1),
            Ok(9_900),
            "past the last threshold the worst tier applies"
        );
        assert_eq!(select_recovery_bps(&[], 1), Err(RiskError::ExitCurveEmpty));
    }

    #[test]
    fn haircuts_are_sequential_not_summed() {
        let asset = tbill(1_000);
        let value = value_asset(&asset).unwrap();
        // 1000e18 × 0.9950 × 0.9975 × 0.99 × 0.9975, each step flooring.
        assert_eq!(value.market_value_usd18, 1_000 * USD);
        assert_eq!(value.haircut_mark_usd18, 980_130_906_562_500_000_000);
        // Summing 50+25+100+25 = 200bps would give 980e18 — close, and wrong.
        assert_ne!(value.haircut_mark_usd18, 980 * USD);
    }

    #[test]
    fn recognition_is_the_minimum_of_the_applicable_candidates() {
        let mut asset = tbill(1_000);
        let with_redemption = value_asset(&asset).unwrap();
        assert_eq!(with_redemption.redemption_floor_usd18, Some(990 * USD));
        assert_eq!(
            with_redemption.recognized_usd18,
            with_redemption.haircut_mark_usd18
        );

        // A floor below the haircut mark binds instead.
        asset.redemption_floor_bps = 9_000;
        let floored = value_asset(&asset).unwrap();
        assert_eq!(floored.recognized_usd18, 900 * USD);

        // With no redemption path the floor does not participate at all — the unconditional
        // formula would recognise zero here.
        asset.redemption_supported = false;
        let no_redemption = value_asset(&asset).unwrap();
        assert_eq!(no_redemption.redemption_floor_usd18, None);
        assert_eq!(
            no_redemption.recognized_usd18,
            no_redemption.haircut_mark_usd18
        );
    }

    #[test]
    fn a_single_wei_truncates_to_zero_without_underflowing() {
        let mut asset = tbill(0);
        asset.quantity = 1;
        let value = value_asset(&asset).unwrap();
        // One wei of an 18-decimal token at $1 is one wei of usd18 — and every downstream
        // multiplier is below 1, so recognition floors to nothing rather than wrapping.
        assert_eq!(value.market_value_usd18, 1);
        assert_eq!(value.haircut_mark_usd18, 0);
        assert_eq!(value.stressed_exit_usd18, 0);
        assert_eq!(value.recognized_usd18, 0);
    }

    #[test]
    fn a_zero_quantity_position_contributes_no_gates() {
        let mut asset = tbill(0);
        asset.asset_status = AssetStatus::Suspended;
        asset.passport_status = PassportStatus::Conflicted;
        asset.price_usd18 = 0;
        assert_eq!(asset_gates(&asset, 10_000_000), Gates::NONE);
    }

    #[test]
    fn staleness_is_measured_at_the_policy_boundary() {
        let asset = tbill(1_000);
        let fresh = asset.price_updated_at + asset.params.max_oracle_age;
        assert!(!asset_gates(&asset, fresh).contains(Gates::ORACLE_STALE));
        assert!(asset_gates(&asset, fresh + 1).contains(Gates::ORACLE_STALE));
        assert!(
            !asset_gates(&asset, 0).contains(Gates::ORACLE_STALE),
            "a future timestamp is not staleness"
        );
    }

    #[test]
    fn decimals_beyond_the_128_bit_unit_are_refused() {
        let mut asset = tbill(1);
        asset.decimals = 39;
        assert_eq!(
            value_asset(&asset),
            Err(RiskError::DecimalsTooLarge { decimals: 39 })
        );
    }

    #[test]
    fn a_haircut_above_bps_is_refused_rather_than_underflowing() {
        let mut asset = tbill(1);
        asset.params.haircut_issuer_bps = 10_001;
        assert_eq!(
            value_asset(&asset),
            Err(RiskError::BpsOutOfRange { value: 10_001 })
        );
    }
}

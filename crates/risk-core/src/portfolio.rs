//! Portfolio evaluation — `spec/accounting.md` §4.6 and §5.
//!
//! This is the number the protocol lends against.

use crate::error::RiskError;
use crate::interest::debt_usd18;
use crate::math::{mul_div, mul_div_wide, BPS, WAD};
use crate::types::{
    AccountInput, AccountStatus, AssetRiskInput, AssetValuation, Gates, SequencerInput, Usd18,
};
use crate::u256::U256;
use crate::valuation::{asset_gates, value_asset};

/// Everything one evaluation produces.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RiskReport {
    /// Per-position valuations, in the order the positions were supplied.
    pub per_asset: Vec<AssetValuation>,
    /// Σ capped recognised value.
    pub total_recognized_usd18: Usd18,
    /// Σ capped × initial LTV. What the account may borrow against, before debt.
    pub borrow_limit_usd18: Usd18,
    /// Σ capped × maintenance LTV. Below this, no new risk.
    pub maintenance_limit_usd18: Usd18,
    /// Σ capped × liquidation LTV. Below this, liquidatable.
    pub liquidation_limit_usd18: Usd18,
    /// Debt reconstructed from scaled principal, rounded up.
    pub debt_usd18: Usd18,
    /// Borrow limit less debt and reservations, floored at zero, and forced to zero whenever the
    /// account is not `NORMAL`.
    pub available_borrow_usd18: Usd18,
    /// `maintenanceLimit × 1e18 ÷ debt`, or [`U256::MAX`] when there is no debt.
    ///
    /// 256 bits because both ends of that range need it: the no-debt sentinel is `2^256 - 1`, and
    /// a finite health factor against a one-wei debt is wider than the money domain. Below `1e18`
    /// the maintenance requirement is breached.
    pub health_factor_wad: U256,
    /// The account's status, after gates and the guardian floor.
    pub status: AccountStatus,
    /// Which inputs were degraded.
    pub gates: Gates,
}

/// Run the whole pipeline.
///
/// `assets` must be **strictly ascending by `assetId`** and the ordering is asserted rather than
/// assumed: sums over truncated per-asset values are order-dependent, so an unordered portfolio
/// silently totals differently from the onchain authority. Sorting the input here instead would
/// hide the caller's bug and produce a number the chain would not agree with.
///
/// # Errors
///
/// [`RiskError::AssetsNotOrdered`] for an unordered portfolio, plus anything
/// [`value_asset`] can refuse.
pub fn evaluate(
    assets: &[AssetRiskInput],
    account: &AccountInput,
    sequencer: &SequencerInput,
    now: u64,
) -> Result<RiskReport, RiskError> {
    let mut gates = Gates::NONE;

    // Sequencer gates are portfolio-wide. An L2 price nobody can arbitrage is not a price, and
    // one published seconds after a restart has not been arbitraged yet.
    if !sequencer.up {
        gates.insert(Gates::SEQUENCER_DOWN);
    } else if now.saturating_sub(sequencer.last_restart_at) < sequencer.grace_period {
        gates.insert(Gates::SEQUENCER_GRACE);
    }

    let mut per_asset: Vec<AssetValuation> = Vec::with_capacity(assets.len());
    let mut raw_total: Usd18 = 0;

    for (index, asset) in assets.iter().enumerate() {
        if index > 0 && asset.asset_id <= assets[index - 1].asset_id {
            return Err(RiskError::AssetsNotOrdered { index });
        }
        let valuation = value_asset(asset)?;
        gates |= asset_gates(asset, now);
        raw_total = raw_total
            .checked_add(valuation.recognized_usd18)
            .ok_or(RiskError::Overflow)?;
        per_asset.push(valuation);
    }

    // §4.6 — one pass against the *uncapped* total. A fixed-point iteration would recognise
    // marginally more and would cost an unbounded loop onchain; this errs toward recognising
    // less, which is the direction the rounding rule points. Deliberate, not an approximation
    // waiting to be "fixed" into a loop.
    let mut total_recognized_usd18: Usd18 = 0;
    let mut borrow_limit_usd18: Usd18 = 0;
    let mut maintenance_limit_usd18: Usd18 = 0;
    let mut liquidation_limit_usd18: Usd18 = 0;

    for (valuation, asset) in per_asset.iter_mut().zip(assets) {
        let params = &asset.params;
        let cap = mul_div(raw_total, u128::from(params.max_concentration_bps), BPS)?;
        valuation.capped_usd18 = valuation.recognized_usd18.min(cap);

        total_recognized_usd18 = add(total_recognized_usd18, valuation.capped_usd18)?;
        borrow_limit_usd18 = add(
            borrow_limit_usd18,
            mul_div(
                valuation.capped_usd18,
                u128::from(params.initial_ltv_bps),
                BPS,
            )?,
        )?;
        maintenance_limit_usd18 = add(
            maintenance_limit_usd18,
            mul_div(
                valuation.capped_usd18,
                u128::from(params.maintenance_ltv_bps),
                BPS,
            )?,
        )?;
        liquidation_limit_usd18 = add(
            liquidation_limit_usd18,
            mul_div(
                valuation.capped_usd18,
                u128::from(params.liquidation_ltv_bps),
                BPS,
            )?,
        )?;
    }

    // §3.1 — debt is reconstructed from scaled principal and rounds up, so rounding can never
    // under-charge a borrower. One definition, shared with the financing path, so a quote and a
    // transaction cannot disagree about what is owed.
    let debt_usd18 = debt_usd18(account.scaled_principal, account.borrow_index)?;

    // §5.1
    let base = if debt_usd18 == 0 || debt_usd18 <= borrow_limit_usd18 {
        AccountStatus::Normal
    } else if debt_usd18 <= maintenance_limit_usd18 {
        AccountStatus::NoNewRisk
    } else if debt_usd18 <= liquidation_limit_usd18 {
        AccountStatus::ReduceOnly
    } else {
        AccountStatus::MarginCall
    };

    let gate_floor = if gates.is_empty() {
        AccountStatus::Normal
    } else {
        AccountStatus::NoNewRisk
    };

    // `max` over the total order is what makes invariant I-07 structural: a degraded input or a
    // guardian action can only move an account further along the order, never back.
    let status = base.max(gate_floor).max(account.status_override);

    let available_borrow_usd18 = if status == AccountStatus::Normal {
        let used = add(debt_usd18, account.reserved_usd18)?;
        borrow_limit_usd18.saturating_sub(used)
    } else {
        0
    };

    let health_factor_wad = if debt_usd18 == 0 {
        U256::MAX
    } else {
        mul_div_wide(maintenance_limit_usd18, WAD, debt_usd18)?
    };

    Ok(RiskReport {
        per_asset,
        total_recognized_usd18,
        borrow_limit_usd18,
        maintenance_limit_usd18,
        liquidation_limit_usd18,
        debt_usd18,
        available_borrow_usd18,
        health_factor_wad,
        status,
        gates,
    })
}

/// Checked addition in the money domain. Summing recognised value is the one place a portfolio
/// large enough to leave the domain could appear, and it must refuse rather than wrap.
fn add(a: Usd18, b: Usd18) -> Result<Usd18, RiskError> {
    a.checked_add(b).ok_or(RiskError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::evaluate;
    use crate::error::RiskError;
    use crate::math::{USD, WAD};
    use crate::types::{
        AccountInput, AccountStatus, AssetId, AssetRiskInput, AssetStatus, ExitTier, Gates,
        PassportStatus, RiskParameters, SequencerInput,
    };
    use crate::u256::U256;

    const NOW: u64 = 1_750_000_000;

    fn asset(last_byte: u8, quantity_tokens: u128) -> AssetRiskInput {
        let mut id = [0u8; 32];
        id[31] = last_byte;
        AssetRiskInput {
            asset_id: AssetId::new(id),
            quantity: quantity_tokens * WAD,
            decimals: 18,
            price_usd18: USD,
            price_updated_at: NOW,
            passport_committed_at: NOW,
            passport_status: PassportStatus::Active,
            redemption_supported: false,
            redemption_floor_bps: 0,
            asset_status: AssetStatus::Active,
            params: RiskParameters {
                initial_ltv_bps: 5_000,
                maintenance_ltv_bps: 6_000,
                liquidation_ltv_bps: 7_000,
                max_concentration_bps: 10_000,
                haircut_market_bps: 0,
                haircut_liquidity_bps: 0,
                haircut_issuer_bps: 0,
                haircut_settlement_bps: 0,
                haircut_crosschain_bps: 0,
                max_oracle_age: 3_600,
                max_passport_age: 3_600,
            },
            exit_curve: vec![ExitTier {
                threshold_usd18: u128::MAX,
                recovery_bps: 10_000,
            }],
        }
    }

    fn account(scaled: u128) -> AccountInput {
        AccountInput {
            scaled_principal: scaled,
            borrow_index: WAD,
            reserved_usd18: 0,
            status_override: AccountStatus::Normal,
        }
    }

    fn up() -> SequencerInput {
        SequencerInput::up_since(NOW - 86_400)
    }

    #[test]
    fn unordered_assets_are_refused_rather_than_sorted() {
        let assets = [asset(2, 100), asset(1, 100)];
        assert_eq!(
            evaluate(&assets, &account(0), &up(), NOW),
            Err(RiskError::AssetsNotOrdered { index: 1 })
        );
        let duplicated = [asset(1, 100), asset(1, 100)];
        assert_eq!(
            evaluate(&duplicated, &account(0), &up(), NOW),
            Err(RiskError::AssetsNotOrdered { index: 1 })
        );
    }

    #[test]
    fn concentration_is_capped_against_the_uncapped_total() {
        let mut small = asset(1, 100);
        small.params.max_concentration_bps = 6_000;
        let big = asset(2, 900);

        let report = evaluate(&[small, big], &account(0), &up(), NOW).unwrap();
        // Uncapped total is 1,000. The 60% cap is 600, above the 100 the small leg contributes,
        // so nothing binds — the cap is a share of the whole, not of the other leg.
        assert_eq!(report.per_asset[0].capped_usd18, 100 * USD);
        assert_eq!(report.total_recognized_usd18, 1_000 * USD);
    }

    #[test]
    fn a_cap_binds_on_the_dominant_leg() {
        let small = asset(1, 100);
        let mut big = asset(2, 900);
        big.params.max_concentration_bps = 6_000;

        let report = evaluate(&[small, big], &account(0), &up(), NOW).unwrap();
        assert_eq!(report.per_asset[1].recognized_usd18, 900 * USD);
        assert_eq!(report.per_asset[1].capped_usd18, 600 * USD);
        assert_eq!(report.total_recognized_usd18, 700 * USD);
    }

    #[test]
    fn status_bands_follow_the_limits() {
        // 1,000 of collateral: borrow 500, maintenance 600, liquidation 700.
        let held = [asset(1, 1_000)];
        let status_at = |debt: u128| evaluate(&held, &account(debt), &up(), NOW).unwrap().status;
        assert_eq!(status_at(0), AccountStatus::Normal);
        assert_eq!(status_at(500 * USD), AccountStatus::Normal);
        assert_eq!(status_at(500 * USD + 1), AccountStatus::NoNewRisk);
        assert_eq!(status_at(600 * USD), AccountStatus::NoNewRisk);
        assert_eq!(status_at(600 * USD + 1), AccountStatus::ReduceOnly);
        assert_eq!(status_at(700 * USD), AccountStatus::ReduceOnly);
        assert_eq!(status_at(700 * USD + 1), AccountStatus::MarginCall);
    }

    #[test]
    fn any_gate_floors_the_status_and_zeroes_capacity() {
        let mut stale = asset(1, 1_000);
        stale.price_updated_at = NOW - 3_601;

        let report = evaluate(&[stale], &account(0), &up(), NOW).unwrap();
        assert!(report.gates.contains(Gates::ORACLE_STALE));
        assert_eq!(report.status, AccountStatus::NoNewRisk);
        assert_eq!(report.available_borrow_usd18, 0);
        // The collateral is still measured. Degradation restricts new risk; it does not
        // confiscate a position or block a repayment.
        assert_eq!(report.total_recognized_usd18, 1_000 * USD);
        assert_eq!(report.borrow_limit_usd18, 500 * USD);
    }

    #[test]
    fn a_guardian_override_is_a_floor_not_a_ceiling() {
        let held = [asset(1, 1_000)];
        let mut acct = account(0);
        acct.status_override = AccountStatus::ReduceOnly;
        let restricted = evaluate(&held, &acct, &up(), NOW).unwrap();
        assert_eq!(restricted.status, AccountStatus::ReduceOnly);
        assert_eq!(restricted.available_borrow_usd18, 0);

        // An override *below* the computed status cannot relax it.
        let mut healthier = account(900 * USD);
        healthier.status_override = AccountStatus::Normal;
        let report = evaluate(&held, &healthier, &up(), NOW).unwrap();
        assert_eq!(report.status, AccountStatus::MarginCall);
    }

    #[test]
    fn reservations_reduce_capacity_without_touching_debt() {
        let held = [asset(1, 1_000)];
        let mut acct = account(100 * USD);
        acct.reserved_usd18 = 50 * USD;
        let report = evaluate(&held, &acct, &up(), NOW).unwrap();
        assert_eq!(report.debt_usd18, 100 * USD);
        assert_eq!(report.available_borrow_usd18, 350 * USD);
    }

    #[test]
    fn capacity_floors_at_zero_rather_than_underflowing() {
        let held = [asset(1, 1_000)];
        let mut acct = account(400 * USD);
        acct.reserved_usd18 = u128::MAX / 2;
        let report = evaluate(&held, &acct, &up(), NOW).unwrap();
        assert_eq!(report.available_borrow_usd18, 0);
    }

    #[test]
    fn sequencer_grace_is_a_gate_only_while_it_lasts() {
        let held = [asset(1, 1_000)];
        let recent = SequencerInput {
            up: true,
            last_restart_at: NOW - 600,
            grace_period: 3_600,
        };
        let report = evaluate(&held, &account(0), &recent, NOW).unwrap();
        assert!(report.gates.contains(Gates::SEQUENCER_GRACE));

        let expired = SequencerInput {
            up: true,
            last_restart_at: NOW - 3_600,
            grace_period: 3_600,
        };
        assert!(evaluate(&held, &account(0), &expired, NOW)
            .unwrap()
            .gates
            .is_empty());

        let down = SequencerInput {
            up: false,
            last_restart_at: NOW - 600,
            grace_period: 3_600,
        };
        let report = evaluate(&held, &account(0), &down, NOW).unwrap();
        assert!(report.gates.contains(Gates::SEQUENCER_DOWN));
        assert!(
            !report.gates.contains(Gates::SEQUENCER_GRACE),
            "down and in grace are one condition, not two"
        );
    }

    #[test]
    fn health_is_unbounded_only_when_there_is_no_debt() {
        let held = [asset(1, 1_000)];
        assert!(evaluate(&held, &account(0), &up(), NOW)
            .unwrap()
            .health_factor_wad
            .is_max());

        let one_wei = evaluate(&held, &account(1), &up(), NOW)
            .unwrap()
            .health_factor_wad;
        assert!(!one_wei.is_max());
        assert!(
            one_wei > U256::from_u128(u128::MAX),
            "a one-wei debt against 600 USD of maintenance limit exceeds the money domain"
        );

        let at_limit = evaluate(&held, &account(600 * USD), &up(), NOW)
            .unwrap()
            .health_factor_wad;
        assert_eq!(at_limit, U256::from_u128(WAD), "exactly 1.0 at the limit");
    }

    #[test]
    fn an_empty_portfolio_evaluates_to_zero_everywhere() {
        let report = evaluate(&[], &account(0), &up(), NOW).unwrap();
        assert_eq!(report.per_asset.len(), 0);
        assert_eq!(report.total_recognized_usd18, 0);
        assert_eq!(report.borrow_limit_usd18, 0);
        assert_eq!(report.available_borrow_usd18, 0);
        assert_eq!(report.status, AccountStatus::Normal);
        assert!(report.gates.is_empty());
        assert!(report.health_factor_wad.is_max());
    }
}

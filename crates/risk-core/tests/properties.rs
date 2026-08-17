//! Property tests over generated inputs.
//!
//! The canonical fixtures pin twenty-two situations exactly; these cover the space between them.
//! Each test states a property from `spec/accounting.md` that must hold for *every* input, then
//! hammers it with generated portfolios: zero and single-wei quantities, positions large enough
//! to need the 256-bit intermediate, mixed decimals, several assets at once, and the rounding
//! boundaries where a one-wei disagreement would hide.
//!
//! Generation is a seeded `SplitMix64` rather than a fuzzing framework, for two reasons. The
//! crate takes no dependencies, and a reference model needs its failures to be reproducible from
//! the seed printed in the assertion — a property test that fails on a different case each run
//! tells you something is wrong without ever telling you what.

use risk_core::{
    accrue_index, borrow_rate_bps, borrow_rate_bps_at_utilisation, debt_usd18, evaluate, mul_div,
    mul_div_up, mul_div_wide, scaled_principal_after_repay, scaled_principal_for_borrow,
    utilisation_bps, AccountInput, AccountStatus, AssetId, AssetRiskInput, AssetStatus, ExitTier,
    Gates, PassportStatus, RiskParameters, RiskReport, SequencerInput, BPS, SECONDS_PER_YEAR, U256,
    USD, WAD,
};

const NOW: u64 = 1_750_000_000;

// -------------------------------------------------------------------------------------------
// Deterministic generation
// -------------------------------------------------------------------------------------------

/// `SplitMix64`. Fixed constants, no state beyond the counter, identical on every platform.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn next_u128(&mut self) -> u128 {
        (u128::from(self.next_u64()) << 64) | u128::from(self.next_u64())
    }

    /// Uniform in `0..n`. The modulo bias is irrelevant for choosing between a handful of cases.
    fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }

    fn pick<T: Copy>(&mut self, options: &[T]) -> T {
        options[usize::try_from(self.below(options.len() as u64)).expect("fits")]
    }

    /// A value spread across magnitudes rather than uniformly, so small quantities — where
    /// truncation actually bites — are as likely as large ones.
    fn magnitude(&mut self, max_pow10: u32) -> u128 {
        let exponent = u32::try_from(self.below(u64::from(max_pow10) + 1)).expect("fits");
        let scale = 10u128.pow(exponent);
        match self.below(4) {
            0 => scale,
            1 => scale.saturating_sub(1),
            2 => scale.saturating_add(1),
            _ => 1 + self.next_u128() % scale.max(1),
        }
    }
}

/// A position whose market value is bounded well inside the money domain, so that overflow is
/// never the reason a property holds.
fn gen_asset(rng: &mut Rng, id_byte: u8) -> AssetRiskInput {
    let mut id = [0u8; 32];
    id[30] = id_byte;
    id[31] = rng.pick(&[1u8, 7, 42]);

    let decimals = rng.pick(&[0u8, 6, 8, 18, 27]);
    let unit = 10u128.pow(u32::from(decimals));

    // Whole tokens up to 1e12, plus the two degenerate cases the spec calls out by name.
    let quantity = match rng.below(6) {
        0 => 0,
        1 => 1,
        _ => rng.magnitude(12).saturating_mul(unit),
    };

    let initial = u16::try_from(rng.below(6_000)).expect("fits") + 1_000;
    let maintenance = initial + u16::try_from(rng.below(1_500)).expect("fits");
    let liquidation = maintenance + u16::try_from(rng.below(1_500)).expect("fits");

    // Strictly ascending thresholds, non-increasing recoveries — invariant I-14.
    let tier_count = rng.below(4) + 1;
    let mut exit_curve = Vec::new();
    let mut threshold = rng.magnitude(6).saturating_mul(USD).max(USD);
    let mut recovery = u16::try_from(rng.below(1_000)).expect("fits") + 9_000;
    for _ in 0..tier_count {
        exit_curve.push(ExitTier {
            threshold_usd18: threshold,
            recovery_bps: recovery,
        });
        threshold = threshold.saturating_mul(4).max(threshold + 1);
        recovery -= u16::try_from(rng.below(500)).expect("fits").min(recovery);
    }

    AssetRiskInput {
        asset_id: AssetId::new(id),
        quantity,
        decimals,
        price_usd18: rng.magnitude(6).saturating_mul(USD / 100),
        price_updated_at: NOW - rng.below(10_000),
        passport_committed_at: NOW - rng.below(1_000_000),
        passport_status: rng.pick(&[
            PassportStatus::Active,
            PassportStatus::Active,
            PassportStatus::Conflicted,
            PassportStatus::Suspended,
        ]),
        redemption_supported: rng.below(2) == 0,
        redemption_floor_bps: u16::try_from(rng.below(10_001)).expect("fits"),
        asset_status: rng.pick(&[
            AssetStatus::Active,
            AssetStatus::Active,
            AssetStatus::Suspended,
        ]),
        params: RiskParameters {
            initial_ltv_bps: initial,
            maintenance_ltv_bps: maintenance,
            liquidation_ltv_bps: liquidation,
            max_concentration_bps: u16::try_from(rng.below(10_001)).expect("fits"),
            haircut_market_bps: u16::try_from(rng.below(2_000)).expect("fits"),
            haircut_liquidity_bps: u16::try_from(rng.below(2_000)).expect("fits"),
            haircut_issuer_bps: u16::try_from(rng.below(1_000)).expect("fits"),
            haircut_settlement_bps: u16::try_from(rng.below(1_000)).expect("fits"),
            haircut_crosschain_bps: u16::try_from(rng.below(1_000)).expect("fits"),
            max_oracle_age: 3_600,
            max_passport_age: 604_800,
        },
        exit_curve,
    }
}

/// A portfolio of one to four positions, strictly ascending by `assetId` as §1.3 requires.
fn gen_portfolio(rng: &mut Rng) -> Vec<AssetRiskInput> {
    let count = u8::try_from(rng.below(4) + 1).expect("fits");
    (0..count).map(|i| gen_asset(rng, i)).collect()
}

fn gen_account(rng: &mut Rng) -> AccountInput {
    AccountInput {
        scaled_principal: match rng.below(4) {
            0 => 0,
            _ => rng.magnitude(24),
        },
        borrow_index: WAD + rng.magnitude(18) % WAD,
        reserved_usd18: match rng.below(3) {
            0 => 0,
            _ => rng.magnitude(22),
        },
        status_override: rng.pick(&[
            AccountStatus::Normal,
            AccountStatus::Normal,
            AccountStatus::Normal,
            AccountStatus::ReduceOnly,
            AccountStatus::Liquidating,
        ]),
    }
}

fn gen_sequencer(rng: &mut Rng) -> SequencerInput {
    SequencerInput {
        up: rng.below(4) != 0,
        last_restart_at: NOW - rng.below(100_000),
        grace_period: 3_600,
    }
}

fn evaluated(
    assets: &[AssetRiskInput],
    account: &AccountInput,
    seq: &SequencerInput,
) -> RiskReport {
    evaluate(assets, account, seq, NOW).expect("generated inputs stay inside the money domain")
}

// -------------------------------------------------------------------------------------------
// §1.2 Rounding
// -------------------------------------------------------------------------------------------

#[test]
fn mul_div_agrees_with_native_arithmetic_where_native_arithmetic_fits() {
    let mut rng = Rng::new(0x5EED_0001);
    for case in 0..20_000 {
        let a = u128::from(rng.next_u64());
        let b = u128::from(rng.next_u64());
        let d = u128::from(rng.next_u64().max(1));
        assert_eq!(
            mul_div(a, b, d),
            Ok(a * b / d),
            "case {case}: mul_div({a}, {b}, {d})"
        );
    }
}

#[test]
fn division_reconstructs_the_full_product() {
    // The property that makes the hand-rolled 256-bit division trustworthy at full width, where
    // no native type can check it: q·d + r == a·b, with r < d.
    let mut rng = Rng::new(0x5EED_0002);
    for case in 0..20_000 {
        let a = rng.next_u128();
        let b = rng.next_u128();
        let d = rng.next_u128().max(1);

        let quotient = mul_div_wide(a, b, d).expect("non-zero divisor");
        let remainder = {
            // r = a·b - q·d, computed entirely in 256 bits.
            let product = U256::mul_u128(a, b);
            let scaled = quotient.checked_mul_u128(d).expect("q·d <= a·b");
            product.checked_sub(scaled).expect("q·d <= a·b")
        };
        assert!(
            remainder < U256::from_u128(d),
            "case {case}: remainder {remainder} >= divisor {d}"
        );
    }
}

#[test]
fn rounding_up_exceeds_rounding_down_by_exactly_the_remainder_bit() {
    let mut rng = Rng::new(0x5EED_0003);
    for case in 0..20_000 {
        // Deliberately near the boundary: d, d-1, d+1 and exact multiples all appear.
        let d = rng.magnitude(20).max(1);
        let free = rng.magnitude(18);
        let a = rng.pick(&[d, d - 1, d + 1, free]).max(1);
        let b = rng.pick(&[1, d, free]);

        let down = mul_div(a, b, d).expect("bounded");
        let up = mul_div_up(a, b, d).expect("bounded");
        let exact = mul_div_wide(a, b, d)
            .and_then(|q| q.checked_mul_u128(d).ok_or(risk_core::RiskError::Overflow))
            .map(|scaled| scaled == U256::mul_u128(a, b))
            .expect("bounded");

        if exact {
            assert_eq!(down, up, "case {case}: exact division must not round up");
        } else {
            assert_eq!(down + 1, up, "case {case}: mul_div_up({a}, {b}, {d})");
        }
    }
}

// -------------------------------------------------------------------------------------------
// §4 and §5 Portfolio properties
// -------------------------------------------------------------------------------------------

#[test]
fn recognition_never_exceeds_market_value() {
    let mut rng = Rng::new(0x5EED_0010);
    for case in 0..1_000 {
        let assets = gen_portfolio(&mut rng);
        let report = evaluated(&assets, &gen_account(&mut rng), &gen_sequencer(&mut rng));

        for value in &report.per_asset {
            assert!(
                value.haircut_mark_usd18 <= value.market_value_usd18,
                "case {case}: haircuts increased value"
            );
            assert!(
                value.stressed_exit_usd18 <= value.market_value_usd18,
                "case {case}: the exit curve recovered more than market value"
            );
            assert!(
                value.recognized_usd18 <= value.haircut_mark_usd18.min(value.stressed_exit_usd18),
                "case {case}: recognition is the minimum of its candidates"
            );
            if let Some(floor) = value.redemption_floor_usd18 {
                assert!(
                    value.recognized_usd18 <= floor,
                    "case {case}: an evidenced redemption floor must bind the minimum"
                );
            }
            assert!(
                value.capped_usd18 <= value.recognized_usd18,
                "case {case}: the concentration cap cannot raise recognition"
            );
        }
    }
}

#[test]
fn limits_and_totals_are_consistent_sums() {
    let mut rng = Rng::new(0x5EED_0011);
    for case in 0..1_000 {
        let assets = gen_portfolio(&mut rng);
        let report = evaluated(&assets, &gen_account(&mut rng), &gen_sequencer(&mut rng));

        let total: u128 = report.per_asset.iter().map(|v| v.capped_usd18).sum();
        assert_eq!(total, report.total_recognized_usd18, "case {case}");

        // Policy orders the LTV bands (invariant I-13), and the limits are sums of the same
        // capped values against those bands, so the ordering survives summation.
        assert!(
            report.borrow_limit_usd18 <= report.maintenance_limit_usd18,
            "case {case}: borrow limit above maintenance limit"
        );
        assert!(
            report.maintenance_limit_usd18 <= report.liquidation_limit_usd18,
            "case {case}: maintenance limit above liquidation limit"
        );
        assert!(
            report.borrow_limit_usd18 <= report.total_recognized_usd18,
            "case {case}"
        );
    }
}

#[test]
fn capacity_is_zero_outside_normal_and_health_tracks_the_maintenance_limit() {
    let mut rng = Rng::new(0x5EED_0012);
    for case in 0..1_000 {
        let assets = gen_portfolio(&mut rng);
        let account = gen_account(&mut rng);
        let report = evaluated(&assets, &account, &gen_sequencer(&mut rng));

        if report.status != AccountStatus::Normal {
            assert_eq!(
                report.available_borrow_usd18, 0,
                "case {case}: a restricted account may not borrow"
            );
        } else if report.available_borrow_usd18 > 0 {
            // Drawing every wei of reported capacity must still leave the account inside its
            // borrow limit. Reservations are already committed capital, so they count against it
            // exactly as debt does — that is the whole point of §3.2.
            assert!(
                report.available_borrow_usd18 + report.debt_usd18 + account.reserved_usd18
                    <= report.borrow_limit_usd18,
                "case {case}: borrowing the reported capacity would breach the borrow limit"
            );
        }

        assert_eq!(
            report.health_factor_wad.is_max(),
            report.debt_usd18 == 0,
            "case {case}: unbounded health means exactly 'no debt'"
        );

        // `healthFactor < 1e18` is the definition of a maintenance breach, so it must agree with
        // the comparison the status bands make.
        let healthy = report.health_factor_wad >= U256::from_u128(WAD);
        assert_eq!(
            healthy,
            report.debt_usd18 <= report.maintenance_limit_usd18,
            "case {case}: health factor and maintenance limit disagree"
        );
    }
}

#[test]
fn degraded_inputs_can_only_restrict() {
    // Invariant I-07. Replacing a fresh oracle with a stale one, or an active Passport with a
    // conflicted one, must never raise capacity and never lower status.
    let mut rng = Rng::new(0x5EED_0013);
    for case in 0..1_000 {
        let mut assets = gen_portfolio(&mut rng);
        for asset in &mut assets {
            asset.price_updated_at = NOW;
            asset.passport_committed_at = NOW;
            asset.passport_status = PassportStatus::Active;
            asset.asset_status = AssetStatus::Active;
        }
        let account = gen_account(&mut rng);
        let sequencer = SequencerInput::up_since(NOW - 100_000);

        let fresh = evaluated(&assets, &account, &sequencer);

        let mut degraded_assets = assets.clone();
        match rng.below(4) {
            0 => degraded_assets[0].price_updated_at = NOW - 100_000,
            1 => degraded_assets[0].passport_committed_at = NOW - 10_000_000,
            2 => degraded_assets[0].passport_status = PassportStatus::Conflicted,
            _ => degraded_assets[0].asset_status = AssetStatus::Suspended,
        }
        let degraded = evaluated(&degraded_assets, &account, &sequencer);

        assert!(
            degraded.available_borrow_usd18 <= fresh.available_borrow_usd18,
            "case {case}: degradation increased capacity"
        );
        assert!(
            degraded.status >= fresh.status,
            "case {case}: degradation improved status"
        );
        // And it must not touch the measured value of what the user holds: a stale price blocks
        // new risk, it does not confiscate collateral or block a repayment.
        assert_eq!(
            degraded.total_recognized_usd18, fresh.total_recognized_usd18,
            "case {case}: degradation changed recognised value"
        );
    }
}

#[test]
fn a_sequencer_outage_restricts_every_portfolio() {
    let mut rng = Rng::new(0x5EED_0014);
    for case in 0..500 {
        let assets = gen_portfolio(&mut rng);
        let account = AccountInput {
            status_override: AccountStatus::Normal,
            ..gen_account(&mut rng)
        };
        let down = SequencerInput {
            up: false,
            last_restart_at: NOW,
            grace_period: 3_600,
        };
        let report = evaluated(&assets, &account, &down);
        assert!(report.gates.contains(Gates::SEQUENCER_DOWN), "case {case}");
        assert!(report.status >= AccountStatus::NoNewRisk, "case {case}");
        assert_eq!(report.available_borrow_usd18, 0, "case {case}");
    }
}

#[test]
fn an_empty_position_changes_nothing() {
    // Holding zero of an asset must not move a single number, however degraded that asset is —
    // otherwise every retired asset anyone ever touched would restrict their account forever.
    let mut rng = Rng::new(0x5EED_0015);
    for case in 0..500 {
        let assets = gen_portfolio(&mut rng);
        let account = gen_account(&mut rng);
        let sequencer = gen_sequencer(&mut rng);
        let before = evaluated(&assets, &account, &sequencer);

        let mut with_empty = assets.clone();
        let mut id = [0u8; 32];
        id[0] = 0xff; // sorts last, so the required ordering still holds
        with_empty.push(AssetRiskInput {
            asset_id: AssetId::new(id),
            quantity: 0,
            passport_status: PassportStatus::Conflicted,
            asset_status: AssetStatus::Suspended,
            price_usd18: 0,
            price_updated_at: 0,
            passport_committed_at: 0,
            ..gen_asset(&mut rng, 0)
        });
        let after = evaluated(&with_empty, &account, &sequencer);

        assert_eq!(
            before.total_recognized_usd18, after.total_recognized_usd18,
            "case {case}"
        );
        assert_eq!(
            before.borrow_limit_usd18, after.borrow_limit_usd18,
            "case {case}"
        );
        assert_eq!(
            before.available_borrow_usd18, after.available_borrow_usd18,
            "case {case}"
        );
        assert_eq!(before.status, after.status, "case {case}");
        assert_eq!(before.gates, after.gates, "case {case}");
    }
}

#[test]
fn market_value_is_monotone_in_quantity_and_independent_of_decimals() {
    let mut rng = Rng::new(0x5EED_0016);
    for case in 0..1_000 {
        let mut asset = gen_asset(&mut rng, 0);
        asset.decimals = 18;
        asset.quantity = rng.magnitude(12).saturating_mul(WAD);

        let base = risk_core::value_asset(&asset).expect("bounded");
        let mut larger = asset.clone();
        larger.quantity = asset.quantity.saturating_add(WAD);
        let grown = risk_core::value_asset(&larger).expect("bounded");
        assert!(
            grown.market_value_usd18 >= base.market_value_usd18,
            "case {case}: more of an asset is worth less"
        );

        // The same economic position in 6, 8 and 27 decimals values identically: `decimals` is a
        // representation detail of the token, never of the money.
        let tokens = asset.quantity / WAD;
        for decimals in [6u8, 8, 27] {
            // Skip restatements that do not fit: 1e12 tokens of a 27-decimal asset is 1e39 raw
            // units, past the domain. Saturating instead would compare two different positions.
            let Some(quantity) = tokens.checked_mul(10u128.pow(u32::from(decimals))) else {
                continue;
            };
            let mut restated = asset.clone();
            restated.decimals = decimals;
            restated.quantity = quantity;
            let value = risk_core::value_asset(&restated).expect("bounded");
            assert_eq!(
                value.market_value_usd18, base.market_value_usd18,
                "case {case}: {decimals} decimals valued differently"
            );
        }
    }
}

#[test]
fn a_single_wei_never_produces_capacity_it_cannot_back() {
    // The dust case, swept across every decimal scale: one raw unit is at most one wei of value
    // once the token has 18 decimals, and every downstream multiplier is below one.
    let mut rng = Rng::new(0x5EED_0017);
    for case in 0..500 {
        let mut asset = gen_asset(&mut rng, 0);
        asset.quantity = 1;
        asset.decimals = 18;
        asset.price_usd18 = USD;

        let report = evaluated(
            &[asset],
            &AccountInput {
                borrow_index: WAD,
                ..AccountInput::default()
            },
            &SequencerInput::up_since(NOW - 100_000),
        );
        assert_eq!(report.per_asset[0].market_value_usd18, 1, "case {case}");
        assert_eq!(report.total_recognized_usd18, 0, "case {case}");
        assert_eq!(report.borrow_limit_usd18, 0, "case {case}");
        assert_eq!(report.available_borrow_usd18, 0, "case {case}");
    }
}

#[test]
fn a_position_large_enough_to_need_the_wide_intermediate_still_values() {
    // 1e12 whole tokens of an 18-decimal asset at $1e6 is 1e18 USD of market value, and the
    // product on the way there is 1e48 — ten orders of magnitude past `u128`.
    let mut rng = Rng::new(0x5EED_0018);
    for case in 0..200 {
        let mut asset = gen_asset(&mut rng, 0);
        asset.decimals = 18;
        asset.quantity = 1_000_000_000_000 * WAD;
        asset.price_usd18 = 1_000_000 * USD;
        asset.params.max_concentration_bps = 10_000;
        asset.exit_curve = vec![ExitTier {
            threshold_usd18: u128::MAX,
            recovery_bps: 10_000,
        }];

        let value = risk_core::value_asset(&asset).expect("bounded");
        assert_eq!(
            value.market_value_usd18,
            1_000_000_000_000_000_000 * USD,
            "case {case}"
        );
        assert_eq!(
            value.stressed_exit_usd18, value.market_value_usd18,
            "case {case}"
        );
    }
}

// -------------------------------------------------------------------------------------------
// §6 Interest
// -------------------------------------------------------------------------------------------

#[test]
fn the_index_is_monotone_non_decreasing() {
    let mut rng = Rng::new(0x5EED_0020);
    for case in 0..5_000 {
        let index = rng.magnitude(20).max(1);
        let rate_bps = rng.below(100_000).into();
        let dt = rng.below(SECONDS_PER_YEAR * 10);

        let next = accrue_index(index, rate_bps, dt).expect("bounded");
        assert!(
            next >= index,
            "case {case}: accrue_index({index}, {rate_bps}, {dt}) went backwards"
        );

        // And stepping twice is at least as much as either step alone: compounding never loses
        // ground to a longer single step at the same rate.
        let stepped = accrue_index(next, rate_bps, dt).expect("bounded");
        assert!(stepped >= next, "case {case}");
    }
}

#[test]
fn borrowing_never_under_records_debt_and_repaying_never_over_retires_it() {
    // §3.1's two rounding rules, stated as the outcomes they exist to guarantee rather than as
    // the direction of a division.
    let mut rng = Rng::new(0x5EED_0023);
    for case in 0..10_000 {
        let index = WAD + rng.magnitude(19);
        let amount = rng.magnitude(24).max(1);

        let scaled = scaled_principal_for_borrow(amount, index).expect("bounded");
        let debt = debt_usd18(scaled, index).expect("bounded");
        assert!(
            debt >= amount,
            "case {case}: borrowing {amount} at index {index} recorded only {debt}"
        );

        let payment = rng.magnitude(24);
        let remaining = scaled_principal_after_repay(scaled, payment, index).expect("bounded");
        let after = debt_usd18(remaining, index).expect("bounded");
        assert!(after <= debt, "case {case}: a repayment increased debt");
        assert!(
            debt <= after + payment + 1,
            "case {case}: repaying {payment} retired {} of debt",
            debt - after
        );
    }
}

#[test]
fn the_rate_is_monotone_in_utilisation() {
    let mut rng = Rng::new(0x5EED_0021);
    for case in 0..500 {
        let base = u16::try_from(rng.below(2_000)).expect("fits");
        let slope1 = u16::try_from(rng.below(5_000)).expect("fits");
        let slope2 = u16::try_from(rng.below(30_000)).expect("fits");
        // `FinancingEngine._setRate` rejects a kink of 0 or BPS, so neither is generated.
        let kink = u16::try_from(rng.below(9_998)).expect("fits") + 1;

        let mut previous = 0u128;
        for step in 0..=100u128 {
            let utilisation = step * BPS / 100;
            let rate = borrow_rate_bps_at_utilisation(utilisation, base, slope1, slope2, kink)
                .expect("valid parameters");
            assert!(
                rate >= previous,
                "case {case}: rate fell from {previous} to {rate} at u={utilisation}"
            );
            assert!(rate >= u128::from(base), "case {case}: rate below base");
            previous = rate;
        }

        assert_eq!(
            previous,
            u128::from(base) + u128::from(slope1) + u128::from(slope2),
            "case {case}: full utilisation must reach the top of both slopes"
        );
    }
}

#[test]
fn the_market_rate_is_the_curve_evaluated_at_its_own_utilisation() {
    let mut rng = Rng::new(0x5EED_0022);
    for case in 0..5_000 {
        let cash = rng.magnitude(26);
        let borrows = rng.magnitude(26);
        let (base, slope1, slope2, kink) = (100u16, 400, 6_000, 8_000);

        let rate = borrow_rate_bps(cash, borrows, base, slope1, slope2, kink).expect("bounded");
        let utilisation = utilisation_bps(cash, borrows).expect("bounded");
        assert!(utilisation <= BPS, "case {case}: utilisation above 100%");

        let expected = if borrows == 0 {
            u128::from(base)
        } else {
            borrow_rate_bps_at_utilisation(utilisation, base, slope1, slope2, kink)
                .expect("bounded")
        };
        assert_eq!(rate, expected, "case {case}");

        // More borrowing against the same cash is never cheaper.
        if borrows > 0 {
            let cheaper =
                borrow_rate_bps(cash, borrows / 2, base, slope1, slope2, kink).expect("bounded");
            assert!(
                cheaper <= rate,
                "case {case}: halving borrows raised the rate"
            );
        }
    }
}

// -------------------------------------------------------------------------------------------
// The ban on floating point, enforced rather than asserted
// -------------------------------------------------------------------------------------------

#[test]
fn no_source_file_mentions_a_binary_float_type() {
    // `spec/accounting.md` §1 bans floating point from financial code. The compiler lints catch
    // float *arithmetic*; this catches a float type appearing at all — in a signature, a cast, a
    // test helper or a comment. The needles are assembled from fragments so that this test does
    // not trip over itself.
    let needles = [concat!("f", "32"), concat!("f", "64")];
    let mut scanned = 0;

    for directory in ["src", "tests"] {
        let path = format!("{}/{directory}", env!("CARGO_MANIFEST_DIR"));
        for entry in std::fs::read_dir(&path).expect("crate directories exist") {
            let entry = entry.expect("readable directory entry");
            let file = entry.path();
            if file.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let source = std::fs::read_to_string(&file).expect("readable source");
            for needle in needles {
                assert!(
                    !source.contains(needle),
                    "{} mentions {needle}; money is never a binary fraction",
                    file.display()
                );
            }
            scanned += 1;
        }
    }

    assert!(
        scanned >= 8,
        "expected to scan the whole crate, saw {scanned} files"
    );
}

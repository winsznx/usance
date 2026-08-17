//! Invariant `D-01`, Rust side.
//!
//! `fixtures/canonical/risk-scenarios.json` is frozen. It is generated from `spec/accounting.md`
//! by `scripts/gen_fixtures.py`, and the Solidity authority, the TypeScript preview library and
//! this reference model must reproduce every value in it exactly. A one-wei disagreement is a
//! failing build, not a rounding difference: the entire point of freezing rounding in the spec is
//! that there is no such thing as an acceptable one-wei disagreement between implementations.
//!
//! If this crate and the fixture disagree, this crate is wrong. The fixture is not edited to
//! match — that is what "frozen" means, and a conformance suite that can be argued with is a
//! conformance suite that will be.
//!
//! Every per-asset intermediate is compared, not just the totals. The intermediates are what the
//! product shows a user when it explains why recognised value is below market value, and two
//! implementations can agree on a total while disagreeing about which constraint produced it.
//!
//! The JSON reader below is hand-written for the same reason the arithmetic is: this crate has no
//! dependencies. It is deliberately strict — it refuses a number containing `.`, `e` or `E` —
//! which makes "the canonical fixtures contain no floating point" a mechanical property of the
//! test run rather than a claim in a comment.

use std::collections::BTreeMap;

use risk_core::{
    evaluate, AccountInput, AccountStatus, AssetId, AssetRiskInput, AssetStatus, AssetValuation,
    ExitTier, PassportStatus, RiskParameters, RiskReport, SequencerInput, U256,
};

/// Repo-relative at build time; `CARGO_MANIFEST_DIR` keeps a developer's absolute path out of the
/// source while still working from any working directory.
const CANONICAL_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/canonical/risk-scenarios.json"
);

/// Environment override, so the same harness can be pointed at a generated scenario set and used
/// as a differential oracle against the Python spec transcription — which is the job
/// `spec/accounting.md` gives this crate.
///
/// It cannot quietly turn conformance into a no-op:
/// `fixture_contains_exactly_the_scenarios_under_test` pins the canonical id list, so a
/// run against anything else fails that test rather than passing silently.
const FIXTURE_OVERRIDE_VAR: &str = "USANCE_RISK_FIXTURE";

// -------------------------------------------------------------------------------------------
// A strict, minimal JSON reader
// -------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum Json {
    Null,
    Bool(bool),
    /// Every number in the fixtures is an integer by construction; see the module comment.
    Int(i128),
    Str(String),
    Array(Vec<Json>),
    Object(BTreeMap<String, Json>),
}

impl Json {
    fn parse(text: &str) -> Result<Self, String> {
        let mut parser = Parser {
            bytes: text.as_bytes(),
            pos: 0,
        };
        parser.skip_whitespace();
        let value = parser.value()?;
        parser.skip_whitespace();
        if parser.pos != parser.bytes.len() {
            return Err(format!("trailing input at byte {}", parser.pos));
        }
        Ok(value)
    }

    fn get(&self, key: &str) -> &Self {
        self.opt(key)
            .unwrap_or_else(|| panic!("fixture is missing the key {key:?}"))
    }

    fn opt(&self, key: &str) -> Option<&Self> {
        match self {
            Self::Object(map) => map.get(key),
            other => panic!("expected an object to read {key:?} from, found {other:?}"),
        }
    }

    fn items(&self) -> &[Self] {
        match self {
            Self::Array(items) => items,
            other => panic!("expected an array, found {other:?}"),
        }
    }

    fn text(&self) -> &str {
        match self {
            Self::Str(s) => s,
            other => panic!("expected a string, found {other:?}"),
        }
    }

    fn int(&self) -> i128 {
        match self {
            Self::Int(v) => *v,
            other => panic!("expected an integer, found {other:?}"),
        }
    }

    fn boolean(&self) -> bool {
        match self {
            Self::Bool(v) => *v,
            other => panic!("expected a boolean, found {other:?}"),
        }
    }

    fn is_null(&self) -> bool {
        matches!(self, Self::Null)
    }

    fn u64(&self) -> u64 {
        u64::try_from(self.int()).expect("timestamps and ages are non-negative")
    }

    fn u16(&self) -> u16 {
        u16::try_from(self.int()).expect("basis points fit in u16")
    }

    fn u8(&self) -> u8 {
        u8::try_from(self.int()).expect("decimals fit in u8")
    }

    /// A big integer, authored as a decimal string because a JSON number cannot carry 78 digits
    /// without becoming a float and losing the last twenty.
    fn big(&self) -> u128 {
        let text = self.text();
        U256::from_dec_str(text)
            .unwrap_or_else(|| panic!("{text:?} is not a decimal integer"))
            .try_into_u128()
            .unwrap_or_else(|| panic!("{text:?} does not fit the 128-bit money domain"))
    }

    fn big256(&self) -> U256 {
        let text = self.text();
        U256::from_dec_str(text).unwrap_or_else(|| panic!("{text:?} is not a decimal integer"))
    }
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl Parser<'_> {
    fn skip_whitespace(&mut self) {
        while matches!(self.bytes.get(self.pos), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn expect(&mut self, byte: u8) -> Result<(), String> {
        if self.peek() == Some(byte) {
            self.pos += 1;
            Ok(())
        } else {
            Err(format!(
                "expected {:?} at byte {}",
                char::from(byte),
                self.pos
            ))
        }
    }

    fn value(&mut self) -> Result<Json, String> {
        match self.peek() {
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => Ok(Json::Str(self.string()?)),
            Some(b't') => self.literal("true").map(|()| Json::Bool(true)),
            Some(b'f') => self.literal("false").map(|()| Json::Bool(false)),
            Some(b'n') => self.literal("null").map(|()| Json::Null),
            Some(_) => self.number(),
            None => Err("unexpected end of input".to_string()),
        }
    }

    fn object(&mut self) -> Result<Json, String> {
        self.expect(b'{')?;
        let mut map = BTreeMap::new();
        self.skip_whitespace();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(Json::Object(map));
        }
        loop {
            self.skip_whitespace();
            let key = self.string()?;
            self.skip_whitespace();
            self.expect(b':')?;
            self.skip_whitespace();
            let value = self.value()?;
            if map.insert(key.clone(), value).is_some() {
                return Err(format!("duplicate key {key:?}"));
            }
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(Json::Object(map));
                }
                _ => return Err(format!("expected ',' or '}}' at byte {}", self.pos)),
            }
        }
    }

    fn array(&mut self) -> Result<Json, String> {
        self.expect(b'[')?;
        let mut items = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(Json::Array(items));
        }
        loop {
            self.skip_whitespace();
            items.push(self.value()?);
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    return Ok(Json::Array(items));
                }
                _ => return Err(format!("expected ',' or ']' at byte {}", self.pos)),
            }
        }
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        let mut out = String::new();
        loop {
            let byte = self.peek().ok_or("unterminated string")?;
            self.pos += 1;
            match byte {
                b'"' => return Ok(out),
                b'\\' => {
                    let escape = self.peek().ok_or("unterminated escape")?;
                    self.pos += 1;
                    out.push(match escape {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        // The canonical fixtures are ASCII. Failing loudly beats guessing at
                        // surrogate pairs in a file that has never contained one.
                        other => return Err(format!("unsupported escape \\{}", char::from(other))),
                    });
                }
                _ => {
                    let start = self.pos - 1;
                    while !matches!(self.peek(), Some(b'"' | b'\\') | None) {
                        self.pos += 1;
                    }
                    let chunk = std::str::from_utf8(&self.bytes[start..self.pos])
                        .map_err(|e| format!("invalid UTF-8 in string: {e}"))?;
                    out.push_str(chunk);
                }
            }
        }
    }

    fn number(&mut self) -> Result<Json, String> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
        if matches!(self.peek(), Some(b'.' | b'e' | b'E')) {
            return Err(format!(
                "floating point at byte {}: the canonical fixtures carry money as decimal strings",
                self.pos
            ));
        }
        if start == self.pos {
            return Err(format!("expected a value at byte {start}"));
        }
        std::str::from_utf8(&self.bytes[start..self.pos])
            .map_err(|e| e.to_string())?
            .parse::<i128>()
            .map(Json::Int)
            .map_err(|e| e.to_string())
    }

    fn literal(&mut self, word: &str) -> Result<(), String> {
        if self.bytes[self.pos..].starts_with(word.as_bytes()) {
            self.pos += word.len();
            Ok(())
        } else {
            Err(format!("expected {word:?} at byte {}", self.pos))
        }
    }
}

// -------------------------------------------------------------------------------------------
// Fixture → engine inputs
// -------------------------------------------------------------------------------------------

fn fixture() -> Json {
    let path =
        std::env::var(FIXTURE_OVERRIDE_VAR).unwrap_or_else(|_| CANONICAL_FIXTURE.to_string());
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    Json::parse(&text).unwrap_or_else(|e| panic!("cannot parse {path}: {e}"))
}

fn scenario(id: &str) -> Json {
    fixture()
        .get("scenarios")
        .items()
        .iter()
        .find(|s| s.get("id").text() == id)
        .unwrap_or_else(|| panic!("no scenario {id:?} in the fixture"))
        .clone()
}

fn to_asset(a: &Json) -> AssetRiskInput {
    let policy = a.get("policy");
    let haircuts = policy.get("haircuts");
    let passport = a.get("passport");
    let price = a.get("price");

    let exit_curve: Vec<ExitTier> = policy
        .get("exitCurve")
        .items()
        .iter()
        .map(|tier| ExitTier {
            threshold_usd18: tier.get("thresholdUsd18").big(),
            recovery_bps: tier.get("recoveryBps").u16(),
        })
        .collect();
    assert_eq!(
        i128::try_from(exit_curve.len()).unwrap(),
        policy.get("exitCurveLength").int(),
        "the fixture's declared curve length disagrees with the curve"
    );

    AssetRiskInput {
        asset_id: AssetId::from_hex(a.get("assetId").text()).expect("assetId is 32 bytes of hex"),
        quantity: a.get("quantity").big(),
        decimals: a.get("decimals").u8(),
        price_usd18: price.get("answerUsd18").big(),
        price_updated_at: price.get("updatedAt").u64(),
        passport_committed_at: passport.get("committedAt").u64(),
        passport_status: PassportStatus::from_name(passport.get("status").text())
            .expect("known passport status"),
        redemption_supported: passport.get("redemptionSupported").boolean(),
        redemption_floor_bps: passport.get("redemptionFloorBps").u16(),
        asset_status: AssetStatus::from_name(a.get("assetStatus").text())
            .expect("known asset status"),
        params: RiskParameters {
            initial_ltv_bps: policy.get("initialLtvBps").u16(),
            maintenance_ltv_bps: policy.get("maintenanceLtvBps").u16(),
            liquidation_ltv_bps: policy.get("liquidationLtvBps").u16(),
            max_concentration_bps: policy.get("maxConcentrationBps").u16(),
            haircut_market_bps: haircuts.get("marketBps").u16(),
            haircut_liquidity_bps: haircuts.get("liquidityBps").u16(),
            haircut_issuer_bps: haircuts.get("issuerBps").u16(),
            haircut_settlement_bps: haircuts.get("settlementBps").u16(),
            haircut_crosschain_bps: haircuts.get("crosschainBps").u16(),
            max_oracle_age: policy.get("maxOracleAgeSeconds").u64(),
            max_passport_age: policy.get("maxPassportAgeSeconds").u64(),
        },
        exit_curve,
    }
}

fn to_account(a: &Json) -> AccountInput {
    AccountInput {
        scaled_principal: a.get("scaledPrincipal").big(),
        borrow_index: a.get("borrowIndex").big(),
        reserved_usd18: a.get("reservedUsd18").big(),
        status_override: AccountStatus::from_name(a.get("statusOverride").text())
            .expect("known status override"),
    }
}

fn to_sequencer(s: &Json) -> SequencerInput {
    SequencerInput {
        up: s.get("up").boolean(),
        last_restart_at: s.get("lastRestartAt").u64(),
        grace_period: s.get("gracePeriodSeconds").u64(),
    }
}

// -------------------------------------------------------------------------------------------
// Comparison
// -------------------------------------------------------------------------------------------

/// Collects every disagreement before failing, rather than stopping at the first.
///
/// A rounding change usually moves several values at once, and the shape of the whole set is what
/// identifies which step of the pipeline drifted; one `assert_eq!` at a time hides that.
#[derive(Default)]
struct Diff {
    failures: Vec<String>,
}

impl Diff {
    fn u128_eq(&mut self, field: &str, actual: u128, expected: &Json) {
        let want = expected.big();
        if actual != want {
            self.failures
                .push(format!("  {field}: engine {actual}, fixture {want}"));
        }
    }

    fn u256_eq(&mut self, field: &str, actual: U256, expected: &Json) {
        let want = expected.big256();
        if actual != want {
            self.failures
                .push(format!("  {field}: engine {actual}, fixture {want}"));
        }
    }

    fn opt_u128_eq(&mut self, field: &str, actual: Option<u128>, expected: &Json) {
        match (actual, expected.is_null()) {
            (None, true) => {}
            (Some(value), false) => self.u128_eq(field, value, expected),
            (actual, _) => self.failures.push(format!(
                "  {field}: engine {actual:?}, fixture {expected:?}"
            )),
        }
    }

    fn text_eq(&mut self, field: &str, actual: &str, expected: &Json) {
        let want = expected.text();
        if actual != want {
            self.failures
                .push(format!("  {field}: engine {actual}, fixture {want}"));
        }
    }

    fn names_eq(&mut self, field: &str, actual: &[&str], expected: &Json) {
        let want: Vec<&str> = expected.items().iter().map(Json::text).collect();
        if actual != want.as_slice() {
            self.failures
                .push(format!("  {field}: engine {actual:?}, fixture {want:?}"));
        }
    }

    fn finish(self, id: &str, description: &str) {
        assert!(
            self.failures.is_empty(),
            "{id} — {description}\n{}\n\nThe fixture is frozen: if these disagree, risk-core is \
             wrong. See spec/accounting.md.",
            self.failures.join("\n")
        );
    }
}

fn check(id: &str) -> RiskReport {
    check_scenario(&scenario(id))
}

fn check_scenario(s: &Json) -> RiskReport {
    let id = s.get("id").text();
    let assets: Vec<AssetRiskInput> = s.get("assets").items().iter().map(to_asset).collect();

    assert_eq!(
        i128::try_from(assets.len()).unwrap(),
        s.get("assetCount").int(),
        "{id}: declared assetCount disagrees with the asset array"
    );

    let report = evaluate(
        &assets,
        &to_account(s.get("account")),
        &to_sequencer(s.get("sequencer")),
        s.get("now").u64(),
    )
    .unwrap_or_else(|e| panic!("{id}: evaluation refused: {e}"));

    let expected = s.get("expected");
    let expected_assets = expected.get("perAsset").items();
    let mut diff = Diff::default();

    if report.per_asset.len() != expected_assets.len() {
        diff.failures.push(format!(
            "  perAsset length: engine {}, fixture {}",
            report.per_asset.len(),
            expected_assets.len()
        ));
    }

    for (index, (actual, want)) in report.per_asset.iter().zip(expected_assets).enumerate() {
        check_asset(&mut diff, index, actual, want);
    }

    diff.u128_eq(
        "totalRecognizedUsd18",
        report.total_recognized_usd18,
        expected.get("totalRecognizedUsd18"),
    );
    diff.u128_eq(
        "borrowLimitUsd18",
        report.borrow_limit_usd18,
        expected.get("borrowLimitUsd18"),
    );
    diff.u128_eq(
        "maintenanceLimitUsd18",
        report.maintenance_limit_usd18,
        expected.get("maintenanceLimitUsd18"),
    );
    diff.u128_eq(
        "liquidationLimitUsd18",
        report.liquidation_limit_usd18,
        expected.get("liquidationLimitUsd18"),
    );
    diff.u128_eq("debtUsd18", report.debt_usd18, expected.get("debtUsd18"));
    diff.u128_eq(
        "availableBorrowUsd18",
        report.available_borrow_usd18,
        expected.get("availableBorrowUsd18"),
    );
    diff.u256_eq(
        "healthFactorWad",
        report.health_factor_wad,
        expected.get("healthFactorWad"),
    );
    diff.text_eq("status", report.status.as_str(), expected.get("status"));
    diff.names_eq("gates", &report.gates.names(), expected.get("gates"));

    diff.finish(id, s.get("description").text());
    report
}

fn check_asset(diff: &mut Diff, index: usize, actual: &AssetValuation, want: &Json) {
    let named = |name: &str| format!("perAsset[{index}].{name}");

    diff.text_eq(
        &named("assetId"),
        &actual.asset_id.to_string(),
        want.get("assetId"),
    );
    diff.u128_eq(
        &named("marketValueUsd18"),
        actual.market_value_usd18,
        want.get("marketValueUsd18"),
    );
    diff.u128_eq(
        &named("haircutMarkUsd18"),
        actual.haircut_mark_usd18,
        want.get("haircutMarkUsd18"),
    );
    diff.u128_eq(
        &named("stressedExitUsd18"),
        actual.stressed_exit_usd18,
        want.get("stressedExitUsd18"),
    );
    diff.opt_u128_eq(
        &named("redemptionFloorUsd18"),
        actual.redemption_floor_usd18,
        want.get("redemptionFloorUsd18"),
    );
    diff.u128_eq(
        &named("recognizedUsd18"),
        actual.recognized_usd18,
        want.get("recognizedUsd18"),
    );
    diff.u128_eq(
        &named("cappedUsd18"),
        actual.capped_usd18,
        want.get("cappedUsd18"),
    );
}

// -------------------------------------------------------------------------------------------
// One test per canonical scenario
// -------------------------------------------------------------------------------------------

/// Names each scenario as its own test, so a failure reports which economic situation broke
/// rather than "the conformance test failed". The list doubles as the roster
/// `fixture_contains_exactly_the_scenarios_under_test` checks against, so a scenario added to the
/// fixture without a test here is itself a failure.
macro_rules! scenario_tests {
    ($($name:ident => $id:literal,)*) => {
        $(
            #[test]
            fn $name() {
                check($id);
            }
        )*

        const SCENARIOS_UNDER_TEST: &[&str] = &[$($id),*];
    };
}

scenario_tests! {
    s01_empty_account => "S01-empty-account",
    s02_single_asset_no_debt => "S02-single-asset-no-debt",
    s03_single_asset_with_debt => "S03-single-asset-with-debt",
    s04_debt_above_borrow_limit => "S04-debt-above-borrow-limit",
    s05_debt_above_maintenance => "S05-debt-above-maintenance",
    s06_debt_above_liquidation => "S06-debt-above-liquidation",
    s07_stale_oracle => "S07-stale-oracle",
    s08_stale_passport => "S08-stale-passport",
    s09_claim_conflict => "S09-claim-conflict",
    s10_asset_suspended => "S10-asset-suspended",
    s11_exit_curve_binds => "S11-exit-curve-binds",
    s12_exit_curve_beyond_last_tier => "S12-exit-curve-beyond-last-tier",
    s13_concentration_binds => "S13-concentration-binds",
    s14_mixed_portfolio_with_debt => "S14-mixed-portfolio-with-debt",
    s15_reservation_reduces_capacity => "S15-reservation-reduces-capacity",
    s16_accrued_index => "S16-accrued-index",
    s17_sequencer_down => "S17-sequencer-down",
    s18_sequencer_grace => "S18-sequencer-grace",
    s19_guardian_override => "S19-guardian-override",
    s20_dust_rounding => "S20-dust-rounding",
    s21_redemption_floor_binds => "S21-redemption-floor-binds",
    s22_zero_price_invalid => "S22-zero-price-invalid",
    // Mixed-decimal scenarios. Everything above uses 18-decimal assets, which divide evenly and
    // therefore hid the rounding directions and the haircut order that spec/accounting.md
    // freezes. Mutation testing showed four separate mutations surviving the whole suite before
    // these existed: haircut order swapped, market value rounded up, concentration cap rounded
    // up, and debt rounded down.
    s23_six_decimal_rounding => "S23-six-decimal-rounding",
    s24_eight_decimal_rounding => "S24-eight-decimal-rounding",
    s25_mixed_decimals_portfolio => "S25-mixed-decimals-portfolio",
    s26_concentration_cap_remainder => "S26-concentration-cap-remainder",
    s27_debt_rounding_up => "S27-debt-rounding-up",
    s28_haircut_order_sensitivity => "S28-haircut-order-sensitivity",
}

#[test]
fn fixture_contains_exactly_the_scenarios_under_test() {
    let doc = fixture();
    let ids: Vec<&str> = doc
        .get("scenarios")
        .items()
        .iter()
        .map(|s| s.get("id").text())
        .collect();

    assert_eq!(
        ids, SCENARIOS_UNDER_TEST,
        "the fixture's scenarios and the tests in this file have diverged"
    );
    assert_eq!(
        i128::try_from(ids.len()).unwrap(),
        doc.get("scenarioCount").int(),
        "scenarioCount disagrees with the scenario array"
    );
    // Derived, not a magic number: a hardcoded count goes stale the first time a scenario is
    // added and then fails for a reason that has nothing to do with conformance.
    assert_eq!(ids.len(), SCENARIOS_UNDER_TEST.len());
    assert!(!ids.is_empty(), "the fixture set must not be empty");
}

#[test]
fn every_scenario_in_the_fixture_file_conforms() {
    // Driven by the file rather than by the list above, so that a scenario set generated for a
    // differential run against `scripts/gen_fixtures.py` is checked in full by pointing
    // `USANCE_RISK_FIXTURE` at it. On the canonical file this duplicates the named tests, which
    // is the point: the named tests report *which* situation broke, this one guarantees nothing
    // in the file went unchecked.
    let doc = fixture();
    let scenarios = doc.get("scenarios").items();
    assert!(
        !scenarios.is_empty(),
        "an empty scenario set proves nothing"
    );
    for scenario in scenarios {
        check_scenario(scenario);
    }
}

#[test]
fn fixture_constants_match_the_engine() {
    let constants = fixture().get("constants").clone();
    assert_eq!(
        u128::try_from(constants.get("BPS").int()).unwrap(),
        risk_core::BPS
    );
    assert_eq!(constants.get("WAD").big(), risk_core::WAD);
    assert_eq!(constants.get("USD").big(), risk_core::USD);
    assert_eq!(
        constants.get("SECONDS_PER_YEAR").int(),
        i128::from(risk_core::SECONDS_PER_YEAR)
    );
    assert_eq!(constants.get("UINT256_MAX").big256(), U256::MAX);
}

#[test]
fn fixture_status_order_matches_the_engine() {
    let doc = fixture();
    let order: Vec<&str> = doc
        .get("statusOrder")
        .items()
        .iter()
        .map(Json::text)
        .collect();
    let ours: Vec<&str> = AccountStatus::ALL.iter().map(|s| s.as_str()).collect();
    assert_eq!(
        order, ours,
        "the status total order is what makes I-07 structural; it cannot drift"
    );
}

#[test]
fn assets_are_authored_in_canonical_order() {
    // §1.3: sums over truncated per-asset values are order-dependent, so the fixture asserts its
    // own ordering rather than relying on every consumer to sort identically.
    for s in fixture().get("scenarios").items() {
        let ids: Vec<AssetId> = s
            .get("assets")
            .items()
            .iter()
            .map(|a| AssetId::from_hex(a.get("assetId").text()).expect("32 bytes of hex"))
            .collect();
        assert!(
            ids.windows(2).all(|w| w[0] < w[1]),
            "{}: assets are not strictly ascending by assetId",
            s.get("id").text()
        );
    }
}

#[test]
fn every_scenario_reproduces_its_documented_shape() {
    // A guard against a fixture that is internally consistent but economically vacuous: the set
    // must actually exercise each branch it claims to. These are properties of the *fixture set*,
    // not of any one scenario.
    let mut saw_gate = false;
    let mut saw_cap = false;
    let mut saw_margin_call = false;
    let mut saw_unbounded_health = false;
    let mut saw_indexed_debt = false;

    for scenario in fixture().get("scenarios").items() {
        let report = check_scenario(scenario);
        saw_gate |= !report.gates.is_empty();
        saw_cap |= report
            .per_asset
            .iter()
            .any(|v| v.capped_usd18 < v.recognized_usd18);
        saw_margin_call |= report.status == AccountStatus::MarginCall;
        saw_unbounded_health |= report.health_factor_wad.is_max();
        // A debt that is not a whole number of dollars can only have come from reconstruction
        // against a grown borrow index.
        saw_indexed_debt |=
            report.debt_usd18 > 0 && !report.debt_usd18.is_multiple_of(risk_core::WAD);
    }

    assert!(saw_gate, "no scenario exercises a degradation gate");
    assert!(saw_cap, "no scenario exercises the concentration cap");
    assert!(saw_margin_call, "no scenario reaches MARGIN_CALL");
    assert!(saw_unbounded_health, "no scenario has unbounded health");
    assert!(
        saw_indexed_debt,
        "no scenario exercises debt reconstruction against a non-unit index"
    );
}

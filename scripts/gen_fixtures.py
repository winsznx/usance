#!/usr/bin/env python3
"""Generate the canonical conformance fixtures from spec/accounting.md.

This script is a direct transcription of the accounting spec. It is not one of the three
production implementations; it exists so that the expected values committed to
fixtures/canonical/ are derived from the written spec rather than from whichever
implementation happened to be written first.

Solidity, Rust and TypeScript must all reproduce these values exactly.

    python3 scripts/gen_fixtures.py

Deterministic: no clocks, no randomness, no environment dependence.
"""

from __future__ import annotations

import json
import pathlib
from typing import Any

BPS = 10_000
WAD = 10**18
USD = 10**18
SECONDS_PER_YEAR = 31_536_000
UINT256_MAX = 2**256 - 1

# Status total order — see spec/accounting.md §5.1
STATUS = ["NORMAL", "NO_NEW_RISK", "REDUCE_ONLY", "MARGIN_CALL", "LIQUIDATING", "SETTLED", "BAD_DEBT"]


def mul_div(a: int, b: int, d: int) -> int:
    """Round down. Python ints are arbitrary precision, matching the 512-bit intermediate."""
    assert d > 0, "division by zero"
    assert a >= 0 and b >= 0, "signed input to mulDiv"
    return (a * b) // d


def mul_div_up(a: int, b: int, d: int) -> int:
    assert d > 0, "division by zero"
    assert a >= 0 and b >= 0, "signed input to mulDivUp"
    if a == 0 or b == 0:
        return 0
    return ((a * b - 1) // d) + 1


def status_max(*names: str) -> str:
    return STATUS[max(STATUS.index(n) for n in names)]


def select_recovery_bps(curve: list[dict[str, Any]], market_value: int) -> int:
    """First tier whose threshold >= market value; past the end, the worst (last) tier."""
    for tier in curve:
        if market_value <= int(tier["thresholdUsd18"]):
            return tier["recoveryBps"]
    return curve[-1]["recoveryBps"]


def evaluate(scenario: dict[str, Any]) -> dict[str, Any]:
    now = scenario["now"]
    assets = scenario["assets"]
    account = scenario["account"]
    seq = scenario["sequencer"]

    # Canonical iteration order: ascending assetId as unsigned big-endian.
    ordered = sorted(assets, key=lambda a: int(a["assetId"], 16))
    assert [a["assetId"] for a in ordered] == [a["assetId"] for a in assets], (
        f"{scenario['id']}: assets must be authored in ascending assetId order"
    )

    gates: list[str] = []
    if not seq["up"]:
        gates.append("SEQUENCER_DOWN")
    elif now - seq["lastRestartAt"] < seq["gracePeriodSeconds"]:
        gates.append("SEQUENCER_GRACE")

    per_asset = []
    for a in ordered:
        policy = a["policy"]
        price = a["price"]
        passport = a["passport"]
        qty = int(a["quantity"])

        # ---- §4.1 market value
        market = mul_div(qty, int(price["answerUsd18"]), 10 ** a["decimals"])

        # ---- §4.2 haircut mark, fixed order
        h = policy["haircuts"]
        v = market
        for key in ("marketBps", "liquidityBps", "issuerBps", "settlementBps", "crosschainBps"):
            v = mul_div(v, BPS - h[key], BPS)
        haircut_mark = v

        # ---- §4.3 stressed exit
        stressed_exit = mul_div(market, select_recovery_bps(policy["exitCurve"], market), BPS)

        # ---- §4.4 redemption floor
        candidates = [haircut_mark, stressed_exit]
        redemption = None
        if passport["redemptionSupported"]:
            redemption = mul_div(market, passport["redemptionFloorBps"], BPS)
            candidates.append(redemption)

        recognised = min(candidates)

        # ---- gates contributed by this asset (§5.1)
        if qty > 0:
            if now - price["updatedAt"] > policy["maxOracleAgeSeconds"]:
                gates.append("ORACLE_STALE")
            if int(price["answerUsd18"]) <= 0:
                gates.append("ORACLE_INVALID")
            if now - passport["committedAt"] > policy["maxPassportAgeSeconds"]:
                gates.append("PASSPORT_STALE")
            if passport["status"] == "CONFLICTED":
                gates.append("CLAIM_CONFLICT")
            if passport["status"] == "SUSPENDED" or a["assetStatus"] == "SUSPENDED":
                gates.append("ASSET_SUSPENDED")

        per_asset.append(
            {
                "assetId": a["assetId"],
                "marketValueUsd18": str(market),
                "haircutMarkUsd18": str(haircut_mark),
                "stressedExitUsd18": str(stressed_exit),
                "redemptionFloorUsd18": str(redemption) if redemption is not None else None,
                "recognizedUsd18": str(recognised),
                "_recognised": recognised,
                "_policy": policy,
            }
        )

    # ---- §4.6 concentration, single pass over the uncapped total
    t_raw = sum(p["_recognised"] for p in per_asset)
    for p in per_asset:
        cap = mul_div(t_raw, p["_policy"]["maxConcentrationBps"], BPS)
        capped = min(p["_recognised"], cap)
        p["cappedUsd18"] = str(capped)
        p["_capped"] = capped

    total_recognised = sum(p["_capped"] for p in per_asset)

    # ---- §5 limits
    borrow_limit = sum(mul_div(p["_capped"], p["_policy"]["initialLtvBps"], BPS) for p in per_asset)
    maintenance_limit = sum(mul_div(p["_capped"], p["_policy"]["maintenanceLtvBps"], BPS) for p in per_asset)
    liquidation_limit = sum(mul_div(p["_capped"], p["_policy"]["liquidationLtvBps"], BPS) for p in per_asset)

    # ---- §3.1 debt
    debt = mul_div_up(int(account["scaledPrincipal"]), int(account["borrowIndex"]), WAD)
    reserved = int(account["reservedUsd18"])

    # ---- §5.1 status
    if debt == 0 or debt <= borrow_limit:
        base = "NORMAL"
    elif debt <= maintenance_limit:
        base = "NO_NEW_RISK"
    elif debt <= liquidation_limit:
        base = "REDUCE_ONLY"
    else:
        base = "MARGIN_CALL"

    gate_floor = "NO_NEW_RISK" if gates else "NORMAL"
    status = status_max(base, gate_floor, account["statusOverride"])

    # ---- capacity
    available = max(0, borrow_limit - debt - reserved)
    if status != "NORMAL":
        available = 0

    health = UINT256_MAX if debt == 0 else mul_div(maintenance_limit, WAD, debt)

    for p in per_asset:
        del p["_recognised"], p["_capped"], p["_policy"]

    return {
        "perAsset": per_asset,
        "totalRecognizedUsd18": str(total_recognised),
        "borrowLimitUsd18": str(borrow_limit),
        "maintenanceLimitUsd18": str(maintenance_limit),
        "liquidationLimitUsd18": str(liquidation_limit),
        "debtUsd18": str(debt),
        "availableBorrowUsd18": str(available),
        "healthFactorWad": str(health),
        "status": status,
        "gates": sorted(set(gates)),
    }


# --------------------------------------------------------------------------------------
# Scenario construction helpers
# --------------------------------------------------------------------------------------

T0 = 1_750_000_000  # fixed reference instant; no wall clock is ever read

# Two ascending asset ids. Authored explicitly so the ordering rule is visible.
A_TBILL = "0x0000000000000000000000000000000000000000000000000000000000000a01"
A_EQUITY = "0x0000000000000000000000000000000000000000000000000000000000000b02"
A_MMF = "0x0000000000000000000000000000000000000000000000000000000000000c03"
A_GOLD = "0x0000000000000000000000000000000000000000000000000000000000000d04"


def curve(*tiers: tuple[int, int]) -> list[dict[str, Any]]:
    return [{"thresholdUsd18": str(t * USD), "recoveryBps": r} for t, r in tiers]


def tbill(qty_tokens: int, **over: Any) -> dict[str, Any]:
    """A tokenized T-bill: deep liquidity, redemption supported, low haircuts."""
    a = {
        "assetId": A_TBILL,
        "symbol": "USTBx",
        "decimals": 18,
        "quantity": str(qty_tokens * 10**18),
        "assetStatus": "ACTIVE",
        "price": {"answerUsd18": str(USD), "updatedAt": T0, "maxAgeSeconds": 86_400},
        "passport": {
            "status": "ACTIVE",
            "committedAt": T0 - 3_600,
            "redemptionSupported": True,
            "redemptionFloorBps": 9_900,
            "singleSource": False,
        },
        "policy": {
            "initialLtvBps": 8_500,
            "maintenanceLtvBps": 9_000,
            "liquidationLtvBps": 9_300,
            "maxConcentrationBps": 10_000,
            "haircuts": {
                "marketBps": 50,
                "liquidityBps": 25,
                "issuerBps": 100,
                "settlementBps": 25,
                "crosschainBps": 0,
            },
            "exitCurve": curve((100_000, 9_990), (500_000, 9_960), (2_000_000, 9_900)),
            "maxOracleAgeSeconds": 86_400,
            "maxPassportAgeSeconds": 2_592_000,
        },
    }
    return deep_merge(a, over)


def equity(qty_tokens: int, **over: Any) -> dict[str, Any]:
    """A tokenized equity: thinner book, no redemption for the holder, higher haircuts."""
    a = {
        "assetId": A_EQUITY,
        "symbol": "NVDAx",
        "decimals": 18,
        "quantity": str(qty_tokens * 10**18),
        "assetStatus": "ACTIVE",
        "price": {"answerUsd18": str(120 * USD), "updatedAt": T0, "maxAgeSeconds": 3_600},
        "passport": {
            "status": "ACTIVE",
            "committedAt": T0 - 3_600,
            "redemptionSupported": False,
            "redemptionFloorBps": 0,
            "singleSource": False,
        },
        "policy": {
            "initialLtvBps": 6_500,
            "maintenanceLtvBps": 7_200,
            "liquidationLtvBps": 7_800,
            "maxConcentrationBps": 6_000,
            "haircuts": {
                "marketBps": 400,
                "liquidityBps": 250,
                "issuerBps": 150,
                "settlementBps": 100,
                "crosschainBps": 0,
            },
            "exitCurve": curve((25_000, 9_950), (100_000, 9_780), (400_000, 9_200), (1_000_000, 8_100)),
            "maxOracleAgeSeconds": 3_600,
            "maxPassportAgeSeconds": 604_800,
        },
    }
    return deep_merge(a, over)


def mmf(raw_units: int, **over: Any) -> dict[str, Any]:
    """A 6-decimal tokenized money-market fund.

    Exists to exercise decimals != 18. Every scenario below S23 used 18-decimal assets, which
    made market value, the concentration cap and debt divide evenly every time — so the rounding
    directions and the haircut order that spec/accounting.md freezes were invisible to the
    conformance set. Four separate mutations survived all four implementations' test suites.
    """
    a = {
        "assetId": A_MMF,
        "symbol": "USMMx",
        "decimals": 6,
        "quantity": str(raw_units),
        "assetStatus": "ACTIVE",
        # A deliberately non-round price so quantity x price rarely divides evenly by 10^6.
        "price": {"answerUsd18": "1234567890123456789", "updatedAt": T0, "maxAgeSeconds": 86_400},
        "passport": {
            "status": "ACTIVE",
            "committedAt": T0 - 3_600,
            "redemptionSupported": False,
            "redemptionFloorBps": 0,
            "singleSource": False,
        },
        "policy": {
            # Five distinct haircuts, none of them equal, so swapping any pair changes the
            # truncated result on a value with a remainder.
            "initialLtvBps": 7_777,
            "maintenanceLtvBps": 8_333,
            "liquidationLtvBps": 8_888,
            "maxConcentrationBps": 3_333,
            "haircuts": {
                "marketBps": 137,
                "liquidityBps": 71,
                "issuerBps": 233,
                "settlementBps": 59,
                "crosschainBps": 17,
            },
            "exitCurve": curve((37_000, 9_871), (211_000, 9_337), (1_300_000, 8_111)),
            "maxOracleAgeSeconds": 86_400,
            "maxPassportAgeSeconds": 2_592_000,
        },
    }
    return deep_merge(a, over)


def gold(raw_units: int, **over: Any) -> dict[str, Any]:
    """An 8-decimal tokenized commodity, matching Chainlink's native answer scale."""
    a = {
        "assetId": A_GOLD,
        "symbol": "XAUx",
        "decimals": 8,
        "quantity": str(raw_units),
        "assetStatus": "ACTIVE",
        "price": {"answerUsd18": "2387654321098765432", "updatedAt": T0, "maxAgeSeconds": 7_200},
        "passport": {
            "status": "ACTIVE",
            "committedAt": T0 - 3_600,
            "redemptionSupported": True,
            "redemptionFloorBps": 9_413,
            "singleSource": False,
        },
        "policy": {
            "initialLtvBps": 7_101,
            "maintenanceLtvBps": 7_907,
            "liquidationLtvBps": 8_501,
            "maxConcentrationBps": 4_999,
            "haircuts": {
                "marketBps": 313,
                "liquidityBps": 197,
                "issuerBps": 89,
                "settlementBps": 151,
                "crosschainBps": 41,
            },
            "exitCurve": curve((19_000, 9_907), (97_000, 9_601), (503_000, 8_803)),
            "maxOracleAgeSeconds": 7_200,
            "maxPassportAgeSeconds": 1_209_600,
        },
    }
    return deep_merge(a, over)


def deep_merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = json.loads(json.dumps(base))
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def account(scaled: int = 0, index: int = WAD, reserved: int = 0, override: str = "NORMAL") -> dict[str, Any]:
    return {
        "scaledPrincipal": str(scaled),
        "borrowIndex": str(index),
        "reservedUsd18": str(reserved),
        "statusOverride": override,
    }


def sequencer(up: bool = True, restart: int = T0 - 86_400, grace: int = 3_600) -> dict[str, Any]:
    return {"up": up, "lastRestartAt": restart, "gracePeriodSeconds": grace}


def scenario(sid: str, desc: str, assets: list[dict[str, Any]], acct: dict[str, Any], **kw: Any) -> dict[str, Any]:
    return {
        "id": sid,
        "description": desc,
        "now": kw.get("now", T0),
        "assets": assets,
        "account": acct,
        "sequencer": kw.get("sequencer", sequencer()),
    }


# --------------------------------------------------------------------------------------
# The canonical scenario set
# --------------------------------------------------------------------------------------

SCENARIOS = [
    scenario(
        "S01-empty-account",
        "No collateral, no debt. Every derived value is zero and health is unbounded.",
        [],
        account(),
    ),
    scenario(
        "S02-single-asset-no-debt",
        "1,000 USTBx at $1. Haircuts bind; the exit curve does not at this size.",
        [tbill(1_000)],
        account(),
    ),
    scenario(
        "S03-single-asset-with-debt",
        "Same position carrying $500 of debt at index 1.0. Comfortably inside the borrow limit.",
        [tbill(1_000)],
        account(scaled=500 * USD),
    ),
    scenario(
        "S04-debt-above-borrow-limit",
        "Debt exceeds the initial-LTV limit but not maintenance. New risk is blocked, "
        "the position is not yet in trouble.",
        [tbill(1_000)],
        account(scaled=880 * USD),
    ),
    scenario(
        "S05-debt-above-maintenance",
        "Maintenance breached but liquidation not yet. Reduce-only, health just below 1.0. "
        "Limits here are 833.11 / 882.11 / 911.52, so 900 sits in the reduce-only band.",
        [tbill(1_000)],
        account(scaled=900 * USD),
    ),
    scenario(
        "S06-debt-above-liquidation",
        "Liquidation threshold breached. Margin call.",
        [tbill(1_000)],
        account(scaled=990 * USD),
    ),
    scenario(
        "S07-stale-oracle",
        "Price is one second past its maximum age. Capacity is frozen at zero even though "
        "the recognised value still computes.",
        [tbill(1_000, price={"updatedAt": T0 - 86_401})],
        account(scaled=100 * USD),
    ),
    scenario(
        "S08-stale-passport",
        "Evidence is older than the policy allows. Same outcome: no new risk.",
        [equity(100, passport={"committedAt": T0 - 604_801})],
        account(scaled=100 * USD),
    ),
    scenario(
        "S09-claim-conflict",
        "Two extraction paths disagreed. The asset keeps its value but the account cannot "
        "take on new risk while the conflict is open.",
        [equity(100, passport={"status": "CONFLICTED"})],
        account(),
    ),
    scenario(
        "S10-asset-suspended",
        "Issuer-level suspension. Existing exposure remains measurable; new risk is blocked.",
        [equity(100, assetStatus="SUSPENDED")],
        account(scaled=1_000 * USD),
    ),
    scenario(
        "S11-exit-curve-binds",
        "5,000 NVDAx at $120 is $600,000 of market value, into the 92% tier. The exit curve "
        "is now the binding constraint rather than the haircut stack.",
        [equity(5_000)],
        account(),
    ),
    scenario(
        "S12-exit-curve-beyond-last-tier",
        "10,000 NVDAx is $1.2m, past the final threshold. The worst tier applies.",
        [equity(10_000)],
        account(),
    ),
    scenario(
        "S13-concentration-binds",
        "A portfolio that is 60%-capped on the equity leg. The cap is computed against the "
        "uncapped total, so it bites before the limits are summed.",
        [tbill(10_000), equity(1_000)],
        account(),
    ),
    scenario(
        "S14-mixed-portfolio-with-debt",
        "Realistic two-asset portfolio carrying debt. Exercises ordered summation across "
        "differing LTVs and decimals.",
        [tbill(50_000), equity(500)],
        account(scaled=30_000 * USD),
    ),
    scenario(
        "S15-reservation-reduces-capacity",
        "An in-flight execution has reserved $2,000. Available borrowing drops by exactly "
        "that amount even though debt has not changed.",
        [tbill(10_000)],
        account(scaled=1_000 * USD, reserved=2_000 * USD),
    ),
    scenario(
        "S16-accrued-index",
        "Borrow index has grown to 1.0537. Debt is reconstructed from scaled principal and "
        "rounds up.",
        [tbill(10_000)],
        account(scaled=4_000 * USD, index=1_053_700_000_000_000_000),
    ),
    scenario(
        "S17-sequencer-down",
        "The L2 sequencer is down. Prices exist but cannot be arbitraged, so they are not "
        "prices we lend against.",
        [tbill(1_000)],
        account(),
        sequencer=sequencer(up=False),
    ),
    scenario(
        "S18-sequencer-grace",
        "The sequencer restarted 600 seconds ago, inside the 3,600-second grace period.",
        [tbill(1_000)],
        account(),
        sequencer=sequencer(up=True, restart=T0 - 600),
    ),
    scenario(
        "S19-guardian-override",
        "A healthy account that a guardian has placed in reduce-only. The override is a "
        "floor: it restricts and cannot be undone by favourable inputs.",
        [tbill(1_000)],
        account(override="REDUCE_ONLY"),
    ),
    scenario(
        "S20-dust-rounding",
        "One wei of a token. Every downstream value truncates to zero without underflowing.",
        [tbill(0, quantity="1")],
        account(),
    ),
    scenario(
        "S21-redemption-floor-binds",
        "Redemption floor set below the haircut mark and the exit value, so it becomes the "
        "binding term of the min().",
        [tbill(1_000, passport={"redemptionFloorBps": 9_000})],
        account(),
    ),
    scenario(
        "S22-zero-price-invalid",
        "A zero answer is not a price. The oracle is invalid and capacity is zero.",
        [tbill(1_000, price={"answerUsd18": "0"})],
        account(),
    ),
    # --- mixed-decimal scenarios. Everything above uses 18-decimal assets, which divide evenly
    # and therefore hide the rounding directions and the haircut order that the spec freezes.
    scenario(
        "S23-six-decimal-rounding",
        "A 6-decimal money-market token at a non-round price. Market value, the haircut chain "
        "and every limit carry a remainder, so rounding direction is observable.",
        [mmf(1_000_001)],
        account(),
    ),
    scenario(
        "S24-eight-decimal-rounding",
        "An 8-decimal commodity token, matching Chainlink's native answer scale, with a "
        "redemption floor that does not divide evenly.",
        [gold(333_333_333)],
        account(),
    ),
    scenario(
        "S25-mixed-decimals-portfolio",
        "18, 8 and 6 decimal assets in one portfolio. Exercises ordered summation across "
        "differing scales where each leg truncates independently.",
        [tbill(7_777), mmf(4_444_444), gold(123_456_789)],
        account(scaled=3_141_592_653_589_793_238),
    ),
    scenario(
        "S26-concentration-cap-remainder",
        "A 3,333 bps concentration cap against an uncapped total that does not divide by 10,000, "
        "so the cap itself carries a remainder.",
        [tbill(1_111), mmf(9_999_999), gold(87_654_321)],
        account(),
    ),
    scenario(
        "S27-debt-rounding-up",
        "Scaled principal and an index chosen so debt reconstruction has a remainder. Pins the "
        "round-up rule in accounting.md 3.1: rounding down here would under-state what is owed.",
        [mmf(50_000_001)],
        account(scaled=1_000_000_000_000_000_001, index=1_053_700_000_000_000_000),
    ),
    scenario(
        "S28-haircut-order-sensitivity",
        "Five distinct haircuts on a value with a remainder at every step. Swapping any adjacent "
        "pair changes the truncated result, which is what makes the frozen order load-bearing.",
        [mmf(7_654_321)],
        account(),
    ),
]


def main() -> None:
    root = pathlib.Path(__file__).resolve().parent.parent
    out_dir = root / "fixtures" / "canonical"
    out_dir.mkdir(parents=True, exist_ok=True)

    doc = {
        "$schema": "./scenario.schema.json",
        "version": 1,
        "generatedBy": "scripts/gen_fixtures.py",
        "spec": "spec/accounting.md",
        "note": (
            "Frozen conformance fixtures. Solidity, Rust and TypeScript must reproduce every "
            "expected value exactly. A one-wei disagreement is a failure."
        ),
        "constants": {
            "BPS": BPS,
            "WAD": str(WAD),
            "USD": str(USD),
            "SECONDS_PER_YEAR": SECONDS_PER_YEAR,
            "UINT256_MAX": str(UINT256_MAX),
        },
        "statusOrder": STATUS,
        "scenarios": [],
    }

    for s in SCENARIOS:
        s = json.loads(json.dumps(s))
        s["expected"] = evaluate(s)
        # Explicit counts: Solidity's JSON cheatcodes cannot cheaply measure array length,
        # and a fixture that is awkward to consume is a fixture that stops being consumed.
        s["assetCount"] = len(s["assets"])
        for a in s["assets"]:
            a["policy"]["exitCurveLength"] = len(a["policy"]["exitCurve"])
        doc["scenarios"].append(s)

    doc["scenarioCount"] = len(SCENARIOS)

    path = out_dir / "risk-scenarios.json"
    path.write_text(json.dumps(doc, indent=2, sort_keys=False) + "\n")

    print(f"wrote {path.relative_to(root)}  ({len(SCENARIOS)} scenarios)")
    for s in doc["scenarios"]:
        e = s["expected"]
        print(
            f"  {s['id']:34} status={e['status']:<12} "
            f"recognised={int(e['totalRecognizedUsd18']) / 1e18:>14,.4f} "
            f"available={int(e['availableBorrowUsd18']) / 1e18:>12,.4f}"
        )


if __name__ == "__main__":
    main()

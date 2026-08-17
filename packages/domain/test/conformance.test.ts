import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  evaluate,
  type AccountInput,
  type AccountStatus,
  type AssetRiskInput,
  type SequencerInput,
} from "../src/risk";

/**
 * Invariant D-01, TypeScript side.
 *
 * The same file drives `contracts/test/RiskMathConformance.t.sol`. If the browser preview and the
 * contract ever disagree, a user signs a transaction whose outcome differs from what they were
 * shown, so this is checked to the wei rather than approximately.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "../../../fixtures/canonical/risk-scenarios.json");

interface Fixture {
  scenarioCount: number;
  scenarios: Array<{
    id: string;
    description: string;
    now: number;
    assets: any[];
    account: any;
    sequencer: any;
    expected: any;
  }>;
}

const fixture: Fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

function toAsset(a: any): AssetRiskInput {
  return {
    assetId: a.assetId,
    symbol: a.symbol,
    quantity: BigInt(a.quantity),
    decimals: a.decimals,
    priceUsd18: BigInt(a.price.answerUsd18),
    priceUpdatedAt: a.price.updatedAt,
    passportCommittedAt: a.passport.committedAt,
    passportStatus: a.passport.status,
    redemptionSupported: a.passport.redemptionSupported,
    redemptionFloorBps: a.passport.redemptionFloorBps,
    assetStatus: a.assetStatus,
    params: {
      initialLtvBps: a.policy.initialLtvBps,
      maintenanceLtvBps: a.policy.maintenanceLtvBps,
      liquidationLtvBps: a.policy.liquidationLtvBps,
      maxConcentrationBps: a.policy.maxConcentrationBps,
      haircutMarketBps: a.policy.haircuts.marketBps,
      haircutLiquidityBps: a.policy.haircuts.liquidityBps,
      haircutIssuerBps: a.policy.haircuts.issuerBps,
      haircutSettlementBps: a.policy.haircuts.settlementBps,
      haircutCrosschainBps: a.policy.haircuts.crosschainBps,
      maxOracleAge: a.policy.maxOracleAgeSeconds,
      maxPassportAge: a.policy.maxPassportAgeSeconds,
    },
    exitCurve: a.policy.exitCurve.map((t: any) => ({
      thresholdUsd18: BigInt(t.thresholdUsd18),
      recoveryBps: t.recoveryBps,
    })),
  };
}

describe("canonical risk conformance", () => {
  it("loads the frozen fixture set", () => {
    expect(fixture.scenarios).toHaveLength(fixture.scenarioCount);
    expect(fixture.scenarioCount).toBeGreaterThan(0);
  });

  for (const s of fixture.scenarios) {
    it(`${s.id} — ${s.description.split(".")[0]}`, () => {
      const assets = s.assets.map(toAsset);
      const account: AccountInput = {
        scaledPrincipal: BigInt(s.account.scaledPrincipal),
        borrowIndex: BigInt(s.account.borrowIndex),
        reservedUsd18: BigInt(s.account.reservedUsd18),
        statusOverride: s.account.statusOverride as AccountStatus,
      };
      const seq: SequencerInput = {
        up: s.sequencer.up,
        lastRestartAt: s.sequencer.lastRestartAt,
        gracePeriod: s.sequencer.gracePeriodSeconds,
      };

      const r = evaluate(assets, account, seq, s.now);
      const e = s.expected;

      // Per-asset intermediates matter as much as the totals: they are what the UI shows when a
      // user asks why their recognised value is below market value.
      s.assets.forEach((_: unknown, i: number) => {
        const got = r.perAsset[i]!;
        const want = e.perAsset[i];
        expect(got.marketValueUsd18.toString()).toBe(want.marketValueUsd18);
        expect(got.haircutMarkUsd18.toString()).toBe(want.haircutMarkUsd18);
        expect(got.stressedExitUsd18.toString()).toBe(want.stressedExitUsd18);
        expect(got.recognizedUsd18.toString()).toBe(want.recognizedUsd18);
        expect(got.cappedUsd18.toString()).toBe(want.cappedUsd18);
      });

      expect(r.totalRecognizedUsd18.toString()).toBe(e.totalRecognizedUsd18);
      expect(r.borrowLimitUsd18.toString()).toBe(e.borrowLimitUsd18);
      expect(r.maintenanceLimitUsd18.toString()).toBe(e.maintenanceLimitUsd18);
      expect(r.liquidationLimitUsd18.toString()).toBe(e.liquidationLimitUsd18);
      expect(r.debtUsd18.toString()).toBe(e.debtUsd18);
      expect(r.availableBorrowUsd18.toString()).toBe(e.availableBorrowUsd18);
      expect(r.healthFactorWad.toString()).toBe(e.healthFactorWad);
      expect(r.status).toBe(e.status);
      expect(r.gates).toEqual(e.gates);
    });
  }
});

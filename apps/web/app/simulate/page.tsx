import Link from "next/link";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  evaluate,
  explainHaircut,
  formatHealth,
  formatUsd,
  GATE_COPY,
  type AccountInput,
  type AccountStatus,
  type AssetRiskInput,
  type Gate,
  type SequencerInput,
} from "@usance/domain";
import { Footer, Nav, Notice, RiskBadge, Stat } from "@/components/primitives";

/**
 * `/simulate` — the mechanism, computed live, clearly labelled as a simulation.
 *
 * These are the same 22 canonical scenarios that `RiskMathConformance.t.sol` and the TypeScript
 * conformance suite both run against. Nothing here is a mock of a market: it is the real risk
 * pipeline, executing on frozen inputs, so a reader can see exactly how evidence becomes
 * borrowing power without a deployment or a wallet.
 *
 * It is a simulation surface and it is labelled as one on every screen.
 */

export const dynamic = "force-static";

interface RawScenario {
  id: string;
  description: string;
  now: number;
  assets: any[];
  account: any;
  sequencer: any;
}

function loadScenarios(): RawScenario[] {
  const p = resolve(process.cwd(), "../../fixtures/canonical/risk-scenarios.json");
  return JSON.parse(readFileSync(p, "utf8")).scenarios;
}

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

export default function Simulate() {
  const scenarios = loadScenarios();

  const computed = scenarios.map((s) => {
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
    return { s, assets, result: evaluate(assets, account, seq, s.now) };
  });

  const headline = computed.find((c) => c.s.id.startsWith("S02"))!;
  const restricted = computed.find((c) => c.s.id.startsWith("S21"))!;

  return (
    <>
      <Nav />

      <main>
        <section style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "56px 0" }}>
          <div className="shell" style={{ maxWidth: 820 }}>
            <span className="tag tag-dark">Simulation · frozen inputs, real pipeline</span>
            <h1 className="heading-lg" style={{ margin: "22px 0 16px" }}>
              How evidence becomes borrowing power
            </h1>
            <p className="body-lg muted" style={{ margin: 0 }}>
              Every number below is computed by the same risk pipeline that runs onchain, from the
              canonical scenario set the contracts are tested against. The inputs are fixed so the
              output is reproducible. The arithmetic is not simulated.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------------ worked example */}
        <section className="section">
          <div className="shell">
            <div className="micro">A worked example</div>
            <h2 className="heading" style={{ margin: "14px 0 8px" }}>
              $1,000 of a tokenized T-bill is not $1,000 of borrowing power
            </h2>
            <p className="muted" style={{ maxWidth: 640, marginTop: 0 }}>
              {headline.s.description}
            </p>

            <div className="grid-3" style={{ marginTop: 34 }}>
              <Stat label="Market value" value={formatUsd(headline.result.perAsset[0]!.marketValueUsd18)} />
              <Stat
                label="Usable collateral value"
                value={formatUsd(headline.result.totalRecognizedUsd18)}
                hint={explainHaircut(headline.result.perAsset[0]!)}
              />
              <Stat
                label="Available to borrow"
                value={formatUsd(headline.result.availableBorrowUsd18)}
                hint="85% initial LTV against the recognised value"
              />
            </div>

            <div className="card card-flush scroll-x" style={{ marginTop: 36 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th className="num">Value</th>
                    <th>What it means</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Market value", headline.result.perAsset[0]!.marketValueUsd18, "Quantity × oracle price."],
                    [
                      "After haircuts",
                      headline.result.perAsset[0]!.haircutMarkUsd18,
                      "Volatility, liquidity, issuer and settlement buffers, applied in a fixed order.",
                    ],
                    [
                      "Stressed exit value",
                      headline.result.perAsset[0]!.stressedExitUsd18,
                      "What this size could actually be sold for, from the exit curve.",
                    ],
                    [
                      "Redemption floor",
                      headline.result.perAsset[0]!.redemptionFloorUsd18 ?? 0n,
                      "What the issuer's redemption terms guarantee, when redemption exists.",
                    ],
                    [
                      "Recognised collateral",
                      headline.result.perAsset[0]!.recognizedUsd18,
                      "The most conservative of the above. This is what the protocol lends against.",
                    ],
                    ["Borrow limit", headline.result.borrowLimitUsd18, "Recognised value × initial LTV."],
                    [
                      "Maintenance limit",
                      headline.result.maintenanceLimitUsd18,
                      "Cross this and the account becomes reduce-only.",
                    ],
                  ].map(([label, value, meaning]) => (
                    <tr key={label as string}>
                      <td style={{ fontWeight: 500 }}>{label as string}</td>
                      <td className="num tnum">${formatUsd(value as bigint)}</td>
                      <td className="muted">{meaning as string}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ evidence change */}
        <section
          className="section"
          style={{ background: "var(--paper)", borderTop: "1px solid var(--hairline)", borderBottom: "1px solid var(--hairline)" }}
        >
          <div className="shell">
            <div className="micro">When the evidence changes</div>
            <h2 className="heading" style={{ margin: "14px 0 8px" }}>
              Capacity moves on its own
            </h2>
            <p className="muted" style={{ maxWidth: 660, marginTop: 0 }}>
              The same position, after the issuer&rsquo;s redemption terms worsen and a new Passport
              version is committed. Nobody edits a database row. The redemption floor becomes the
              binding constraint and every limit derived from it falls with it.
            </p>

            <div className="grid-2" style={{ marginTop: 32, alignItems: "start" }}>
              <div className="card">
                <div className="micro">Before · Passport v1</div>
                <div style={{ marginTop: 16 }} className="stack-sm">
                  <div className="row-between">
                    <span className="caption">Usable collateral</span>
                    <span className="tnum">${formatUsd(headline.result.totalRecognizedUsd18)}</span>
                  </div>
                  <div className="row-between">
                    <span className="caption">Available to borrow</span>
                    <span className="tnum">${formatUsd(headline.result.availableBorrowUsd18)}</span>
                  </div>
                  <div className="row-between">
                    <span className="caption">Status</span>
                    <RiskBadge status={headline.result.status} />
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="micro">After · redemption floor cut to 90%</div>
                <div style={{ marginTop: 16 }} className="stack-sm">
                  <div className="row-between">
                    <span className="caption">Usable collateral</span>
                    <span className="tnum">${formatUsd(restricted.result.totalRecognizedUsd18)}</span>
                  </div>
                  <div className="row-between">
                    <span className="caption">Available to borrow</span>
                    <span className="tnum">${formatUsd(restricted.result.availableBorrowUsd18)}</span>
                  </div>
                  <div className="row-between">
                    <span className="caption">Status</span>
                    <RiskBadge status={restricted.result.status} />
                  </div>
                </div>
                <p className="caption" style={{ marginTop: 14, marginBottom: 0 }}>
                  {explainHaircut(restricted.result.perAsset[0]!)}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ all scenarios */}
        <section className="section">
          <div className="shell">
            <div className="row-between" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
              <div>
                <div className="micro">Conformance set</div>
                <h2 className="heading" style={{ margin: "14px 0 0" }}>
                  All {computed.length} canonical scenarios
                </h2>
              </div>
              <p className="caption" style={{ maxWidth: 380, margin: 0 }}>
                Solidity, Rust and TypeScript must reproduce every one of these to the wei. A
                one-wei disagreement fails the build.
              </p>
            </div>

            <div className="card card-flush scroll-x" style={{ marginTop: 26 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th className="num">Recognised</th>
                    <th className="num">Borrow limit</th>
                    <th className="num">Available</th>
                    <th className="num">Health</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.map(({ s, result }) => (
                    <tr key={s.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{s.id.replace(/^S\d+-/, "").replace(/-/g, " ")}</div>
                        <div className="caption">{s.description.split(".")[0]}.</div>
                      </td>
                      <td className="num tnum">${formatUsd(result.totalRecognizedUsd18)}</td>
                      <td className="num tnum">${formatUsd(result.borrowLimitUsd18)}</td>
                      <td className="num tnum">${formatUsd(result.availableBorrowUsd18)}</td>
                      <td className="num tnum">{formatHealth(result.healthFactorWad)}</td>
                      <td>
                        <RiskBadge status={result.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ gates */}
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="shell">
            <div className="micro">Degraded inputs</div>
            <h2 className="heading" style={{ margin: "14px 0 8px" }}>
              What a user is told when something is wrong
            </h2>
            <p className="muted" style={{ maxWidth: 660, marginTop: 0 }}>
              Each of these blocks new risk while leaving repayment, collateral top-up and exit
              available. A degraded input can only ever restrict. It can never make an account look
              healthier than it is.
            </p>

            <div className="grid-2" style={{ marginTop: 28 }}>
              {(Object.keys(GATE_COPY) as Gate[]).map((g) => (
                <Notice key={g} tone="warn" title={GATE_COPY[g].title}>
                  {GATE_COPY[g].body} {GATE_COPY[g].repair}
                </Notice>
              ))}
            </div>

            <div style={{ marginTop: 40 }}>
              <Link href="/app" className="btn btn-primary btn-lg">
                Open Usance
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}

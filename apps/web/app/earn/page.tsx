import Link from "next/link";
import { Footer, Nav, Notice } from "@/components/primitives";
import { activeChain } from "@/lib/deployments";
import { loadVault, type VaultView } from "@/lib/vault";

/**
 * `/earn` — the lender's side.
 *
 * Deliberately not an "Earn 8.4%" card. A headline APY on a card is a projection dressed as a
 * promise: realised lender yield depends on utilisation, on whether the debt is repaid, and on
 * whether anything defaults. What this page shows instead is where the money currently is, what
 * borrowers are actually being charged right now, and how much of the vault a lender could get out
 * today — which is the number that decides whether to supply.
 *
 * Every figure is read from the deployed contract. Where one cannot be read, the field says so
 * rather than rendering a zero that reads like a fact.
 */

export const dynamic = "force-dynamic";

export default async function EarnPage() {
  const chain = activeChain();
  const vault = await loadVault();

  return (
    <>
      <Nav />
      <main>
        <section style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)", padding: "48px 0" }}>
          <div className="shell" style={{ maxWidth: 900 }}>
            <div className="micro">Supply liquidity · {chain.name}</div>
            <h1 className="heading-lg" style={{ margin: "18px 0 14px" }}>
              Lend against admitted collateral
            </h1>
            <p className="body-lg muted" style={{ margin: 0, maxWidth: 620 }}>
              Borrowers post assets Usance has read and priced. You supply the settlement asset they
              draw against, and earn the financing they pay. Your capital is lent out, so redemption
              is not always instant.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="shell" style={{ maxWidth: 900 }}>
            {vault === null ? (
              <Notice
                tone="stop"
                title={`Usance is not deployed on ${chain.name}`}
                action={
                  <Link className="btn btn-ghost" href="/status">
                    Integration status
                  </Link>
                }
              >
                There is no vault to read, so there are no figures to show. Rendering an empty vault
                here would look like one nobody has supplied to yet, which is a different claim.
              </Notice>
            ) : (
              <VaultCard vault={vault} />
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function amount(v: bigint, decimals: number): string {
  const whole = v / 10n ** BigInt(decimals);
  const frac = (v % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").slice(0, 2);
  return `${whole.toLocaleString()}.${frac}`;
}

function VaultCard({ vault }: { vault: VaultView }) {
  const d = vault.decimals;
  const sym = vault.settlementSymbol;
  const hasQueue = vault.queuedLiabilities !== null && vault.queuedFunded !== null;
  const queueOutstanding = hasQueue ? vault.queuedLiabilities! - vault.queuedFunded! : 0n;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="card">
        <div className="row-between" style={{ alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div className="micro">Settlement asset</div>
            <div style={{ fontSize: 22, marginTop: 6 }}>{sym}</div>
          </div>
          <span className="tag mono" style={{ fontSize: 11 }}>
            {vault.address.slice(0, 8)}…{vault.address.slice(-6)}
          </span>
        </div>

        <div className="grid-2" style={{ gap: 14 }}>
          <Metric label="Total supplied" value={`${amount(vault.totalSupplied, d)} ${sym}`} emphasis />
          <Metric label="Utilisation" value={`${(vault.utilizationBps / 100).toFixed(1)}%`} emphasis />
          <Metric label="Available cash" value={`${amount(vault.availableCash, d)} ${sym}`} />
          <Metric label="Deployed principal" value={`${amount(vault.deployedPrincipal, d)} ${sym}`} />
        </div>
      </div>

      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>What borrowers pay, and where it goes</div>
        {vault.borrowRateBps === null ? (
          <Notice tone="warn" title="The financing rate could not be read">
            The rate lives in FinancingEngine and this page could not reach it. It is left blank
            rather than filled with a plausible number.
          </Notice>
        ) : (
          <>
            <Row label="Borrower rate, right now" value={`${(vault.borrowRateBps / 100).toFixed(2)}% / year`} />
            <Row label="Protocol share of interest" value={`${((vault.protocolShareBps ?? 0) / 100).toFixed(2)}%`} />
            <Row label="Accrues to lenders" value={`${((vault.lenderShareBps ?? 0) / 100).toFixed(2)}% / year`} />
            {/*
              The distinction the whole card exists to keep: a borrow rate is a fact about the
              contract at this instant. What a lender realises also depends on utilisation and on
              the debt being repaid, so it is not quoted as though it were the same thing.
            */}
          </>
        )}

        {/*
          Outside the rate branch on purpose. This is a statement about what the page will and will
          not publish, and it has to hold when the rate cannot be read — which is exactly when a
          reader is most likely to want a headline number to fall back on.
        */}
        <p className="caption" style={{ margin: "14px 0 0" }}>
          Any rate shown here is what borrowers are charged now, not a projection of what you will
          earn. Realised yield also depends on utilisation and on borrowers repaying. Usance
          publishes no APY figure, because it would be neither.
        </p>
      </div>

      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>Getting your capital back</div>
        <Row label="Redeemable immediately" value={`${amount(vault.availableCash, d)} ${sym}`} />
        {hasQueue ? (
          <>
            <Row label="Waiting in the withdrawal queue" value={`${amount(queueOutstanding, d)} ${sym}`} />
            <Row label="Set aside for queued redemptions" value={`${amount(vault.queuedFunded!, d)} ${sym}`} />
          </>
        ) : (
          <Row label="Withdrawal queue" value="not available on this deployment" />
        )}
        <p className="caption" style={{ margin: "14px 0 0" }}>
          Capital that is lent out cannot be redeemed on demand. Redemptions that cannot be paid now
          join a queue that is paid in order and takes priority over new lending. Your shares are
          burned when you join it, so a later default cannot shrink a claim you have already exited.
        </p>
      </div>

      <div className="card">
        <div className="micro" style={{ marginBottom: 12 }}>Losses</div>
        <Row label="Protocol reserve" value={`${amount(vault.reserves, d)} ${sym}`} />
        <Row label="Written off against lenders" value={`${amount(vault.badDebt, d)} ${sym}`} />
        <p className="caption" style={{ margin: "14px 0 0" }}>
          The reserve absorbs the first loss. Only what it cannot cover reduces lender value, and
          losses stay in this vault — they are never spread to lenders who chose a different asset.
        </p>
      </div>

      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Link className="btn btn-primary btn-lg" href="/earn/positions">
          Your position
        </Link>
        <Link className="btn btn-ghost btn-lg" href="/assets">
          What backs these loans
        </Link>
      </div>
    </div>
  );
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="panel">
      <div className="stat-label">{label}</div>
      <div className="tnum" style={{ fontSize: emphasis ? 24 : 19, marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row-between" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)" }}>
      <span className="caption">{label}</span>
      <span className="caption tnum">{value}</span>
    </div>
  );
}

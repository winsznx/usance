import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer, Nav, Notice } from "@/components/primitives";
import { loadAsset, loadAssets, type AssetView, type ClaimView, type EvidenceView } from "@/lib/passport-data";
import { loadHistory, CLASSIFICATION_COPY, type HistoryTransition } from "@/lib/history";

/**
 * `/assets/[assetId]` — the proof explorer.
 *
 * This is not a product page with an evidence tab bolted on. It is the artifact that answers the
 * only question that matters about a tokenized asset — *why is this accepted, and on what
 * authority* — and it answers it in the order a sceptical reader asks it:
 *
 *   the verdict, immediately
 *   the chain of custody from issuer filing to onchain commitment
 *   what the token is, in plain language, each line traceable to a quoted sentence
 *   why recognised value is below market value, with the binding term named
 *   the document itself, hash-anchored
 *   what is committed onchain, or an honest statement that nothing is
 *
 * A reader who never opens the repository should be able to check our work.
 */

export async function generateStaticParams() {
  const assets = await loadAssets();
  return assets.map((a) => ({ assetId: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const asset = await loadAsset(assetId);
  if (!asset) return { title: "Asset not found — Usance" };
  return {
    title: `${asset.symbol} — Asset Passport — Usance`,
    description: `${asset.name}, issued by ${asset.issuer}. ${asset.verdict.headline}.`,
  };
}

const VERDICT_TONE = {
  ADMISSIBLE: { badge: "risk risk-NORMAL", notice: "neutral" },
  CAPPED: { badge: "risk risk-NO_NEW_RISK", notice: "warn" },
  BLOCKED: { badge: "risk risk-REDUCE_ONLY", notice: "stop" },
} as const;

export default async function AssetPassportPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const asset = await loadAsset(assetId);
  if (!asset) notFound();

  const tone = VERDICT_TONE[asset.verdict.state];

  return (
    <>
      <Nav />

      <main>
        {/* ------------------------------------------------------------------ verdict */}
        <section
          style={{
            background: "var(--paper)",
            borderBottom: "1px solid var(--hairline)",
            padding: "48px 0 40px",
          }}
        >
          <div className="shell">
            <Link href="/assets" className="caption" style={{ textDecoration: "underline" }}>
              ← All assets
            </Link>

            <div
              className="row-between"
              style={{ marginTop: 20, alignItems: "flex-start", flexWrap: "wrap", gap: 20 }}
            >
              <div style={{ maxWidth: 640 }}>
                <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                  <h1 className="heading-lg" style={{ margin: 0 }}>
                    {asset.symbol}
                  </h1>
                  <span className={tone.badge} style={{ alignSelf: "center" }}>
                    {asset.verdict.headline}
                  </span>
                </div>
                <p className="body-lg muted" style={{ margin: "12px 0 0" }}>
                  {asset.name}
                </p>
                <p className="caption" style={{ margin: "6px 0 0" }}>
                  Issued by {asset.issuer} · {asset.current.issuerJurisdiction}
                </p>
              </div>

              <div style={{ minWidth: 260 }}>
                <div className="micro">Because</div>
                <p style={{ margin: "10px 0 0", fontSize: 15, color: "var(--graphite)" }}>
                  {asset.verdict.because}
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="shell" style={{ padding: "40px 24px 0" }}>
          {asset.isTestFixture ? (
            <Notice tone="warn" title="No token contract — this is evidence, not a live market">
              Usance has read {asset.issuer}&rsquo;s actual filing and derived a Passport from it.
              It has <strong>not</strong> verified a token contract address for {asset.symbol} on X
              Layer, and no Usance contracts are deployed, so nothing here can be deposited or
              borrowed against today. Every hash, quote and claim below is real.
            </Notice>
          ) : null}
        </div>

        {/* ------------------------------------------------------------------ chain of custody */}
        <section className="section" style={{ paddingBottom: 0 }}>
          <div className="shell">
            <div className="micro">Chain of custody</div>
            <h2 className="heading" style={{ margin: "14px 0 10px" }}>
              From the issuer&rsquo;s filing to an enforceable limit
            </h2>
            <p className="muted" style={{ maxWidth: 660, marginTop: 0 }}>
              Every step below is reproducible from this page alone. Nothing was typed in by hand.
            </p>

            <CustodyChain asset={asset} />
          </div>
        </section>

        {/* ------------------------------------------------------------------ what it is */}
        <section className="section">
          <div className="shell">
            <div className="micro">What you would be holding</div>
            <h2 className="heading" style={{ margin: "14px 0 10px" }}>
              Read from the filing, not from a description
            </h2>
            <p className="muted" style={{ maxWidth: 660, marginTop: 0 }}>
              Each line was extracted from the document below. Open one to see the exact sentence it
              came from, and which extraction paths agreed.
            </p>

            <div className="card card-flush" style={{ marginTop: 26 }}>
              {asset.claims.map((c, i) => (
                <ClaimRow key={c.field} claim={c} last={i === asset.claims.length - 1} />
              ))}
            </div>

            <p className="caption" style={{ marginTop: 16, maxWidth: 660 }}>
              A field reading &ldquo;the filing does not say&rdquo; is a deliberate outcome, not a
              gap to be filled. An extractor that guesses is worse than one that abstains, because a
              guess is indistinguishable from a reading when the paths are compared.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------------------ corroboration */}
        <section
          className="section"
          style={{
            background: "var(--paper)",
            borderTop: "1px solid var(--hairline)",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          <div className="shell">
            <div className="micro">How the readings were checked</div>
            <h2 className="heading" style={{ margin: "14px 0 10px" }}>
              {asset.independentPathCount === 1
                ? "One independent path, so the Passport is capped"
                : `${asset.independentPathCount} independent paths compared field by field`}
            </h2>

            <div className="grid-2" style={{ marginTop: 26, alignItems: "start" }}>
              <div className="stack" style={{ gap: 14 }}>
                <p className="muted" style={{ margin: 0 }}>
                  Two paths corroborate only if they can fail differently. A deterministic parser and
                  a language model qualify. Two prompts against the same model do not — that is one
                  path wearing two hats, and counting it twice would let a single hallucination
                  corroborate itself.
                </p>
                <p className="muted" style={{ margin: 0 }}>
                  Comparison is exact equality after type-directed normalisation. Not fuzzy matching,
                  not embedding distance. Any softer rule lets two different readings of a redemption
                  term count as agreement.
                </p>
              </div>

              <div className="panel">
                <Row label="Outcome" value={asset.corroboration.replace(/_/g, " ").toLowerCase()} />
                <Row label="Independent paths" value={String(asset.independentPathCount)} />
                <Row
                  label="Passport capped"
                  value={asset.singleSource ? "Yes — single source" : "No"}
                />
                {asset.conflictingFields.length > 0 ? (
                  <Row label="Disputed fields" value={asset.conflictingFields.join(", ")} />
                ) : null}
                <p className="caption" style={{ marginTop: 14, marginBottom: 0 }}>
                  This page runs the deterministic path only, so it renders without a credential and
                  reproduces identically on any machine. The model path adds a second reading when a
                  key is configured.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ the document */}
        <section className="section">
          <div className="shell">
            <div className="micro">The evidence</div>
            <h2 className="heading" style={{ margin: "14px 0 10px" }}>
              The document itself, anchored by hash
            </h2>
            <p className="muted" style={{ maxWidth: 660, marginTop: 0 }}>
              Fetch the URI, canonicalise it, hash it, and you get the same digest. That is what
              makes a Passport checkable years later rather than merely asserted.
            </p>

            <EvidenceCard evidence={asset.current} />

            {asset.versions.length > 1 ? (
              <div style={{ marginTop: 34 }}>
                <div className="micro">Version history</div>
                <p className="muted" style={{ margin: "10px 0 18px", maxWidth: 620 }}>
                  {asset.versions.length} genuine versions of the same filing. This is what drives a
                  Passport version change, and with it a new risk epoch and a recomputed limit.
                </p>
                <div className="card card-flush scroll-x">
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="num">Version</th>
                        <th>Effective</th>
                        <th>Source class</th>
                        <th className="num">Bytes</th>
                        <th>Content hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...asset.versions].reverse().map((v) => (
                        <tr key={v.version}>
                          <td className="num tnum">v{v.version}</td>
                          <td className="tnum">
                            {new Date(v.evidence.effectiveAt * 1000).toISOString().slice(0, 10)}
                          </td>
                          <td className="muted">{v.evidence.sourceClassName.replace(/_/g, " ")}</td>
                          <td className="num tnum">{v.evidence.bytes.toLocaleString()}</td>
                          <td>
                            <span className="mono">{v.evidence.contentHash.slice(0, 18)}…</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* ------------------------------------------------------------------ onchain */}
        <section
          className="section"
          style={{ background: "var(--paper)", borderTop: "1px solid var(--hairline)" }}
        >
          <div className="shell">
            <div className="micro">Onchain commitment</div>
            <h2 className="heading" style={{ margin: "14px 0 10px" }}>
              {asset.calls.length > 0
                ? "The transactions this Passport would produce"
                : "Nothing to commit"}
            </h2>

            {asset.calls.length > 0 ? (
              <>
                <p className="muted" style={{ maxWidth: 680, marginTop: 0 }}>
                  The pipeline produces calldata and stops. It holds no key and broadcasts nothing —
                  an evidence pipeline that could sign is one that can commit its own conclusions.
                  The ordering matters: evidence commitments must land before the Passport that
                  roots them, because no contract checks that relationship and a Passport rooting
                  commitments that do not exist is a commitment to nothing.
                </p>
                <div className="card card-flush scroll-x" style={{ marginTop: 24 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="num">#</th>
                        <th>Contract</th>
                        <th>Function</th>
                        <th className="num">Calldata</th>
                      </tr>
                    </thead>
                    <tbody>
                      {asset.calls.map((c, i) => (
                        <tr key={`${c.contract}-${c.functionName}-${i}`}>
                          <td className="num tnum">{i + 1}</td>
                          <td style={{ fontWeight: 500 }}>{c.contract}</td>
                          <td className="mono" style={{ fontSize: 13 }}>
                            {c.functionName}
                          </td>
                          <td className="num">
                            <span className="mono">
                              {c.data.slice(0, 12)}… ({(c.data.length - 2) / 2} bytes)
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 24 }}>
                  <Notice tone="warn" title="Not broadcast">
                    No Usance contracts are deployed. The deployer holds no test gas, so these calls
                    exist as verified calldata and nothing more. When a deployment lands, this
                    section shows the transaction hashes instead of the payloads.
                  </Notice>
                </div>
              </>
            ) : (
              <Notice tone="stop" title="No Passport candidate was produced">
                The pipeline did not reach a committable state for this asset. That is a conclusion,
                not an error — a disputed or unreadable filing must not become a Passport.
              </Notice>
            )}
          </div>
        </section>

        {/* ------------------------------------------------------------------ reproduce */}
        <section className="section">
          <div className="shell">
            <div className="micro">Check it yourself</div>
            <h2 className="heading" style={{ margin: "14px 0 16px" }}>
              Reproduce every number on this page
            </h2>
            <div className="card">
              <pre
                className="mono"
                style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.7 }}
              >
{`# fetch the same filing the pipeline read
curl -s "${asset.current.uri}" -o filing.html

# every digest in the manifest recomputes from the bytes on disk
pnpm --filter @usance/evidence test fixtures

# run the pipeline over the real documents, both extraction paths
pnpm --filter @usance/evidence test`}
              </pre>
            </div>
            <p className="caption" style={{ marginTop: 16, maxWidth: 640 }}>
              The fixture test recomputes the raw digest, the canonical content hash, the issuer id,
              the source hash and the evidence id from the stored bytes. If any of them disagreed
              with this page, that test would fail.
            </p>
          </div>
        </section>
        <FilingHistory slug={asset.slug} />
      </main>

      <Footer />
    </>
  );
}

// ------------------------------------------------------------------------------- components

/**
 * Year-over-year semantic history.
 *
 * The honest result for these three filings is that nothing material changed, and that is what the
 * section says. The temptation with a page like this is to find something to report; a diff over
 * document text would happily oblige, because a prospectus is re-typeset every year. What is shown
 * is the diff over normalized claims, and the comparison coverage is shown next to it — "no change
 * across five comparable fields" is a different statement from "no change across seventeen", and
 * only one of them is true here.
 */
function FilingHistory({ slug }: { slug: string }) {
  const history = loadHistory(slug);
  if (!history || history.transitions.length === 0) return null;

  return (
    <section className="section" style={{ borderTop: "1px solid var(--hairline)" }}>
      <div className="shell" style={{ maxWidth: 860 }}>
        <div className="micro">Filing history</div>
        <h2 className="heading" style={{ margin: "14px 0 8px" }}>
          What changed between filings
        </h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
          {history.filings.length} filings compared on normalised claims, never on document text. A
          prospectus is re-typeset every year; that is not a change in what the asset is.
        </p>

        <div className="stack" style={{ gap: 14 }}>
          {history.transitions.map((t) => (
            <TransitionCard key={`${t.from}-${t.to}`} t={t} />
          ))}
        </div>

        <p className="caption" style={{ marginTop: 20 }}>
          Classification is made by deterministic policy from the diff. No model decides whether a
          change is a risk deterioration — a model that could would be a model that sets risk
          parameters.
        </p>
      </div>
    </section>
  );
}

function TransitionCard({ t }: { t: HistoryTransition }) {
  const copy = CLASSIFICATION_COPY[t.classification];
  const year = (id: string) => id.match(/(\d{4})$/)?.[1] ?? id;

  return (
    <div className="card">
      <div className="row-between" style={{ alignItems: "flex-start", gap: 16 }}>
        <div>
          <div style={{ fontWeight: 500 }}>
            {year(t.from)} → {year(t.to)}
          </div>
          <p className="caption" style={{ margin: "8px 0 0" }}>{copy.blurb}</p>
        </div>
        <span className="tag">{copy.label}</span>
      </div>

      {t.changes.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          {t.changes.map((c) => (
            <div key={c.field} className="row-between" style={{ padding: "9px 0", borderTop: "1px solid var(--hairline)" }}>
              <span className="caption mono">{c.field}</span>
              <span className="caption">
                {c.kind === "COVERAGE_DIFFERENCE"
                  ? "mentioned in only one filing"
                  : `${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`}
                {c.riskDirection ? ` · ${c.riskDirection.toLowerCase()}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/*
        The denominator, stated. "No material change" over five comparable fields is a weaker claim
        than over seventeen, and hiding which one it is would be the quiet kind of dishonesty.
      */}
      <p className="caption" style={{ margin: "14px 0 0", color: "var(--graphite)" }}>
        {t.coverage.note}
      </p>
    </div>
  );
}

function CustodyChain({ asset }: { asset: AssetView }) {
  const steps: Array<{ n: string; title: string; detail: string; value: string | null }> = [
    {
      n: "01",
      title: "Issuer filing",
      detail: `${asset.current.sourceClassName.replace(/_/g, " ").toLowerCase()}, retrieved from the issuer's own source`,
      value: `HTTP ${asset.current.httpStatus} · ${asset.current.bytes.toLocaleString()} bytes`,
    },
    {
      n: "02",
      title: "Content hash",
      detail: "Canonicalised, then hashed. Two retrievals of the same document agree.",
      value: `${asset.current.contentHash.slice(0, 22)}…`,
    },
    {
      n: "03",
      title: "Extraction",
      detail: `${asset.independentPathCount} independent path${asset.independentPathCount === 1 ? "" : "s"}, each producing a quoted claim or abstaining`,
      value: `${asset.claims.filter((c) => !c.isUnknown).length} of ${asset.claims.length} fields read`,
    },
    {
      n: "04",
      title: "Corroboration",
      detail: "Exact equality after type-directed normalisation. No vote, no tie-break.",
      value: asset.corroboration.replace(/_/g, " ").toLowerCase(),
    },
    {
      n: "05",
      title: "Passport candidate",
      detail: asset.candidate
        ? "Merkle-rooted over the evidence and the claims"
        : "Not produced — the evidence did not support one",
      value: asset.candidate ? `v${asset.candidate.version}` : "none",
    },
    {
      n: "06",
      title: "Risk consequence",
      detail: asset.singleSource
        ? "A single-source Passport is capped by policy and cannot unlock corroboration-gated capabilities"
        : "Feeds deterministic policy, which sets the recognised collateral value",
      value: asset.singleSource ? "capped" : "full",
    },
    {
      n: "07",
      title: "Onchain commitment",
      detail: "Calldata produced. Not broadcast — no deployment exists yet.",
      value: `${asset.calls.length} call${asset.calls.length === 1 ? "" : "s"}`,
    },
  ];

  return (
    <div className="card card-flush" style={{ marginTop: 26 }}>
      {steps.map((s, i) => (
        <div
          key={s.n}
          style={{
            display: "grid",
            gridTemplateColumns: "48px 1fr auto",
            gap: 16,
            padding: "18px 22px",
            borderBottom: i === steps.length - 1 ? "none" : "1px solid var(--hairline)",
            alignItems: "baseline",
          }}
        >
          <span className="micro" style={{ margin: 0 }}>
            {s.n}
          </span>
          <div>
            <div style={{ fontWeight: 500 }}>{s.title}</div>
            <div className="caption" style={{ color: "var(--graphite)" }}>
              {s.detail}
            </div>
          </div>
          <span className="mono tnum" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

const OUTCOME_COPY: Record<ClaimView["outcome"], string> = {
  AGREED: "both paths agreed",
  CONFLICT: "the paths disagreed",
  SINGLE: "one path only",
  ABSENT: "neither path found it",
};

function ClaimRow({ claim, last }: { claim: ClaimView; last: boolean }) {
  return (
    <details
      style={{
        borderBottom: last ? "none" : "1px solid var(--hairline)",
      }}
    >
      <summary
        style={{
          padding: "16px 22px",
          cursor: claim.quote ? "pointer" : "default",
          listStyle: "none",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 16,
          alignItems: "baseline",
        }}
      >
        <span>
          <span style={{ fontWeight: 500 }}>{claim.label}</span>
          {claim.riskBearing ? (
            <span className="tag" style={{ marginLeft: 10, fontSize: 11 }}>
              affects limits
            </span>
          ) : null}
        </span>
        <span
          style={{
            textAlign: "right",
            color: claim.isUnknown ? "var(--stone)" : "var(--aubergine-ink)",
            fontStyle: claim.isUnknown ? "italic" : "normal",
          }}
        >
          {claim.reading ?? "the filing does not say"}
        </span>
      </summary>

      {claim.quote ? (
        <div style={{ padding: "0 22px 20px" }}>
          <div className="micro" style={{ marginBottom: 8 }}>
            Read from
          </div>
          <blockquote
            style={{
              margin: 0,
              padding: "14px 18px",
              background: "var(--bone)",
              borderRadius: "var(--radius-input)",
              borderLeft: "3px solid var(--charcoal)",
              fontSize: 15,
              lineHeight: 1.6,
              color: "var(--graphite)",
            }}
          >
            {claim.quote}
          </blockquote>
          <div className="caption" style={{ marginTop: 10 }}>
            {claim.section ? `${claim.section} · ` : ""}
            {claim.extractor} · {OUTCOME_COPY[claim.outcome]}
          </div>
        </div>
      ) : null}
    </details>
  );
}

function EvidenceCard({ evidence }: { evidence: EvidenceView }) {
  return (
    <div className="card" style={{ marginTop: 26 }}>
      <div className="row-between" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <div style={{ maxWidth: 620 }}>
          <div style={{ fontWeight: 500, fontSize: 17 }}>{evidence.title}</div>
          <a
            href={evidence.uri}
            target="_blank"
            rel="noreferrer"
            className="mono"
            style={{ textDecoration: "underline", display: "block", marginTop: 8, fontSize: 12 }}
          >
            {evidence.uri}
          </a>
        </div>
        <span className="tag">{evidence.sourceClassName.replace(/_/g, " ")}</span>
      </div>

      <hr className="divider" style={{ margin: "20px 0" }} />

      <div className="grid-2" style={{ gap: 0, columnGap: 32 }}>
        <div>
          <Row label="Retrieved" value={new Date(evidence.retrievedAt * 1000).toISOString().slice(0, 10)} />
          <Row label="Effective" value={new Date(evidence.effectiveAt * 1000).toISOString().slice(0, 10)} />
          <Row label="Media type" value={evidence.mediaType} />
          <Row label="Size" value={`${evidence.bytes.toLocaleString()} bytes`} />
        </div>
        <div>
          <Row label="Raw digest" value={`${evidence.rawDigest.slice(0, 20)}…`} mono />
          <Row label="Content hash" value={`${evidence.contentHash.slice(0, 20)}…`} mono />
          <Row label="Source hash" value={`${evidence.sourceHash.slice(0, 20)}…`} mono />
          <Row label="Evidence id" value={`${evidence.evidenceId.slice(0, 20)}…`} mono />
        </div>
      </div>

      <hr className="divider" style={{ margin: "20px 0" }} />

      <div className="micro">Why this effective date</div>
      <p className="caption" style={{ marginTop: 8, marginBottom: 0, color: "var(--graphite)" }}>
        {evidence.effectiveAtBasis}
      </p>

      {evidence.notes ? (
        <>
          <div className="micro" style={{ marginTop: 18 }}>
            Note
          </div>
          <p className="caption" style={{ marginTop: 8, marginBottom: 0, color: "var(--graphite)" }}>
            {evidence.notes}
          </p>
        </>
      ) : null}

      {evidence.isDerived ? (
        <div style={{ marginTop: 18 }}>
          <Notice tone="stop" title="Derived fixture — not issuer-published">
            {evidence.derivationNote ?? "This document was derived from another and is not an issuer filing."}
          </Notice>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      className="row-between"
      style={{ padding: "9px 0", borderBottom: "1px solid var(--hairline)", gap: 16 }}
    >
      <span className="caption" style={{ color: "var(--graphite)" }}>
        {label}
      </span>
      <span className={mono ? "mono" : "tnum"} style={{ fontSize: 13, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

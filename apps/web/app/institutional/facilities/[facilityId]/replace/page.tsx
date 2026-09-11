import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer, Nav, Notice } from "@/components/primitives";
import { HEDERA_FACILITY } from "@/lib/institutional-proof";
import { InstitutionalLiveState } from "@/components/institutional-live-state";
import { SubstitutionRequestFlow } from "@/components/substitution-request-flow";

export default async function ReplaceCollateral({ params }: { params: Promise<{ facilityId: string }> }) {
  const { facilityId } = await params;
  if (facilityId.toLowerCase() !== HEDERA_FACILITY.id.toLowerCase()) notFound();
  return (
    <>
      <Nav />
      <main>
        <section className="section">
          <div className="shell stack" style={{ gap: 22 }}>
            <div>
              <div className="micro">Institutional facility · {HEDERA_FACILITY.homeDomain}</div>
              <h1 className="heading-lg" style={{ margin: "12px 0" }}>Replace collateral</h1>
              <p className="muted mono">{HEDERA_FACILITY.id}</p>
            </div>
            <Notice tone="warn" title="No collateral moves from this page">
              Creating a request stores durable orchestration metadata and resolves current ENSv2 authority. It never
              submits a Privy approval, a Chainlink CRE verdict, or a Hedera transaction.
            </Notice>
            <InstitutionalLiveState facilityId={HEDERA_FACILITY.id} />
            <SubstitutionRequestFlow facilityId={HEDERA_FACILITY.id} currentSeries={HEDERA_FACILITY.currentCollateral.series} />
            <Link className="btn btn-ghost" href={`/institutional/facilities/${HEDERA_FACILITY.id}`}>Back to facility</Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

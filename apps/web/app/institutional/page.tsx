import Link from "next/link";
import { Footer, Nav, Notice } from "@/components/primitives";
import { HEDERA_FACILITY } from "@/lib/institutional-proof";

export const metadata = { title: "Institutional collateral · Usance" };

export default function InstitutionalPage() {
  return <><Nav /><main><section className="section"><div className="shell" style={{ maxWidth: 820 }}>
    <div className="micro">Institutional collateral</div><h1 className="heading-lg" style={{ margin: "18px 0 16px" }}>Facilities keep collateral and authority in view.</h1>
    <p className="body-lg muted">Read the active testnet facility, its evidence, and each authority boundary. This workspace is read-only: no browser key or fixture can replace institutional approval.</p>
    <div style={{ marginTop: 28 }}><Notice tone="warn" title="Hedera testnet proof">The facility and substitution are live testnet evidence using test securities and test settlement. They are not a production institution account.</Notice></div>
    <div className="card" style={{ marginTop: 22 }}><div className="row-between"><div><div className="micro">{HEDERA_FACILITY.homeDomain}</div><h2 className="heading" style={{ margin: "10px 0 0" }}>Term secured credit</h2></div><span className="tag">{HEDERA_FACILITY.proofLevel.replace(/_/g, " ")}</span></div>
    <p className="muted">Facility is {HEDERA_FACILITY.status}. Current collateral is series {HEDERA_FACILITY.currentCollateral.series}; the completed replacement is inspectable with its proof chain.</p>
    <Link className="btn btn-primary" href={`/institutional/facilities/${HEDERA_FACILITY.id}`}>Inspect facility</Link></div>
  </div></section></main><Footer /></>;
}

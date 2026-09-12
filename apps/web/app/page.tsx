import Link from "next/link";
import Image from "next/image";
import { Nav, Footer, Stat } from "@/components/primitives";

/**
 * Landing page.
 *
 * One promise, three steps, and an honest account of what is live. It is not a documentation
 * dump and it does not lead with "RWA Passport" or "clearing" — a first-time visitor gets the
 * outcome first and the machinery only if they want it.
 */

/**
 * Questions a first-time visitor actually asks, answered without spin. Kept honest on purpose: the
 * testnet reality, the non-custodial model, and what is deliberately unfinished are stated as
 * plainly as the answers that flatter the product.
 */
const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What is Usance?",
    a: "Capital operations for tokenized real-world assets. It reads what an asset actually is from the issuer’s own filing, works out a conservative value that could be recovered under stress, and lets you borrow against that value without selling the asset.",
  },
  {
    q: "How is this different from a normal lending market?",
    a: "A lending market takes a liquid token and applies a governance-set loan-to-value. Usance starts from what the asset is. It reads the legal rights, issuer, custody and redemption terms from the filing, captures them in a versioned Passport, and works out a value that could be recovered under stress. You borrow against that value, and every haircut between market price and the usable amount is shown and named.",
  },
  {
    q: "Why is my usable amount lower than the asset’s market value?",
    a: "Because market price is not what you would recover if the asset had to be turned into cash under stress. Usance subtracts for liquidity, volatility, redemption friction and similar risks. Nothing is hidden. The full derivation is shown line by line, and you can read the filing each figure came from.",
  },
  {
    q: "Do I keep my asset? Is Usance custodial?",
    a: "You keep the exposure. Collateral sits in an on-chain vault that stays yours. You draw settlement liquidity against it and can repay and withdraw whenever you want. Usance is non-custodial, and no one, including an agent you authorise, can move your collateral out.",
  },
  {
    q: "What happens if my collateral falls in value?",
    a: "Your capacity follows the evidence automatically. As health declines the account moves through named states. New risk is refused first, then borrowing is restricted, and only in the worst case is a position reduced to cover debt. You always see which bound you hit, and the limit lands before a liquidation would.",
  },
  {
    q: "Can an agent act on my behalf safely?",
    a: "Yes. You can grant an agent a mandate inside limits you sign, for example to repay or add collateral to hold a buffer. It can never withdraw your collateral or take on new risk you didn’t authorise, and revoking the mandate is immediate and permanent, in a single transaction.",
  },
  {
    q: "How do I know the numbers aren’t just marketing?",
    a: "Every value is derived deterministically, and independent re-implementations of the risk engine agree to the wei. Prices are Chainlink feeds read back on-chain. Each step, from the source document to the final on-chain state, is written to a public receipt that anyone can verify without a wallet.",
  },
  {
    q: "Is this on mainnet? Can I lose real money?",
    a: "No. Usance runs on X Layer testnet today. The tokens are labelled test stand-ins with no real value, and nothing here is a live financial product. It’s built so you can check the whole mechanism before any real value is at stake.",
  },
  {
    q: "What do I need to try it?",
    a: "An X Layer wallet and a little OKB for gas. The faucet gives you test collateral and settlement tokens for free, and there’s no account or KYC to set up. Connect your wallet and Usance shows which of your holdings it can work with.",
  },
  {
    q: "What isn’t finished yet?",
    a: "A few paths need access Usance doesn’t have. Model-assisted document extraction has no API key, so Passports are built from a single deterministic path and labelled that way. External-venue hedging is off. One Chainlink product isn’t available on X Layer. Each of these is switched off in the product with the reason shown, never faked. The live status page lists every capability and its exact state.",
  },
];

export default function Landing() {
  return (
    <>
      <Nav />

      <main>
        {/* ---------------------------------------------------------------- hero */}
        <section className="hero">
          {/*
            The one saturated moment on the site. Priority-loaded because it is the largest
            contentful paint and a hero that arrives after the headline makes the page look like it
            reflowed. Decorative: the headline beside it already says what Usance does.
          */}
          <Image
            src="/images/hero-landscape.webp"
            alt=""
            aria-hidden
            fill
            priority
            fetchPriority="high"
            sizes="100vw"
            className="hero-art"
          />
          <div className="shell hero-inner">
            <span className="hero-pill">Capital operations for tokenized assets</span>
            <h1 className="hero-headline">Turn tokenized assets into working capital.</h1>
            <p className="hero-sub">
              Usance gives organizations one policy-controlled capital account to finance, move,
              govern and settle tokenized assets across onchain markets — without selling them.
            </p>
            <div className="row" style={{ gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
              <Link className="btn btn-primary btn-lg" href="/app/onboarding">Open Usance</Link>
              <Link className="btn btn-ghost btn-lg" href="/simulate">See how it works</Link>
            </div>
            <p style={{ marginTop: 18 }}>
              <Link href="/institutional" className="faq-link" style={{ color: "var(--warm-ash)" }}>
                View institutional proof
              </Link>
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- infrastructure rail
            Quiet supporting evidence, not a sponsor wall. See docs/BRAND_ASSET_SOURCES.md — these
            are typographic wordmarks pending verified official SVGs. */}
        <section className="infra-rail" aria-label="Infrastructure across Usance">
          <div className="shell">
            <div className="micro infra-rail-heading">Infrastructure across Usance</div>
            <div className="infra-rail-row">
              {["Base", "X Layer", "Hedera", "ENS", "Privy", "Chainlink"].map((name) => (
                <span key={name} className="infra-mark">{name}</span>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- the gap */}
        <section className="section">
          <div className="shell">
            <h2 className="heading-lg" style={{ margin: "0 0 16px", maxWidth: "18ch" }}>
              Tokenized assets are easy to hold. Harder to use.
            </h2>
            <p className="muted" style={{ margin: "0 0 32px", maxWidth: "62ch" }}>
              A token balance tells you what you own. It does not tell you what value can safely
              become collateral, how much capital is available, which actions policy allows, or
              where that capital should execute.
            </p>
            <div className="card card-flush" style={{ padding: 28 }}>
              <div className="grid-2" style={{ gap: 20 }}>
                <Stat label="Portfolio value" value="4.20M" hint="Example figures" />
                <Stat label="Recognized collateral" value="2.65M" hint="After stress haircuts" />
                <Stat label="Available credit" value="1.90M" hint="Undrawn" prefix="$" />
                <Stat label="Open facilities" value="2" hint="Active" prefix="" />
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- capital account */}
        <section className="section">
          <div className="shell">
            <h2 className="heading-lg" style={{ margin: "0 0 10px", maxWidth: "20ch" }}>
              One capital account. Multiple market domains.
            </h2>
            <p className="muted" style={{ margin: 0, maxWidth: "58ch" }}>
              Three jobs, one connected workstation — not three separate products.
            </p>
            <div className="editorial-cols">
              <div className="editorial-col">
                <div className="micro">Understand the asset</div>
                <ul>
                  <li>Asset Passports</li>
                  <li>Evidence</li>
                  <li>Instrument semantics</li>
                </ul>
              </div>
              <div className="editorial-col">
                <div className="micro">Turn it into capital</div>
                <ul>
                  <li>Recognized collateral</li>
                  <li>Capital requests</li>
                  <li>Facilities</li>
                  <li>Routing</li>
                </ul>
              </div>
              <div className="editorial-col">
                <div className="micro">Operate it safely</div>
                <ul>
                  <li>Organization policy</li>
                  <li>Authority</li>
                  <li>Receipts</li>
                  <li>Risk state</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- institutional proof */}
        <section className="section">
          <div className="shell">
            <div className="micro">Institutional proof</div>
            <h2 className="heading-lg" style={{ margin: "14px 0 16px", maxWidth: "20ch" }}>
              Keep the financing open. Replace the collateral.
            </h2>
            <p className="muted" style={{ margin: "0 0 8px", maxWidth: "62ch" }}>
              A live testnet proof: an organization replaces its posted collateral for a different
              eligible asset while financing stays open the entire time. Old collateral is never
              released until the replacement is provably secured.
            </p>
            <div className="proof-flow">
              <span className="proof-flow-step">Replacement collateral secured</span>
              <span className="proof-flow-arrow">→</span>
              <span className="proof-flow-step">Financial safety checked</span>
              <span className="proof-flow-arrow">→</span>
              <span className="proof-flow-step">Previous collateral released</span>
              <span className="proof-flow-arrow">→</span>
              <span className="proof-flow-step">Financing remained open</span>
            </div>
            <div className="grid-2" style={{ gap: 16, maxWidth: 640 }}>
              <Stat label="Facility" value="ACTIVE" prefix="" />
              <Stat label="Financing" value="OPEN" prefix="" />
              <Stat label="Series A" value="RELEASED" prefix="" />
              <Stat label="Series B" value="150,000 SECURED" prefix="" />
            </div>
            <p className="caption" style={{ marginTop: 18, maxWidth: 560 }}>
              Hedera testnet, test securities and test settlement. Not a claim of production funds.
            </p>
            <Link className="btn btn-primary" style={{ marginTop: 8 }} href="/institutional">
              View live proof
            </Link>
          </div>
        </section>

        {/* ---------------------------------------------------------------- multi-domain */}
        <section className="section">
          <div className="shell">
            <h2 className="heading-lg" style={{ margin: "0 0 10px", maxWidth: "22ch" }}>
              Usance is the operating layer. Networks are domains beneath it.
            </h2>
            <p className="muted" style={{ margin: 0, maxWidth: "58ch" }}>
              One facility has one authoritative financial home — Usance does not imply a shared
              cross-chain ledger or fungible assets across networks.
            </p>
            <div className="editorial-cols">
              <div className="editorial-col">
                <div className="micro">Market domains</div>
                <ul>
                  <li>Base</li>
                  <li>X Layer</li>
                  <li>Hedera</li>
                </ul>
              </div>
              <div className="editorial-col">
                <div className="micro">Organization / authority</div>
                <ul>
                  <li>ENS</li>
                  <li>Privy</li>
                </ul>
              </div>
              <div className="editorial-col">
                <div className="micro">Policy evidence</div>
                <ul>
                  <li>Chainlink</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- evidence */}
        <section className="section">
          <div className="shell">
            <div className="row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
              <div style={{ maxWidth: 560 }}>
                <div className="micro">Evidence</div>
                <h2 className="heading" style={{ margin: "14px 0 0" }}>
                  Every capital action leaves a receipt.
                </h2>
              </div>
              <Link href="/status" className="btn btn-ghost">
                Full integration status
              </Link>
            </div>
            <p className="muted" style={{ margin: "18px 0 0", maxWidth: "62ch" }}>
              Authority, policy, valuation, routing, execution and settlement are each written to a
              public receipt. Current financial state is always shown ahead of historical proof —
              a hash is evidence you can check, never the headline.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- features */}
        <section className="section features-section">
          <div className="shell">
            <h2 className="heading-lg" style={{ margin: "0 0 10px", maxWidth: "18ch" }}>
              What you get, and what it costs you to trust it
            </h2>
            <p className="muted" style={{ margin: "0 0 36px", maxWidth: "58ch" }}>
              Each of these is a thing you can check rather than a thing you have to believe.
            </p>

            <div className="feature-grid">
              {[
                {
                  art: "feature-passport",
                  title: "Know exactly what you hold",
                  body: "Every supported asset carries a versioned Passport: legal rights, issuer, custody, redemption window, transfer rules, and how corporate actions are handled. You can read the filing it was built from.",
                },
                {
                  art: "feature-value",
                  title: "Collateral that reflects reality",
                  body: "Market price is not liquidation value. Usance calculates what could actually be recovered under stress and shows you the usable amount. Every haircut is visible and named.",
                },
                {
                  art: "feature-borrow",
                  title: "Borrow against what you already own",
                  body: "Keep the exposure, receive settlement liquidity, repay when you choose. The position stays yours the entire time.",
                },
                {
                  art: "feature-monitoring",
                  title: "When the evidence changes, the risk changes",
                  body: "A revised filing or deteriorating liquidity moves the Passport, and your capacity follows automatically. New risk is refused before it is taken, and you are told which bound you hit.",
                },
                {
                  art: "feature-agents",
                  title: "Automation you can actually bound",
                  body: "Give an agent a mandate to maintain a buffer or reduce risk, inside limits you sign. It can repay and add collateral. It can never withdraw your collateral, and revoking is immediate and permanent.",
                },
                {
                  art: "feature-receipts",
                  title: "Every action is inspectable",
                  body: "From the original document to the final onchain state, each step is recorded. Receipts are public and need no wallet, so a counterparty can check a claim without taking your word for it.",
                },
              ].map((f) => (
                <article className="feature-card" key={f.title}>
                  <Image
                    src={`/images/${f.art}.webp`}
                    alt=""
                    aria-hidden
                    width={560}
                    height={315}
                    sizes="(max-width: 900px) 100vw, 360px"
                    className="feature-art"
                  />
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- audience */}
        <section className="section">
          <div className="shell">
            <h2 className="heading-lg" style={{ margin: "0 0 24px" }}>Who this is for</h2>
            <p className="muted" style={{ margin: 0, maxWidth: "70ch", lineHeight: 1.7 }}>
              RWA asset managers · Crypto-native funds · Fintech treasury teams · Market makers ·
              Tokenized-asset platforms · Structured-product operators
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- faq */}
        <section className="section" id="faq">
          <div className="shell">
            <div className="micro">Questions</div>
            <h2 className="heading-lg" style={{ margin: "14px 0 0", maxWidth: "20ch" }}>
              Questions people ask first
            </h2>
            <p className="muted" style={{ margin: "16px 0 0", maxWidth: "56ch" }}>
              If something here is still unclear, the{" "}
              <Link href="/status" className="faq-link">integration status</Link> and a{" "}
              <Link href="/assets/franklin-fobxx" className="faq-link">live Passport</Link> let you
              check the real thing yourself.
            </p>

            <div className="faq-list">
              {FAQ.map((f, i) => (
                <details className="faq-item" key={f.q} open={i === 0}>
                  <summary className="faq-q">{f.q}</summary>
                  <p className="faq-a">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

      </main>

      {/* ---------------------------------------------------------------- close */}
      <section className="closer">
        <Image
          src="/images/features-bg.webp"
          alt=""
          aria-hidden
          fill
          sizes="100vw"
          className="closer-art"
        />
        <div className="closer-inner">
          <h2 className="closer-headline">Make tokenized assets usable as capital.</h2>
          <p className="closer-sub">
            Explore Usance on testnet, or talk to us about a design partnership.
          </p>
          <div className="row" style={{ gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <Link className="btn btn-primary btn-lg closer-cta" href="/app/onboarding">
              Open Usance
            </Link>
            <Link className="btn btn-ghost btn-lg" href="mailto:hello@usance.xyz">
              Talk to Usance
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- footer */}
      <Footer />
    </>
  );
}

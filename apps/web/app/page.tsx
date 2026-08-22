import Link from "next/link";
import Image from "next/image";
import { Nav, Footer } from "@/components/primitives";

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
    a: "A clearing and risk layer for tokenized real-world assets. It reads what an asset actually is from the issuer’s own filing, works out a conservative value that could be recovered under stress, and lets you borrow against that value without selling the asset.",
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
            <span className="hero-pill">Built on X Layer</span>
            <h1 className="hero-headline">Make your tokenized assets usable as capital.</h1>
            <p className="hero-sub">
              Tokenization tells the chain an asset exists. Usance tells it what that asset is
              actually worth as collateral, how much could be recovered under stress, and what you
              can safely do with it.
            </p>
            <div className="row" style={{ gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
              <Link className="btn btn-primary btn-lg" href="/app/onboarding">Launch Usance</Link>
              <Link className="btn btn-ghost btn-lg" href="/assets">Explore supported assets</Link>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="shell">
            <div className="grid-3">
              {[
                {
                  n: "01",
                  h: "Bring a supported asset",
                  p: "Connect your wallet. Usance finds the tokenized assets you already hold and tells you which ones it can work with.",
                },
                {
                  n: "02",
                  h: "See how much is usable",
                  p: "Market value is not borrowing power. Usance shows you the difference and explains, line by line, exactly where it went.",
                },
                {
                  n: "03",
                  h: "Borrow, hedge, or keep holding",
                  p: "Draw cash against the recognised value. Keep the exposure. Repay whenever you want and take the asset back.",
                },
              ].map((s) => (
                <div key={s.n} className="card">
                  <div className="micro">{s.n}</div>
                  <h3 className="subheading" style={{ margin: "14px 0 10px" }}>
                    {s.h}
                  </h3>
                  <p className="muted" style={{ margin: 0, fontSize: 15 }}>
                    {s.p}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- honesty */}
        <section className="section">
          <div className="shell">
            <div className="row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
              <div style={{ maxWidth: 560 }}>
                <div className="micro">Where it stands</div>
                <h2 className="heading" style={{ margin: "14px 0 0" }}>
                  What is live, and what is not
                </h2>
              </div>
              <Link href="/status" className="btn btn-ghost">
                Full integration status
              </Link>
            </div>

            <div className="card card-flush scroll-x" style={{ marginTop: 28 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Capability</th>
                    <th>Status</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["X Layer settlement", "Live", "Chain 196 / 1952, verified against the live RPC."],
                    ["Chainlink price feeds", "Live", "26 Data Feeds on X Layer, read back onchain."],
                    ["Evidence → Passport → capacity", "Live", "Deterministic, three implementations agree to the wei."],
                    ["Builder Code attribution", "Live", "ERC-8021 suffix on every write path."],
                    ["ChainGPT extraction", "Needs access", "No API key configured. Single-path extraction is capped."],
                    ["Exchange OS execution", "Needs access", "No builder deployment access. Hedging is disabled, not simulated."],
                    ["Chainlink Data Streams", "Not on X Layer", "Adapter retained; nothing routes through it."],
                  ].map(([cap, status, detail]) => (
                    <tr key={cap}>
                      <td style={{ fontWeight: 500 }}>{cap}</td>
                      <td>
                        <span className="tag">{status}</span>
                      </td>
                      <td className="muted">{detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="caption" style={{ marginTop: 18, maxWidth: 620 }}>
              Anything Usance cannot do yet is disabled in the product with the reason shown. It is
              never replaced with a simulation dressed up as the real thing.
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
            <h2 className="heading-lg" style={{ margin: "0 0 32px" }}>Who this is for</h2>
            <div className="audience-grid">
              {[
                {
                  who: "If you already hold tokenized assets",
                  body: "Treasuries, tokenized stocks, funds. Usance lets you use them without selling, and tells you exactly how much is usable rather than how much they are quoted at.",
                },
                {
                  who: "If you trade",
                  body: "Portfolio margin against admitted collateral, an exit path that is priced rather than assumed, and restrictions that arrive before a liquidation rather than during one.",
                },
                {
                  who: "If you build agents",
                  body: "One interface to ask whether an asset is admissible, what it is recognised at, and what changed since the last risk epoch. Bounded authority, revocable in one transaction.",
                },
              ].map((a) => (
                <article className="feature-card" key={a.who}>
                  <h3>{a.who}</h3>
                  <p>{a.body}</p>
                </article>
              ))}
            </div>
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
          <h2 className="closer-headline">Stop holding assets that cannot work.</h2>
          <p className="closer-sub">
            Bring a supported tokenized asset. See what is actually usable. Decide what to do next.
          </p>
          <Link className="btn btn-primary btn-lg closer-cta" href="/app/onboarding">
            Launch Usance
          </Link>
        </div>
      </section>

      {/* ---------------------------------------------------------------- footer */}
      <Footer />
    </>
  );
}

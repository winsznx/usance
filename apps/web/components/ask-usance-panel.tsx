"use client";

import { useState } from "react";

type ContextType = "facility" | "replacement";

type AnswerResult = {
  outcome: "ANSWERED";
  answer: string;
  sources: string[];
  limitations: string[];
  safeNextActions: Array<{ label: string; href: string }>;
  evidence: { route: string; model: string; provider: string | null; requestId: string | null; createdAt: number | null };
};
type FailureResult = { outcome: "ROUTER_NOT_CONFIGURED" | "ROUTER_UNAVAILABLE" | "MALFORMED_RESPONSE" | "REFUSED_FINANCIAL_REQUEST" | "BAD_REQUEST"; reason: string };
type AskResult = AnswerResult | FailureResult;

const SUGGESTED: Record<ContextType, string[]> = {
  facility: [
    "What is the current collateral?",
    "What could block a collateral replacement?",
    "What authority is currently required?",
  ],
  replacement: [
    "Why was release paused?",
    "Why did the financing stay open?",
    "What proves Series B was secured first?",
    "What does LIVE_SIMULATION mean here?",
  ],
};

const FAILURE_COPY: Record<Exclude<FailureResult["outcome"], "BAD_REQUEST">, string> = {
  ROUTER_NOT_CONFIGURED: "Ask Usance is unavailable right now.",
  ROUTER_UNAVAILABLE: "Ask Usance could not reach its explanation service. Your financial state is unchanged.",
  MALFORMED_RESPONSE: "Ask Usance could not produce a reliable explanation. No action was taken.",
  REFUSED_FINANCIAL_REQUEST: "Ask Usance only explains current state. Usance's facility contracts are the sole financial authority — no model can borrow, withdraw, approve, sign, or change policy.",
};

/**
 * A contextual explanation panel, not a chatbot. It knows exactly one thing: the product object
 * the caller says it's attached to (`contextType`/`requestId`), and it can only ever return text —
 * there is no wallet, no signature, and no write path reachable from this component or the route
 * it calls.
 */
export function AskUsancePanel({ contextType, requestId, label = "Ask Usance" }: { contextType: ContextType; requestId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);

  async function ask(q: string) {
    setAsking(true);
    setResult(null);
    setQuestion(q);
    try {
      const res = await fetch("/api/ask-usance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, contextType, requestId }),
      });
      setResult((await res.json()) as AskResult);
    } catch {
      setResult({ outcome: "ROUTER_UNAVAILABLE", reason: "network error" });
    } finally {
      setAsking(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost ask-usance-trigger" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className="ask-usance-overlay" role="dialog" aria-modal="true" aria-label="Ask Usance">
      <div className="ask-usance-panel">
        <div className="row-between ask-usance-panel-header">
          <div>
            <div className="micro">Ask Usance</div>
            <div className="caption">Context: {contextType === "replacement" ? "This receipt" : "This facility"}</div>
          </div>
          <button type="button" className="ask-usance-close" onClick={() => setOpen(false)} aria-label="Close Ask Usance">
            Close
          </button>
        </div>

        {!question ? (
          <div className="stack ask-usance-suggestions">
            <p className="caption">Understand this state — suggested questions:</p>
            {SUGGESTED[contextType].map((q) => (
              <button key={q} type="button" className="ask-usance-suggestion" onClick={() => ask(q)}>
                {q}
              </button>
            ))}
          </div>
        ) : (
          <div className="stack ask-usance-conversation">
            <p className="ask-usance-question">{question}</p>
            {asking ? (
              <div className="skeleton" style={{ height: 60 }} />
            ) : result?.outcome === "ANSWERED" ? (
              <>
                <p className="ask-usance-answer">{result.answer}</p>
                {result.sources.length > 0 ? (
                  <div className="ask-usance-sources">
                    <span className="caption">Sources: </span>
                    {result.sources.join(" · ")}
                  </div>
                ) : null}
                {result.safeNextActions.length > 0 ? (
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    {result.safeNextActions.map((a) => (
                      <a key={a.label} href={a.href} className="btn btn-ghost" style={{ fontSize: 13 }}>
                        {a.label}
                      </a>
                    ))}
                  </div>
                ) : null}
                <button type="button" className="ask-usance-evidence-toggle" onClick={() => setShowEvidence((v) => !v)}>
                  {showEvidence ? "Hide provenance" : "Show provenance"}
                </button>
                {showEvidence ? (
                  <div className="ask-usance-evidence caption">
                    Powered by 0G Compute Router · model {result.evidence.model} · provider {result.evidence.provider ?? "unknown"} · read-only explanation
                  </div>
                ) : null}
              </>
            ) : result ? (
              <p className="ask-usance-answer ask-usance-failure">{"reason" in result && result.outcome in FAILURE_COPY ? FAILURE_COPY[result.outcome as keyof typeof FAILURE_COPY] : result.reason}</p>
            ) : null}
            <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => { setQuestion(""); setResult(null); }}>
              Ask another question
            </button>
          </div>
        )}

        <form
          className="ask-usance-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const q = String(form.get("q") ?? "").trim();
            if (q) ask(q);
          }}
        >
          <input name="q" className="input" placeholder="Ask about this state…" maxLength={500} />
          <button type="submit" className="btn btn-primary" disabled={asking}>Ask</button>
        </form>
      </div>
    </div>
  );
}

/**
 * 0G Compute Router client — read-only, explanation-only.
 *
 * The Router (https://router-api.0g.ai/v1, OpenAI-compatible) trades a fixed, verifiable
 * provider/model identity for availability and automatic failover — the opposite tradeoff Direct
 * evidence extraction needs (see docs/zerog/CAPABILITY_MATRIX.md: "Router is intentionally
 * excluded from financially material evidence flow because failover can obscure the actual
 * underlying provider"). It is used here for exactly one thing: explaining existing Usance state
 * in plain language. It never extracts evidence, never touches a Passport, and has no path to any
 * wallet, signature, or financial mutation — this module only ever returns text.
 */

const ROUTER_BASE_URL = "https://router-api.0g.ai/v1";
/** Confirmed live and available on this account's Router balance via GET /v1/models — 0G
 *  Foundation's own in-house model, TeeML-verified. Not every model name is available under every
 *  account's billing mode: a live probe against this exact account returned HTTP 501
 *  "model not available in USD mode" for a generic Llama model name before this one was found. */
const DEFAULT_MODEL = "0gm-1.0-35b-a3b";

export type AskUsanceResult =
  | { outcome: "ANSWERED"; answer: string; model: string; route: "0g-router"; provider: string | null; requestId: string | null; createdAt: number | null }
  | { outcome: "ROUTER_NOT_CONFIGURED" }
  | { outcome: "ROUTER_UNAVAILABLE"; reason: string }
  | { outcome: "MALFORMED_RESPONSE"; reason: string }
  | { outcome: "REFUSED_FINANCIAL_REQUEST" };

const FINANCIAL_ACTION_PATTERN =
  /\b(borrow|withdraw|repay|approve|sign|transfer|swap|trade|liquidate|deposit funds|move (my )?collateral|change (the )?(ltv|policy)|release collateral|execute (a|the) (trade|transaction))\b/i;

/**
 * Answers a question about existing Usance state. `context` is plain text describing current,
 * already-public read-model data (facility status, readiness outcome, etc.) — never secrets, never
 * anything this function could act on. The system prompt and a post-response check both refuse a
 * request that asks for a financial action; refusing is a safe failure, not an escalation.
 */
export async function askUsance(question: string, context: string): Promise<AskUsanceResult> {
  if (FINANCIAL_ACTION_PATTERN.test(question)) {
    return { outcome: "REFUSED_FINANCIAL_REQUEST" };
  }

  const apiKey = process.env.ZEROG_ROUTER_API_KEY;
  if (!apiKey) return { outcome: "ROUTER_NOT_CONFIGURED" };

  const systemPrompt =
    "You are Ask Usance, a read-only explanation assistant. You explain the CURRENT state described " +
    "in the context below, in plain language. You have no ability to take any action — you cannot " +
    "borrow, withdraw, repay, approve, sign, transfer, trade, liquidate, deposit, move collateral, " +
    "or change any policy. If asked to perform or simulate a financial action, refuse and explain " +
    "that Usance's facility contracts are the sole financial authority, never an AI model. Only use " +
    "the provided context; never invent numbers or state not present in it.";

  let response: Response;
  try {
    response = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: `${systemPrompt} Answer directly in 2-4 sentences; do not show your reasoning.` },
          { role: "user", content: `Context:\n${context}\n\nQuestion: ${question}` },
        ],
        temperature: 0.2,
        // This model "thinks" by default (see its /v1/models card) and consumes the token budget
        // on reasoning_content before producing final content — confirmed live: 200, 700, and 1200
        // all returned finish_reason "length" with empty content on a production-length prompt;
        // 3000 reliably reached finish_reason "stop" with real content. Reasoning tokens are billed
        // the same as completion tokens either way, so the headroom costs more per call, not more
        // per unit of actual answer.
        max_tokens: 3000,
        reasoning_effort: "low",
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    return { outcome: "ROUTER_UNAVAILABLE", reason: (error as Error).message.slice(0, 180) };
  }

  if (!response.ok) {
    return { outcome: "ROUTER_UNAVAILABLE", reason: `HTTP ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { outcome: "MALFORMED_RESPONSE", reason: "response was not valid JSON" };
  }

  const parsed = parseChatCompletion(body);
  if (!parsed) return { outcome: "MALFORMED_RESPONSE", reason: "missing choices[0].message.content" };

  if (FINANCIAL_ACTION_PATTERN.test(parsed.answer)) {
    return { outcome: "REFUSED_FINANCIAL_REQUEST" };
  }

  return { outcome: "ANSWERED", answer: parsed.answer, model: parsed.model ?? DEFAULT_MODEL, route: "0g-router", provider: parsed.provider, requestId: parsed.id, createdAt: parsed.created };
}

function parseChatCompletion(body: unknown): { answer: string; model: string | null; provider: string | null; id: string | null; created: number | null } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const choices = b.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content !== "string" || content.trim().length === 0) return null;
  // The Router does expose a per-response underlying provider address in `x_0g_trace.provider`,
  // confirmed live — the CAPABILITY_MATRIX's "Fixed underlying provider identity" caveat is about
  // this NOT being guaranteed stable across a failover, not about it being hidden per-call.
  const trace = b.x_0g_trace as Record<string, unknown> | undefined;
  return {
    answer: content.trim(),
    model: typeof b.model === "string" ? b.model : null,
    provider: typeof trace?.provider === "string" ? trace.provider : null,
    id: typeof b.id === "string" ? b.id : null,
    created: typeof b.created === "number" ? b.created : null,
  };
}

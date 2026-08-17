import { ProviderUnavailable, type ProviderStatus } from "@usance/schemas";

/**
 * ChainGPT HTTP client.
 *
 * Every detail here was established empirically against the live API on 2026-08-17, because the
 * published docs 404 on the endpoint pages. What was confirmed:
 *
 *   POST https://api.chaingpt.org/chat/stream
 *     Authorization: Bearer <key>
 *     {"model":"general_assistant","question":"...","chatHistory":"off"}
 *     → HTTP 201, body is PLAIN TEXT, not JSON. Asked for "OK", replied exactly "OK".
 *
 *   GET https://api.chaingpt.org/news
 *     → {"statusCode":200,"message":"Request Successful","data":[...]}
 *
 * The 201-with-plain-text shape is the part most likely to trip up a naive integration: calling
 * `response.json()` on it throws, and a client that treats that as a network error will retry a
 * request that actually succeeded.
 */

export const CHAINGPT_BASE_URL = "https://api.chaingpt.org";

/**
 * Models the API accepts, taken from its own validation error rather than from documentation.
 *
 * `in_depth_audit` and `compliance_bot` are listed as valid but fail on this plan with
 * "Cannot read properties of undefined (reading 'streamResponseCredits')", so they are excluded
 * here rather than left as a trap. `smart_contract_generator` answers "Please try again." and is
 * excluded for being unreliable — nothing should depend on it.
 */
export const CHAINGPT_MODELS = {
  GENERAL: "general_assistant",
  AUDITOR: "smart_contract_auditor",
} as const;

export type ChainGptModel = (typeof CHAINGPT_MODELS)[keyof typeof CHAINGPT_MODELS];

export interface ChainGptTransport {
  (url: string, init: RequestInit): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface ChainGptClientOptions {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  transport?: ChainGptTransport | undefined;
  /** Wall-clock ceiling per attempt. */
  timeoutMs?: number | undefined;
  maxAttempts?: number | undefined;
  /** Minimum spacing between requests. The provider is shared and rate-limited upstream. */
  minIntervalMs?: number | undefined;
  /** Injected so retry backoff is testable without waiting. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Injected so jitter is deterministic in tests. */
  random?: (() => number) | undefined;
}

export class ChainGptHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`ChainGPT returned HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "ChainGptHttpError";
  }
}

/** The auditor rejects a payload with no real contract source: HTTP 400 and an empty message. */
export class ChainGptPayloadRejected extends Error {
  constructor(readonly model: string) {
    super(`ChainGPT model ${model} rejected the payload (HTTP 400, empty message)`);
    this.name = "ChainGptPayloadRejected";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ChainGptClient {
  readonly name = "chaingpt";

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly transport: ChainGptTransport;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly minIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  /** Serialises requests so `minIntervalMs` holds even under concurrent callers. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(opts: ChainGptClientOptions = {}) {
    // Read from the environment rather than requiring a caller to pass it, so no call site ever
    // has a reason to hold the key.
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env;
    this.apiKey = opts.apiKey ?? env?.["CHAINGPT_API_KEY"];
    this.baseUrl = opts.baseUrl ?? CHAINGPT_BASE_URL;
    this.transport =
      opts.transport ?? ((url, init) => fetch(url, init) as unknown as ReturnType<ChainGptTransport>);
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.minIntervalMs = opts.minIntervalMs ?? 400;
    this.sleep = opts.sleep ?? defaultSleep;
    this.random = opts.random ?? Math.random;
  }

  status(): ProviderStatus {
    return this.apiKey ? "available" : "access_required";
  }

  private requireKey(provider: string): string {
    if (!this.apiKey) {
      throw new ProviderUnavailable(
        provider,
        "access_required",
        "CHAINGPT_API_KEY is not configured. Extraction falls back to the deterministic parser " +
          "path and any Passport built that way is marked singleSource. No model output is " +
          "fabricated to fill the gap.",
      );
    }
    return this.apiKey;
  }

  /**
   * One chat completion.
   *
   * Returns the raw text body. Parsing and validation belong to the caller, because a client that
   * understood the payload would be a client that could be tempted to repair it.
   */
  async chat(
    model: ChainGptModel,
    question: string,
    provider: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const key = this.requireKey(provider);
    return this.enqueue(async () => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        try {
          return await this.attempt(model, question, key, signal);
        } catch (e) {
          lastError = e;

          // A rejected payload and a bad key are terminal. Retrying either just burns credits and
          // delays the real error reaching the caller.
          if (e instanceof ChainGptPayloadRejected) throw e;
          if (e instanceof ChainGptHttpError && e.status === 401) throw e;
          if (e instanceof ChainGptHttpError && e.status === 403) throw e;
          if (signal?.aborted) throw e;
          if (attempt === this.maxAttempts) break;

          // Bounded exponential backoff with full jitter. Jitter matters because several assets
          // ingesting at once would otherwise retry in lockstep and re-create the burst.
          const base = Math.min(1_000 * 2 ** (attempt - 1), 8_000);
          await this.sleep(Math.floor(base * this.random()));
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    });
  }

  private async attempt(
    model: ChainGptModel,
    question: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);

    try {
      const res = await this.transport(`${this.baseUrl}/chat/stream`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, question, chatHistory: "off" }),
        signal: controller.signal,
      });

      // The response is plain text even on success, so the body is read before status branching.
      const body = await res.text();

      if (!res.ok) {
        // HTTP 400 with an empty message is how this API says "your payload was not usable",
        // which is a different problem from a transport failure and must not be retried.
        if (res.status === 400 && isEmptyMessage(body)) throw new ChainGptPayloadRejected(model);
        throw new ChainGptHttpError(res.status, body);
      }
      return body;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** GET a JSON endpoint. Only `/news` currently uses this shape. */
  async getJson<T>(path: string, provider: string, signal?: AbortSignal): Promise<T> {
    const key = this.requireKey(provider);
    return this.enqueue(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort);
      try {
        const res = await this.transport(`${this.baseUrl}${path}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        const body = await res.text();
        if (!res.ok) throw new ChainGptHttpError(res.status, body);
        return JSON.parse(body) as T;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    });
  }

  /** Serialise and space out requests. Prevents a burst from hammering a shared provider. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const since = Date.now() - this.lastRequestAt;
      if (since < this.minIntervalMs) await this.sleep(this.minIntervalMs - since);
      this.lastRequestAt = Date.now();
      return fn();
    });
    // Keep the chain alive after a rejection, or one failure would wedge every later request.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function isEmptyMessage(body: string): boolean {
  try {
    const j = JSON.parse(body) as { message?: unknown };
    return j.message === "" || j.message === undefined || j.message === null;
  } catch {
    return body.trim() === "";
  }
}

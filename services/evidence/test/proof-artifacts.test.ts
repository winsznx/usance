import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Integrity of the published proof artifacts.
 *
 * These files are the only thing standing between "Usance did this" and "Usance says it did this",
 * so they get checked like any other load-bearing input.
 *
 * Every rule here exists because the corresponding defect shipped:
 *
 *   - Fifteen hashes were 18 characters, reconstructed from `hash.slice(0,18)` console output. The
 *     receipt loader zero-padded them to satisfy the schema, producing explorer links that resolve
 *     to nothing.
 *   - A rejected borrow was recorded with `submitted: true` and `onchain: true` when it had only
 *     ever failed gas estimation in the client and never reached a block.
 *   - claims.json can drift away from the records it cites, at which point the ledger asserts more
 *     than the evidence supports.
 */

const PROOF_DIR = resolve(__dirname, "../../../proof");
const FULL_TX_HASH = /^0x[0-9a-f]{64}$/;
const ZERO_HASH = `0x${"0".repeat(64)}`;

interface ProofTx {
  label: string;
  hash: string;
  blockNumber?: number;
  status?: string;
}

function proofFiles(): Array<{ name: string; doc: Record<string, unknown> }> {
  if (!existsSync(PROOF_DIR)) return [];
  return readdirSync(PROOF_DIR)
    .filter((f) => f.endsWith(".json") && f !== "claims.json")
    .map((name) => ({ name, doc: JSON.parse(readFileSync(resolve(PROOF_DIR, name), "utf8")) }));
}

function allTransactions(doc: Record<string, unknown>): ProofTx[] {
  return [
    ...((doc["transactions"] as ProofTx[]) ?? []),
    ...((doc["priorTransactions"] as ProofTx[]) ?? []),
  ];
}

describe("proof artifacts", () => {
  const files = proofFiles();

  it("there is at least one proof record to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const { name, doc } of files) {
    describe(name, () => {
      it("every transaction hash is complete and lowercase-hex", () => {
        const bad = allTransactions(doc)
          .filter((t) => !FULL_TX_HASH.test(String(t.hash)))
          .map((t) => `${t.label}: ${t.hash} (${String(t.hash).length} chars)`);
        expect(bad).toEqual([]);
      });

      it("no transaction claims the zero hash", () => {
        // The zero hash is what a fabricated placeholder looks like when it has been shaped to
        // pass a regex. Nothing legitimate ever produces it.
        expect(allTransactions(doc).map((t) => t.hash)).not.toContain(ZERO_HASH);
      });

      it("no two different actions share a hash", () => {
        const byHash = new Map<string, string[]>();
        for (const t of allTransactions(doc)) {
          byHash.set(t.hash, [...(byHash.get(t.hash) ?? []), t.label]);
        }
        const collisions = [...byHash.entries()]
          .filter(([, labels]) => new Set(labels).size > 1)
          .map(([hash, labels]) => `${hash} claimed by ${labels.join(" and ")}`);
        expect(collisions).toEqual([]);
      });

      it("every transaction cites the block it landed in", () => {
        const unblocked = allTransactions(doc)
          .filter((t) => !Number.isFinite(Number(t.blockNumber)) || Number(t.blockNumber) <= 0)
          .map((t) => t.label);
        expect(unblocked).toEqual([]);
      });

      it("a blocked action is only called submitted when it has a hash of its own", () => {
        const blocked = doc["newRiskBlocked"] as Record<string, unknown> | undefined;
        if (!blocked) return;
        if (blocked["submitted"] === true) {
          expect(String(blocked["hash"] ?? "")).toMatch(FULL_TX_HASH);
          expect(Number(blocked["blockNumber"])).toBeGreaterThan(0);
          // Gas is burned by a mined revert and not by a call that failed estimation. Its presence
          // is the difference between the protocol refusing and the client refusing.
          expect(Number(blocked["gasUsed"])).toBeGreaterThan(0);
        } else {
          expect(blocked["hash"]).toBeUndefined();
        }
      });

      it("a record that names testnet stand-ins says so", () => {
        const text = JSON.stringify(doc);
        if (/tUSTB|tUSD/.test(text)) {
          expect(String(doc["identityWarning"] ?? "")).toMatch(/NOT .*(issuer|FOBXX)/i);
        }
      });
    });
  }
});

describe("proof/claims.json", () => {
  const path = resolve(PROOF_DIR, "claims.json");
  const ledger = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as {
        proofLevels: string[];
        claims: Array<{ claim: string; proofLevel: string; evidence?: string[]; detail?: string }>;
      })
    : null;

  it("exists", () => expect(ledger).not.toBeNull());

  it("every claim carries a recognised proof level", () => {
    for (const c of ledger!.claims) expect(ledger!.proofLevels).toContain(c.proofLevel);
  });

  it("every LIVE_TESTNET claim cites a hash or a file that exists", () => {
    const unsupported: string[] = [];
    for (const c of ledger!.claims.filter((x) => x.proofLevel === "LIVE_TESTNET")) {
      const cited = c.evidence ?? [];
      const ok = cited.some(
        (e) => FULL_TX_HASH.test(e) || existsSync(resolve(PROOF_DIR, "..", e)),
      );
      if (!ok) unsupported.push(c.claim);
    }
    expect(unsupported).toEqual([]);
  });

  it("no claim is silently dropped: unproven work is named, not omitted", () => {
    // A ledger that only lists wins is marketing. This asserts the honest section stays populated.
    expect(ledger!.claims.filter((c) => c.proofLevel === "NOT_YET_PROVEN").length).toBeGreaterThan(0);
  });

  it("every cited transaction hash appears in a proof record", () => {
    const known = new Set(proofFiles().flatMap(({ doc }) => {
      const blocked = doc["newRiskBlocked"] as Record<string, unknown> | undefined;
      return [
        ...allTransactions(doc).map((t) => t.hash),
        ...(blocked?.["hash"] ? [String(blocked["hash"])] : []),
      ];
    }));
    const dangling = ledger!.claims
      .flatMap((c) => (c.evidence ?? []).filter((e) => FULL_TX_HASH.test(e)))
      .filter((h) => !known.has(h));
    expect(dangling).toEqual([]);
  });
});

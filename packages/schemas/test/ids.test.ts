import { describe, expect, it } from "vitest";
import {
  accountId,
  assetId,
  claimLeaf,
  evidenceId,
  intentId,
  merkleRoot,
  passportId,
  receiptId,
} from "../src/ids";
import {
  CANONICALIZER_VERSION,
  canonicalizeText,
  contentHashOfText,
  issuerId,
  sourceHash,
} from "../src/canonical";
import type { Hex32 } from "../src/primitives";

/**
 * Identifier derivation must agree with Solidity exactly.
 *
 * The constants below were produced independently with `cast`, not by running this code:
 *
 *   cast keccak "$(cast abi-encode 'f(uint256,address)' 196 0x1111...)"
 *
 * That matters. A test that compares an implementation against its own output proves only that the
 * implementation is deterministic. These pin it against the same `abi.encode` + `keccak256` the
 * chain performs, so a drift between this file and `spec/accounting.md §2` fails here rather than
 * producing two different ids for the same asset.
 */
describe("identifier derivation, pinned against cast", () => {
  it("assetId matches keccak(abi.encode(chainId, token))", () => {
    expect(assetId(196n, "0x1111111111111111111111111111111111111111")).toBe(
      "0xffaa7011f78ed62991d9f33d4fbeb661a0521c8dca30067dc6971a145dd2bce9",
    );
  });

  it("accountId matches keccak(abi.encode('USANCE_ACCOUNT_V1', owner))", () => {
    expect(accountId("0x00000000000000000000000000000000000A11cE")).toBe(
      "0xf5c17cfdc2f0dbdb86edba63abd3b5234231905c5c180958da3b39fd1d9867ad",
    );
  });

  it("passportId matches keccak(abi.encode(assetId, version))", () => {
    const a = "0x0000000000000000000000000000000000000000000000000000000000000a01" as Hex32;
    expect(passportId(a, 1)).toBe(
      "0xb98879ac62e8033aa29f9fe7f8af2c3aa7a85fcde16886ae5c9a9b3f8822ac5d",
    );
  });

  it("evidenceId matches keccak(abi.encode(sourceHash, contentHash, effectiveAt))", () => {
    expect(
      evidenceId(
        "0x0000000000000000000000000000000000000000000000000000000000000011",
        "0x0000000000000000000000000000000000000000000000000000000000000022",
        1_750_000_000,
      ),
    ).toBe("0x542b46d7f237bc5fb8f78a5ae562e542f6e7604528cb7d556d286c9fcff4b592");
  });

  it("receiptId matches keccak(abi.encode(chainId, txHash, logIndex))", () => {
    expect(
      receiptId(
        196n,
        "0x00000000000000000000000000000000000000000000000000000000000000ff",
        3,
      ),
    ).toBe("0x7669e00fa709bddbef44f44f5198cea4c645d46b57207aba93da8e076dcbc2f0");
  });

  it("derives the same id twice and different ids for different inputs", () => {
    const a = assetId(196n, "0x1111111111111111111111111111111111111111");
    const b = assetId(1952n, "0x1111111111111111111111111111111111111111");
    expect(a).toBe(assetId(196n, "0x1111111111111111111111111111111111111111"));
    expect(a).not.toBe(b);
  });

  it("intentId is stable and sensitive to every component", () => {
    const z = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex32;
    const one = "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex32;
    const base = intentId(z, z, 0n, z);
    expect(base).toBe(intentId(z, z, 0n, z));
    expect(base).not.toBe(intentId(one, z, 0n, z));
    expect(base).not.toBe(intentId(z, one, 0n, z));
    expect(base).not.toBe(intentId(z, z, 1n, z));
    expect(base).not.toBe(intentId(z, z, 0n, one));
  });
});

describe("canonicalisation", () => {
  it("is idempotent", () => {
    const messy = "  Issuer:\r\n\r\n\r\n   Backed  Assets​ (JE)  Ltd. \t\n\n";
    const once = canonicalizeText(messy);
    expect(canonicalizeText(once)).toBe(once);
  });

  it("strips the differences that are not content", () => {
    const a = "Redemption:  supported\r\nWindow: 24h";
    const b = "Redemption: supported\nWindow: 24h";
    expect(canonicalizeText(a)).toBe(canonicalizeText(b));
    expect(contentHashOfText(a)).toBe(contentHashOfText(b));
  });

  it("removes zero-width characters, which are invisible but change a hash", () => {
    expect(contentHashOfText("NVDAx")).toBe(contentHashOfText("NVD​Ax"));
  });

  it("normalises decomposed unicode so the same accent hashes the same", () => {
    // "Société" precomposed vs decomposed.
    expect(contentHashOfText("Société Générale")).toBe(
      contentHashOfText("Société Générale"),
    );
  });

  it("keeps genuinely different content distinct", () => {
    expect(contentHashOfText("redemption supported")).not.toBe(
      contentHashOfText("redemption not supported"),
    );
  });

  it("preserves paragraph structure while collapsing excess blank lines", () => {
    expect(canonicalizeText("a\n\n\n\n\nb")).toBe("a\n\nb");
    expect(canonicalizeText("a\nb")).toBe("a\nb");
  });

  it("declares its version, because changing it changes every hash it ever produced", () => {
    expect(CANONICALIZER_VERSION).toBe("usance-text/1");
  });
});

describe("sourceHash binds content to origin", () => {
  const backed = issuerId("Backed Assets (JE) Limited", "JE");
  const other = issuerId("Some Other Issuer Ltd", "KY");

  it("the same URI under a different issuer is a different source", () => {
    expect(sourceHash("https://example.com/terms.pdf", backed)).not.toBe(
      sourceHash("https://example.com/terms.pdf", other),
    );
  });

  it("a different URI under the same issuer is a different source", () => {
    expect(sourceHash("https://example.com/a.pdf", backed)).not.toBe(
      sourceHash("https://example.com/b.pdf", backed),
    );
  });

  it("issuerId is case- and whitespace-insensitive on the legal name", () => {
    expect(issuerId("  backed assets (je) limited ", "je")).toBe(backed);
  });

  it("forged source metadata therefore yields a different evidenceId for identical bytes", () => {
    const content = contentHashOfText("Redemption is supported within 24 hours.");
    const real = evidenceId(sourceHash("https://backed.fi/terms", backed), content, 1_750_000_000);
    const forged = evidenceId(sourceHash("https://evil.example/terms", backed), content, 1_750_000_000);
    expect(real).not.toBe(forged);
  });
});

describe("merkle root", () => {
  const h = (n: number): Hex32 => `0x${n.toString(16).padStart(64, "0")}` as Hex32;

  it("an empty set commits to zero", () => {
    expect(merkleRoot([])).toBe(`0x${"00".repeat(32)}`);
  });

  it("a single leaf is its own root", () => {
    expect(merkleRoot([h(1)])).toBe(h(1));
  });

  it("is independent of input order", () => {
    expect(merkleRoot([h(1), h(2), h(3)])).toBe(merkleRoot([h(3), h(1), h(2)]));
  });

  it("handles odd counts by promoting, not duplicating", () => {
    // Duplicating the odd node would make [1,2,3] and [1,2,3,3] produce the same root, which is
    // the classic second-preimage weakness.
    expect(merkleRoot([h(1), h(2), h(3)])).not.toBe(merkleRoot([h(1), h(2), h(3), h(3)]));
  });

  it("changes when any leaf changes", () => {
    expect(merkleRoot([h(1), h(2), h(3), h(4)])).not.toBe(merkleRoot([h(1), h(2), h(3), h(5)]));
  });

  it("is deterministic across repeated calls", () => {
    const leaves = [h(9), h(4), h(7), h(1), h(3)];
    expect(merkleRoot(leaves)).toBe(merkleRoot([...leaves]));
  });

  it("claim leaves are sensitive to field, value and evidence", () => {
    const e = h(0xaa);
    const base = claimLeaf("redemption.supported", "bool:1", e);
    expect(base).not.toBe(claimLeaf("redemption.window", "bool:1", e));
    expect(base).not.toBe(claimLeaf("redemption.supported", "bool:0", e));
    expect(base).not.toBe(claimLeaf("redemption.supported", "bool:1", h(0xbb)));
  });
});

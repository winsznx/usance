import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeFunctionData, keccak256, slice, stringToBytes, toFunctionSelector } from "viem";
import { commitPassportArgs, passportCandidateSchema, SourceClass, type PassportCandidate } from "@usance/schemas";
import {
  bumpEpochCalldata,
  CAUSE_CLAIM_CONFLICT,
  COMMIT_EVIDENCE_SIGNATURE,
  COMMIT_PASSPORT_SIGNATURE,
  commitEvidenceCalldata,
  commitPassportCalldata,
  EVIDENCE_REGISTRY_ABI,
  PASSPORT_REGISTRY_ABI,
  PASSPORT_STATUS,
  RESTRICT_PASSPORT_SIGNATURE,
  restrictPassportCalldata,
} from "../src/commit";
import { ingestFixture } from "./support";

const CONTRACTS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "contracts", "src");

/**
 * Solidity parameter types the ABI in `commit.ts` must agree with.
 *
 * Enums are `uint8` on the wire. Mapping them here rather than in the source keeps the ABI honest
 * about what it encodes while the test still compares against the contract's own declaration.
 */
const SOLIDITY_TO_ABI: Readonly<Record<string, string>> = {
  "Types.PassportStatus": "uint8",
  "Types.SourceClass": "uint8",
};

/** Parameter type list of a Solidity function, read out of the contract source. */
async function solidityParamTypes(file: string, fn: string): Promise<string[]> {
  const source = await readFile(resolve(CONTRACTS, file), "utf8");
  const start = source.indexOf(`function ${fn}(`);
  if (start < 0) throw new Error(`no function ${fn} in ${file}`);

  const open = source.indexOf("(", start);
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }

  return source
    .slice(open + 1, close)
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      const type = p.split(/\s+/)[0]!;
      return SOLIDITY_TO_ABI[type] ?? type;
    });
}

function fixtureCandidate(overrides: Partial<PassportCandidate> = {}): PassportCandidate {
  return passportCandidateSchema.parse({
    assetId: `0x${"11".repeat(32)}`,
    version: 4,
    evidenceRoot: `0x${"22".repeat(32)}`,
    claimsRoot: `0x${"33".repeat(32)}`,
    expiresAt: 1_800_000_000,
    redemptionSupported: true,
    redemptionFloorBps: 9_900,
    singleSource: false,
    evidenceIds: [`0x${"44".repeat(32)}`],
    claimSets: [{ extractor: "parser@1", independenceGroup: "deterministic-parser", claims: [] }],
    strongestSourceClass: SourceClass.REGULATORY_FILING,
    corroborationOutcome: "CORROBORATED",
    builtAt: 1_786_987_500,
    builderVersion: "usance-passport-builder/1",
    ...overrides,
  });
}

describe("commit calldata", () => {
  it("the selector matches PassportRegistry.commitPassport as declared in Solidity", async () => {
    const types = await solidityParamTypes("core/PassportRegistry.sol", "commitPassport");
    const signature = `commitPassport(${types.join(",")})`;

    // Derived from the contract source, not transcribed twice. A parameter reordered in the .sol
    // fails here rather than producing calldata that encodes to the wrong argument slots.
    expect(signature).toBe(COMMIT_PASSPORT_SIGNATURE);

    const call = commitPassportCalldata(fixtureCandidate());
    expect(call.selector).toBe(toFunctionSelector(signature));
    expect(slice(call.data, 0, 4)).toBe(toFunctionSelector(signature));
    expect(slice(call.data, 0, 4)).toBe(slice(keccak256(stringToBytes(signature)), 0, 4));
  });

  it("the selector matches PassportRegistry.restrict and EvidenceRegistry.commit", async () => {
    const restrictTypes = await solidityParamTypes("core/PassportRegistry.sol", "restrict");
    expect(`restrict(${restrictTypes.join(",")})`).toBe(RESTRICT_PASSPORT_SIGNATURE);

    const evidenceTypes = await solidityParamTypes("core/EvidenceRegistry.sol", "commit");
    expect(`commit(${evidenceTypes.join(",")})`).toBe(COMMIT_EVIDENCE_SIGNATURE);

    expect(restrictPassportCalldata(`0x${"11".repeat(32)}`, 2, "CONFLICTED").selector).toBe(
      toFunctionSelector(RESTRICT_PASSPORT_SIGNATURE),
    );
    const { result } = await ingestFixture("franklin-fobxx-2025");
    expect(commitEvidenceCalldata(`0x${"11".repeat(32)}`, result.document).selector).toBe(
      toFunctionSelector(COMMIT_EVIDENCE_SIGNATURE),
    );
  });

  it("calldata decodes back to exactly the candidate's arguments", () => {
    const candidate = fixtureCandidate();
    const call = commitPassportCalldata(candidate);

    const decoded = decodeFunctionData({ abi: PASSPORT_REGISTRY_ABI, data: call.data });
    expect(decoded.functionName).toBe("commitPassport");
    expect(decoded.args).toEqual(commitPassportArgs(candidate));
    // Spelled out, because two adjacent bytes32 roots swapped is undetectable by type. The
    // evidence ids sit between the version and the roots, so a positional mistake there would
    // otherwise present as a root mismatch on chain rather than as a wiring bug here.
    expect(decoded.args).toEqual([
      candidate.assetId,
      4n,
      [...candidate.evidenceIds].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)),
      candidate.evidenceRoot,
      candidate.claimsRoot,
      1_800_000_000n,
      true,
      9_900,
      false,
    ]);
  });

  it("evidence calldata carries the document's own hashes and class", async () => {
    const { result } = await ingestFixture("franklin-fobxx-2025");
    const assetId = `0x${"11".repeat(32)}` as const;
    const call = commitEvidenceCalldata(assetId, result.document);

    const decoded = decodeFunctionData({ abi: EVIDENCE_REGISTRY_ABI, data: call.data });
    expect(decoded.args).toEqual([
      assetId,
      result.document.contentHash,
      result.document.sourceHash,
      BigInt(result.document.effectiveAt),
      BigInt(result.document.retrievedAt),
      SourceClass.REGULATORY_FILING,
    ]);
  });

  it("restrict encodes the PassportStatus ordinals Types.sol declares", async () => {
    const types = await readFile(resolve(CONTRACTS, "libraries/Types.sol"), "utf8");
    const block = types.slice(types.indexOf("enum PassportStatus"), types.indexOf("enum AssetStatus"));
    const members = [...block.matchAll(/^\s{8}([A-Z_]+),?/gm)].map((m) => m[1]!);

    // Ordinals are load-bearing: `restrict` requires a strictly greater one, which is what makes a
    // guardian's power one-way.
    expect(members).toEqual(["NONE", "ACTIVE", "STALE", "CONFLICTED", "SUSPENDED", "REVOKED"]);
    for (const [i, name] of members.entries()) {
      expect(PASSPORT_STATUS[name as keyof typeof PASSPORT_STATUS]).toBe(i);
    }

    const decoded = decodeFunctionData({
      abi: PASSPORT_REGISTRY_ABI,
      data: restrictPassportCalldata(`0x${"11".repeat(32)}`, 7, "CONFLICTED").data,
    });
    expect(decoded.args).toEqual([`0x${"11".repeat(32)}`, 7n, 3]);
  });

  it("the CLAIM_CONFLICT cause is the hash the spec names", () => {
    expect(CAUSE_CLAIM_CONFLICT).toBe(keccak256(stringToBytes("CLAIM_CONFLICT")));
    const decoded = decodeFunctionData({
      abi: [
        {
          type: "function",
          name: "bumpEpoch",
          stateMutability: "nonpayable",
          inputs: [{ name: "cause", type: "bytes32" }],
          outputs: [],
        },
      ] as const,
      data: bumpEpochCalldata(CAUSE_CLAIM_CONFLICT).data,
    });
    expect(decoded.args).toEqual([CAUSE_CLAIM_CONFLICT]);
  });

  it("every produced call names the role a signer must hold and no module holds a key", async () => {
    const call = commitPassportCalldata(fixtureCandidate());
    expect(call.requiredRole).toBe("ADMISSION");
    expect(restrictPassportCalldata(`0x${"11".repeat(32)}`, 2, "SUSPENDED").requiredRole).toBe(
      "ADMISSION_OR_GUARDIAN",
    );

    // The structural claim, checked mechanically: nothing in this package imports a signer, an
    // account or a wallet client, so there is no code path from a document to a broadcast.
    const source = await readFile(
      resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "commit.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/privateKeyToAccount|createWalletClient|sendTransaction|writeContract|signTypedData/);
  });
});

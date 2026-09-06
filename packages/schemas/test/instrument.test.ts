import { describe, expect, it } from "vitest";
import {
  domainId,
  evmCanonicalRef,
  instrumentBindingId,
  instrumentId,
  instrumentStandardId,
  nativeCanonicalRef,
  underlyingReferenceId,
} from "../src/ids";
import { issuerId } from "../src/canonical";
import {
  instrumentBindingsArtifactSchema,
  instrumentIdentitySchema,
  resolveInstrument,
  underlyingReferenceSchema,
  type InstrumentBinding,
} from "../src/instrument";
import type { Hex32 } from "../src/primitives";

/**
 * Instrument-identity derivation must agree with what a chain would compute.
 *
 * Every constant below was produced independently with `cast`, not by running this code:
 *
 *   cast keccak "$(cast abi-encode 'f(string,string)' USANCE_DOMAIN_V1 eip155:8453)"
 *
 * So a drift between `src/ids.ts` and `spec/identity-model.md §2` fails here rather than minting
 * two ids for one instrument.
 */
describe("instrument-identity derivation, pinned against cast", () => {
  it("domainId matches keccak(abi.encode('USANCE_DOMAIN_V1', caip2))", () => {
    expect(domainId("eip155:8453")).toBe(
      "0x347c660867e4aa0f6de9d34f6b4be0e4b67f26324c4f0e01f9b5c8c5dc2d5302",
    );
    expect(domainId("eip155:1952")).toBe(
      "0xbc756770bcdca902a5502582a63c0ea4a0226fbf6014e80c479922e829d728b1",
    );
  });

  it("instrumentStandardId matches keccak(abi.encode('USANCE_INSTRUMENT_STANDARD_V1', standard))", () => {
    expect(instrumentStandardId("B20")).toBe(
      "0x9c569e69ca5181e044cc5fdc3a3e77cd2e6d412d3bd1115463ec86a89fc1df55",
    );
    expect(instrumentStandardId("ERC20")).toBe(
      "0x8a029ad01cbff9a5a632ddeefaa997050273651f8bf3e499b9fa30dbf3aaebd5",
    );
  });

  it("evmCanonicalRef is the address left-padded into bytes32", () => {
    expect(evmCanonicalRef("0x1111111111111111111111111111111111111111")).toBe(
      "0x0000000000000000000000001111111111111111111111111111111111111111",
    );
    // case-insensitive on the address
    expect(evmCanonicalRef("0xAbCdEf0123456789AbCdEf0123456789AbCdEf01")).toBe(
      evmCanonicalRef("0xabcdef0123456789abcdef0123456789abcdef01"),
    );
  });

  it("nativeCanonicalRef matches keccak(abi.encode('USANCE_NATIVE_REF_V1', nativeId))", () => {
    expect(nativeCanonicalRef("0.0.1234567")).toBe(
      "0x6754a62efcf90ef58db3895fb43c234c3aa37063b4bfcb0665710c12c1ecd39b",
    );
  });

  it("underlyingReferenceId matches keccak(abi.encode('USANCE_UNDERLYING_REF_V1', class, isin, figi, ticker, name))", () => {
    expect(
      underlyingReferenceId({
        assetClass: "EQUITY",
        isin: "US0378331005",
        figi: "",
        ticker: "AAPL",
        name: "apple inc",
      }),
    ).toBe("0x249fa93430949fba6be79e2246da665d8711bfe434f3a3c3fd05aea7a5298c50");
  });

  it("instrumentId matches keccak(abi.encode(domainId, canonicalRef, issuerId, standardId, version))", () => {
    const id = instrumentId({
      domainId: domainId("eip155:8453"),
      canonicalRef: evmCanonicalRef("0x1111111111111111111111111111111111111111"),
      issuerId: issuerId("Coinbase, Inc.", "US"),
      instrumentStandardId: instrumentStandardId("B20"),
      instrumentVersion: 1,
    });
    expect(id).toBe("0x2e027917b5015b8d8b5bbbb018f053ef6f0534f655a8f0a77b89502f11cd0746");
  });

  it("instrumentBindingId matches keccak(abi.encode(legacyAssetId, instrumentId, boundAt))", () => {
    const legacy = "0x0000000000000000000000000000000000000000000000000000000000000a01" as Hex32;
    const iid = "0x2e027917b5015b8d8b5bbbb018f053ef6f0534f655a8f0a77b89502f11cd0746" as Hex32;
    expect(instrumentBindingId(legacy, iid, 1_756_900_000)).toBe(
      "0x9a965badf7a2cd271152fcb6fb143207913cd3d980ecb9e257bbd89725ad4544",
    );
  });
});

describe("instrumentId separates what must stay separate", () => {
  const base = {
    domainId: domainId("eip155:8453"),
    canonicalRef: evmCanonicalRef("0x1111111111111111111111111111111111111111"),
    issuerId: issuerId("Coinbase, Inc.", "US"),
    instrumentStandardId: instrumentStandardId("B20"),
    instrumentVersion: 1,
  };

  it("a version bump is a different instrument identity", () => {
    // #then — instrumentVersion is the deliberate lever for a genuine identity change
    expect(instrumentId(base)).not.toBe(instrumentId({ ...base, instrumentVersion: 2 }));
  });

  it("the domain is part of the identity", () => {
    expect(instrumentId(base)).not.toBe(
      instrumentId({ ...base, domainId: domainId("eip155:1952") }),
    );
  });

  it("the issuer is part of the identity", () => {
    expect(instrumentId(base)).not.toBe(
      instrumentId({ ...base, issuerId: issuerId("Some Other Issuer Ltd", "KY") }),
    );
  });

  it("the instrument standard is part of the identity", () => {
    expect(instrumentId(base)).not.toBe(
      instrumentId({ ...base, instrumentStandardId: instrumentStandardId("XSTOCKS_TRACKER_CERT") }),
    );
  });

  it("the underlying reference is NOT an input — two instruments over one company stay distinct, and learning an ISIN does not move an id", () => {
    // Two wrappers of the same company on two domains.
    const b20 = instrumentIdentitySchema.parse({
      domain: { caip2: "eip155:8453", label: "Base" },
      canonicalRef: { kind: "evm", token: "0x1111111111111111111111111111111111111111" },
      issuer: { legalName: "Coinbase, Inc.", jurisdiction: "US" },
      standard: "B20",
      instrumentVersion: 1,
      underlying: { assetClass: "EQUITY", isin: "", figi: "", ticker: "AAPL", name: "Apple Inc" },
      accountingMode: "REBASING_BALANCE",
    });
    const xstock = instrumentIdentitySchema.parse({
      domain: { caip2: "eip155:1952", label: "X Layer testnet" },
      canonicalRef: { kind: "evm", token: "0x2222222222222222222222222222222222222222" },
      issuer: { legalName: "Backed Assets (JE) Limited", jurisdiction: "JE" },
      standard: "XSTOCKS_TRACKER_CERT",
      instrumentVersion: 1,
      underlying: { assetClass: "EQUITY", isin: "", figi: "", ticker: "AAPL", name: "Apple Inc" },
      accountingMode: "REBASING_BALANCE",
    });
    expect(b20.underlying.underlyingReferenceId).toBe(xstock.underlying.underlyingReferenceId);
    expect(b20.instrumentId).not.toBe(xstock.instrumentId);

    // Same instrument, ISIN learned later.
    const withoutIsin = instrumentIdentitySchema.parse({
      domain: { caip2: "eip155:8453", label: "Base" },
      canonicalRef: { kind: "evm", token: "0x1111111111111111111111111111111111111111" },
      issuer: { legalName: "Coinbase, Inc.", jurisdiction: "US" },
      standard: "B20",
      instrumentVersion: 1,
      underlying: { assetClass: "EQUITY", isin: "", figi: "", ticker: "AAPL", name: "Apple Inc" },
      accountingMode: "REBASING_BALANCE",
    });
    const withIsin = instrumentIdentitySchema.parse({
      domain: { caip2: "eip155:8453", label: "Base" },
      canonicalRef: { kind: "evm", token: "0x1111111111111111111111111111111111111111" },
      issuer: { legalName: "Coinbase, Inc.", jurisdiction: "US" },
      standard: "B20",
      instrumentVersion: 1,
      underlying: {
        assetClass: "EQUITY",
        isin: "US0378331005",
        figi: "",
        ticker: "AAPL",
        name: "Apple Inc",
      },
      accountingMode: "REBASING_BALANCE",
    });
    expect(withIsin.underlying.underlyingReferenceId).not.toBe(
      withoutIsin.underlying.underlyingReferenceId,
    );
    expect(withIsin.instrumentId).toBe(withoutIsin.instrumentId);
  });

  it("accepts a raw canonical reference for a fixture-label legacy id", () => {
    const fixture = instrumentIdentitySchema.parse({
      domain: { caip2: "eip155:1952", label: "X Layer testnet" },
      canonicalRef: {
        kind: "raw",
        value: "0x7573616e63652d666978747572652d61737365743a6672616e6b6c696e2d666f",
      },
      issuer: { legalName: "Franklin Templeton Trust", jurisdiction: "US" },
      standard: "ERC20",
      instrumentVersion: 1,
      underlying: {
        assetClass: "MONEY_MARKET_FUND",
        isin: "",
        figi: "",
        ticker: "FOBXX",
        name: "Franklin OnChain U.S. Government Money Fund",
      },
      accountingMode: "FIXED_UNIT",
    });
    expect(fixture.canonicalRefHex).toBe(
      "0x7573616e63652d666978747572652d61737365743a6672616e6b6c696e2d666f",
    );
    expect(fixture.instrumentId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("the accounting mode is NOT an input — a rebase does not change identity", () => {
    const fixed = instrumentIdentitySchema.parse({
      domain: { caip2: "eip155:8453", label: "Base" },
      canonicalRef: { kind: "evm", token: "0x3333333333333333333333333333333333333333" },
      issuer: { legalName: "Acme Issuer Ltd", jurisdiction: "KY" },
      standard: "ERC20",
      instrumentVersion: 1,
      underlying: { assetClass: "TREASURY", isin: "", figi: "", ticker: "", name: "US 3M T-Bill" },
      accountingMode: "FIXED_UNIT",
    });
    const share = instrumentIdentitySchema.parse({
      domain: { caip2: "eip155:8453", label: "Base" },
      canonicalRef: { kind: "evm", token: "0x3333333333333333333333333333333333333333" },
      issuer: { legalName: "Acme Issuer Ltd", jurisdiction: "KY" },
      standard: "ERC20",
      instrumentVersion: 1,
      underlying: { assetClass: "TREASURY", isin: "", figi: "", ticker: "", name: "US 3M T-Bill" },
      accountingMode: "SHARE_BASED",
    });
    expect(share.instrumentId).toBe(fixed.instrumentId);
  });
});

describe("ambiguity guards", () => {
  it("rejects a ticker-only underlying reference", () => {
    const r = underlyingReferenceSchema.safeParse({
      assetClass: "EQUITY",
      ticker: "NVDA",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/ticker alone/i);
    }
  });

  it("accepts an underlying anchored by name alone", () => {
    const r = underlyingReferenceSchema.safeParse({
      assetClass: "EQUITY",
      ticker: "NVDA",
      name: "NVIDIA Corporation",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown asset class and an unknown instrument standard", () => {
    expect(
      underlyingReferenceSchema.safeParse({ assetClass: "MEMECOIN", name: "x" }).success,
    ).toBe(false);
    expect(
      instrumentIdentitySchema.safeParse({
        domain: { caip2: "eip155:8453", label: "Base" },
        canonicalRef: { kind: "evm", token: "0x1111111111111111111111111111111111111111" },
        issuer: { legalName: "x", jurisdiction: "US" },
        standard: "ERC777",
        instrumentVersion: 1,
        underlying: { assetClass: "EQUITY", name: "Apple Inc" },
        accountingMode: "FIXED_UNIT",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-CAIP-2 domain string", () => {
    expect(
      instrumentIdentitySchema.safeParse({
        domain: { caip2: "Base Mainnet", label: "Base" },
        canonicalRef: { kind: "evm", token: "0x1111111111111111111111111111111111111111" },
        issuer: { legalName: "x", jurisdiction: "US" },
        standard: "ERC20",
        instrumentVersion: 1,
        underlying: { assetClass: "EQUITY", name: "Apple Inc" },
        accountingMode: "FIXED_UNIT",
      }).success,
    ).toBe(false);
  });

  it("rejects a rebase-bearing standard accounted as fixed units", () => {
    const r = instrumentIdentitySchema.safeParse({
      domain: { caip2: "eip155:1952", label: "X Layer testnet" },
      canonicalRef: { kind: "evm", token: "0x2222222222222222222222222222222222222222" },
      issuer: { legalName: "Backed Assets (JE) Limited", jurisdiction: "JE" },
      standard: "XSTOCKS_TRACKER_CERT",
      instrumentVersion: 1,
      underlying: { assetClass: "EQUITY", name: "Apple Inc" },
      accountingMode: "FIXED_UNIT",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an ATS security that is not externally managed", () => {
    const r = instrumentIdentitySchema.safeParse({
      domain: { caip2: "hedera:testnet", label: "Hedera testnet" },
      canonicalRef: { kind: "native", nativeId: "0.0.1234567" },
      issuer: { legalName: "Northstar Capital", jurisdiction: "US" },
      standard: "ATS_ERC1400",
      instrumentVersion: 1,
      underlying: { assetClass: "PRIVATE_CREDIT", name: "Northstar Treasury A" },
      accountingMode: "FIXED_UNIT",
    });
    expect(r.success).toBe(false);
  });
});

describe("binding resolution", () => {
  const mkBinding = (over: Partial<InstrumentBinding>): InstrumentBinding => ({
    bindingId: "0x0000000000000000000000000000000000000000000000000000000000000b01",
    legacyAssetId: "0x0000000000000000000000000000000000000000000000000000000000000a01",
    legacyAssetIdKind: "DERIVED",
    instrumentId: "0x0000000000000000000000000000000000000000000000000000000000001111",
    boundAt: 1_000,
    boundAtBlock: 0,
    boundBy: "test",
    boundAtDomain: "eip155:1952",
    deploymentDigest: "sha256:test",
    supersedes: `0x${"00".repeat(32)}`,
    note: "test binding",
    ...over,
  });

  it("returns null for an assetId we have not bound", () => {
    expect(
      resolveInstrument([mkBinding({})], "0x00000000000000000000000000000000000000000000000000000000dead0000"),
    ).toBeNull();
  });

  it("resolves a single binding to its instrument identity", () => {
    const r = resolveInstrument(
      [mkBinding({})],
      "0x0000000000000000000000000000000000000000000000000000000000000a01",
    );
    expect(r?.instrumentId).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000001111",
    );
    expect(r?.chain).toHaveLength(1);
  });

  it("walks a supersession chain and picks the binding active at a point in time", () => {
    const v1 = mkBinding({
      bindingId: "0x00000000000000000000000000000000000000000000000000000000000000b1",
      instrumentId: "0x0000000000000000000000000000000000000000000000000000000000001111",
      boundAt: 1_000,
    });
    const v2 = mkBinding({
      bindingId: "0x00000000000000000000000000000000000000000000000000000000000000b2",
      instrumentId: "0x0000000000000000000000000000000000000000000000000000000000002222",
      boundAt: 5_000,
      supersedes: "0x00000000000000000000000000000000000000000000000000000000000000b1",
      note: "issuer re-papered the wrapper",
    });
    const bindings = [v2, v1];
    expect(resolveInstrument(bindings, v1.legacyAssetId)?.instrumentId).toBe(v2.instrumentId);
    expect(resolveInstrument(bindings, v1.legacyAssetId, 3_000)?.instrumentId).toBe(v1.instrumentId);
    expect(resolveInstrument(bindings, v1.legacyAssetId, 6_000)?.instrumentId).toBe(v2.instrumentId);
    // Before any binding existed, the earliest identity is still the best available answer.
    expect(resolveInstrument(bindings, v1.legacyAssetId, 10)?.instrumentId).toBe(v1.instrumentId);
  });
});

describe("bindings artifact schema", () => {
  const instrument = {
    instrumentId: "0x2e027917b5015b8d8b5bbbb018f053ef6f0534f655a8f0a77b89502f11cd0746",
    domainId: domainId("eip155:8453"),
    caip2: "eip155:8453",
    canonicalRef: evmCanonicalRef("0x1111111111111111111111111111111111111111"),
    canonicalRefKind: "evm" as const,
    token: "0x1111111111111111111111111111111111111111",
    issuerId: issuerId("Coinbase, Inc.", "US"),
    issuerLegalName: "Coinbase, Inc.",
    issuerJurisdiction: "US",
    instrumentStandard: "B20" as const,
    instrumentStandardId: instrumentStandardId("B20"),
    instrumentVersion: 1,
    underlyingReferenceId: underlyingReferenceId({
      assetClass: "EQUITY",
      isin: "",
      figi: "",
      ticker: "AAPL",
      name: "apple inc",
    }),
    underlying: { assetClass: "EQUITY" as const, isin: "", figi: "", ticker: "AAPL", name: "apple inc" },
    accountingMode: "REBASING_BALANCE" as const,
  };

  const okArtifact = {
    $provenance: {
      generatedAt: "2026-09-06T00:00:00.000Z",
      generatedBy: "scripts/gen-instrument-bindings.mjs",
      gitCommit: "test",
      chainId: 1952,
      deploymentDigest: "0xabc",
      inputDigest: `0x${"11".repeat(32)}`,
      schema: 1 as const,
    },
    instruments: [instrument],
    bindings: [
      {
        bindingId: instrumentBindingId(
          "0x0000000000000000000000000000000000000000000000000000000000000a01",
          instrument.instrumentId as Hex32,
          1_756_900_000,
        ),
        legacyAssetId: "0x0000000000000000000000000000000000000000000000000000000000000a01",
        legacyAssetIdKind: "DERIVED" as const,
        instrumentId: instrument.instrumentId,
        boundAt: 1_756_900_000,
        boundAtBlock: 0,
        boundBy: "product-lock phase 01",
        boundAtDomain: "eip155:8453",
        deploymentDigest: "sha256:abc",
        supersedes: `0x${"00".repeat(32)}`,
        note: "migration record",
      },
    ],
  };

  it("accepts a well-formed artifact", () => {
    expect(instrumentBindingsArtifactSchema.safeParse(okArtifact).success).toBe(true);
  });

  it("rejects a binding that references an instrumentId not in `instruments`", () => {
    const bad = structuredClone(okArtifact);
    bad.bindings[0]!.instrumentId =
      "0x000000000000000000000000000000000000000000000000000000000000ffff";
    expect(instrumentBindingsArtifactSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects two root bindings for one legacyAssetId", () => {
    const bad = structuredClone(okArtifact);
    bad.bindings.push(structuredClone(bad.bindings[0]!));
    bad.bindings[1]!.bindingId =
      "0x000000000000000000000000000000000000000000000000000000000000cccc";
    expect(instrumentBindingsArtifactSchema.safeParse(bad).success).toBe(false);
  });
});

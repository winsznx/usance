import { describe, expect, it } from "vitest";
import { domainId, evmCanonicalRef, facilityId, facilityPositionId } from "../src/ids";
import {
  admissionProfileSchema,
  assertInstrumentIdentityComplete,
  assertValidFacilityTransition,
  capitalFacilityDescriptorSchema,
  facilityDescriptorsArtifactSchema,
} from "../src/facility";
import { instrumentIdentitySchema } from "../src/instrument";
import type { Hex32 } from "../src/primitives";

const XL_TESTNET = "eip155:1952";
const CH = "0xa38c072f7970d70f00c5ad9b911c222357255cc0";
const SETTLEMENT = "0xa2ef679d6d8194d6529915001547d13c39dc85b4b680673a909c408acf7b553f" as Hex32;

describe("facilityId derivation, pinned against cast", () => {
  const base = {
    facilityType: "REVOLVING_CREDIT",
    homeDomainId: domainId(XL_TESTNET),
    controller: evmCanonicalRef(CH),
    discriminator: SETTLEMENT,
  };

  it("matches keccak(abi.encode('USANCE_FACILITY_V1', type, homeDomainId, controller, discriminator))", () => {
    expect(facilityId(base)).toBe(
      "0xf0fe66befb70f33dfd3cf1440dd1d2618484e26699abf53c8ba645f46069af22",
    );
  });

  it("facilityType is part of the identity", () => {
    expect(facilityId({ ...base, facilityType: "REPO" })).toBe(
      "0x9e1514e5861d582046d71d96617b09ba0df5a3738054c1d1d3423741ee1cf900",
    );
    expect(facilityId({ ...base, facilityType: "REPO" })).not.toBe(facilityId(base));
  });

  it("the discriminator distinguishes facilities that share (type, domain, controller)", () => {
    const other = facilityId({
      ...base,
      discriminator: "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex32,
    });
    expect(other).toBe("0xeecc79ee93ab5bee2f9008f530b0a2205649af9f03391f3678921a58734660fe");
    expect(other).not.toBe(facilityId(base));
  });

  it("home domain is part of the identity — a different home domain is a different facility", () => {
    expect(facilityId({ ...base, homeDomainId: domainId("eip155:8453") })).not.toBe(facilityId(base));
  });

  it("a redeployed controller is a different facility (migration, not an edit)", () => {
    const redeployed = evmCanonicalRef("0x1111111111111111111111111111111111111111");
    expect(facilityId({ ...base, controller: redeployed })).not.toBe(facilityId(base));
  });

  it("facilityPositionId binds a facility and an account", () => {
    const acct = "0x000000000000000000000000000000000000000000000000000000000000a11c" as Hex32;
    expect(facilityPositionId(facilityId(base), acct)).toBe(
      "0x4bd68edd77e26e9c4200947fb2a8af3b3d53c8e0ec927ea670a0acc94f2cd9f7",
    );
  });
});

describe("CapitalFacilityDescriptor", () => {
  const revolvingCredit = {
    facilityType: "REVOLVING_CREDIT" as const,
    homeDomainCaip2: XL_TESTNET,
    controller: { kind: "evm" as const, address: CH },
    discriminator: SETTLEMENT,
    settlementAssetId: SETTLEMENT,
    status: "ACTIVE" as const,
    implementation: ["ClearingHouse", "CollateralVault", "FinancingEngine", "LiquidityVault"],
  };

  it("derives the facilityId from its identity-bearing fields", () => {
    const d = capitalFacilityDescriptorSchema.parse(revolvingCredit);
    expect(d.facilityId).toBe("0xf0fe66befb70f33dfd3cf1440dd1d2618484e26699abf53c8ba645f46069af22");
    expect(d.homeDomainId).toBe(domainId(XL_TESTNET));
  });

  it("one controller can hold two facilities without collision", () => {
    const a = capitalFacilityDescriptorSchema.parse(revolvingCredit);
    const b = capitalFacilityDescriptorSchema.parse({
      ...revolvingCredit,
      facilityType: "REPO",
      discriminator: "0x0000000000000000000000000000000000000000000000000000000000000009" as Hex32,
    });
    expect(a.facilityId).not.toBe(b.facilityId);
  });

  it("requires migratedTo exactly when MIGRATED", () => {
    expect(
      capitalFacilityDescriptorSchema.safeParse({ ...revolvingCredit, status: "MIGRATED" }).success,
    ).toBe(false);
    expect(
      capitalFacilityDescriptorSchema.safeParse({
        ...revolvingCredit,
        status: "MIGRATED",
        migratedTo: `0x${"ab".repeat(32)}`,
      }).success,
    ).toBe(true);
    expect(
      capitalFacilityDescriptorSchema.safeParse({
        ...revolvingCredit,
        status: "ACTIVE",
        migratedTo: `0x${"ab".repeat(32)}`,
      }).success,
    ).toBe(false);
  });
});

describe("assertValidFacilityTransition — I-75", () => {
  const parse = (over: Record<string, unknown>) =>
    capitalFacilityDescriptorSchema.parse({
      facilityType: "REVOLVING_CREDIT",
      homeDomainCaip2: XL_TESTNET,
      controller: { kind: "evm", address: CH },
      discriminator: SETTLEMENT,
      settlementAssetId: SETTLEMENT,
      status: "ACTIVE",
      ...over,
    });

  it("rejects a home-domain change on an ACTIVE facility — there is no setHomeDomain", () => {
    const prev = parse({});
    const next = parse({ homeDomainCaip2: "eip155:8453" });
    const r = assertValidFacilityTransition(prev, next);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/homedomain is frozen/i);
  });

  it("rejects a controller change on an ACTIVE facility", () => {
    const prev = parse({});
    const next = parse({ controller: { kind: "evm", address: "0x1111111111111111111111111111111111111111" } });
    expect(assertValidFacilityTransition(prev, next).ok).toBe(false);
  });

  it("allows a status change that keeps the identity fixed", () => {
    const prev = parse({});
    const next = parse({ status: "SUSPENDED" });
    expect(assertValidFacilityTransition(prev, next).ok).toBe(true);
  });

  it("permits any change while still DRAFT", () => {
    const prev = parse({ status: "DRAFT" });
    const next = parse({ status: "DRAFT", homeDomainCaip2: "eip155:8453" });
    expect(assertValidFacilityTransition(prev, next).ok).toBe(true);
  });

  it("SETTLED and MIGRATED are terminal", () => {
    const settled = parse({ status: "SETTLED" });
    expect(assertValidFacilityTransition(settled, parse({ status: "ACTIVE" })).ok).toBe(false);
  });
});

describe("assertInstrumentIdentityComplete — I-77", () => {
  const instrument = instrumentIdentitySchema.parse({
    domain: { caip2: "eip155:8453", label: "Base" },
    canonicalRef: { kind: "evm", token: "0x1111111111111111111111111111111111111111" },
    issuer: { legalName: "Coinbase, Inc.", jurisdiction: "US" },
    standard: "B20",
    instrumentVersion: 1,
    underlying: { assetClass: "EQUITY", isin: "", figi: "", ticker: "AAPL", name: "Apple Inc" },
    accountingMode: "REBASING_BALANCE",
  });

  const completeIdentity = {
    instrumentId: instrument.instrumentId,
    domainId: instrument.domain.domainId,
    issuerId: instrument.issuer.issuerId,
    underlyingReferenceId: instrument.underlying.underlyingReferenceId,
    instrumentStandard: instrument.standard,
    instrumentVersion: instrument.instrumentVersion,
    accountingMode: instrument.accountingMode,
  };

  it("LEGACY_V1 always passes, identity section optional", () => {
    expect(assertInstrumentIdentityComplete({ identity: undefined }, instrument, "LEGACY_V1").ok).toBe(true);
  });

  it("MULTI_DOMAIN_V2 rejects a candidate with no identity section", () => {
    const r = assertInstrumentIdentityComplete({ identity: undefined }, instrument, "MULTI_DOMAIN_V2");
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/requires the Passport Identity section/i);
  });

  it("MULTI_DOMAIN_V2 accepts a complete, matching identity section", () => {
    const r = assertInstrumentIdentityComplete({ identity: completeIdentity }, instrument, "MULTI_DOMAIN_V2");
    expect(r.ok).toBe(true);
  });

  it("MULTI_DOMAIN_V2 rejects an identity section that disagrees with the resolved instrument", () => {
    const r = assertInstrumentIdentityComplete(
      { identity: { ...completeIdentity, accountingMode: "FIXED_UNIT" } },
      instrument,
      "MULTI_DOMAIN_V2",
    );
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/accountingMode disagrees/i);
  });

  it("the result grants no capability — it is a pass/fail with reasons only", () => {
    const r = assertInstrumentIdentityComplete({ identity: completeIdentity }, instrument, "MULTI_DOMAIN_V2");
    expect(Object.keys(r).sort()).toEqual(["ok", "profile", "reasons"].sort());
  });

  it("admissionProfileSchema is a closed set", () => {
    expect(admissionProfileSchema.safeParse("SOMETHING_ELSE").success).toBe(false);
  });
});

describe("facility-descriptors artifact schema", () => {
  const domainRec = {
    domainId: domainId(XL_TESTNET),
    caip2: XL_TESTNET,
    label: "X Layer testnet",
    environment: "TESTNET" as const,
    finalityModel: { kind: "l2-sequencer" as const, safeDepthBlocks: 64, notes: "" },
    nativeAsset: { symbol: "OKB", decimals: 18 },
    explorerUrl: "https://www.oklink.com/x-layer-testnet",
    adapterVersions: {},
    status: "ACTIVE" as const,
  };
  const facilityRec = {
    facilityId: "0xf0fe66befb70f33dfd3cf1440dd1d2618484e26699abf53c8ba645f46069af22",
    facilityType: "REVOLVING_CREDIT" as const,
    homeDomainCaip2: XL_TESTNET,
    homeDomainId: domainId(XL_TESTNET),
    controllerRef: evmCanonicalRef(CH),
    controllerAddress: CH,
    discriminator: SETTLEMENT,
    settlementAssetId: SETTLEMENT,
    status: "ACTIVE" as const,
    implementation: ["ClearingHouse"],
    migratedTo: null,
    note: "",
  };
  const ok = {
    $provenance: {
      generatedAt: "x",
      generatedBy: "x",
      gitCommit: "x",
      chainId: 1952,
      deploymentDigest: null,
      inputDigest: `0x${"11".repeat(32)}`,
      schema: 1 as const,
    },
    domains: [domainRec],
    facilities: [facilityRec],
  };

  it("accepts a well-formed artifact", () => {
    expect(facilityDescriptorsArtifactSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects a facility whose home domain is not in `domains`", () => {
    const bad = structuredClone(ok);
    bad.facilities[0]!.homeDomainId = domainId("eip155:8453");
    expect(facilityDescriptorsArtifactSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a duplicate facilityId", () => {
    const bad = structuredClone(ok);
    bad.facilities.push(structuredClone(bad.facilities[0]!));
    expect(facilityDescriptorsArtifactSchema.safeParse(bad).success).toBe(false);
  });
});

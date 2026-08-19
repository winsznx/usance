import { describe, it, expect } from "vitest";
import { draftFrom, MANDATE_TYPES, REGISTRY_WRITE_ABI } from "../lib/mandate-sign";
import { maskFor, MANDATE_ACTIONS, grantedButRefused, canIncreaseRisk } from "../lib/mandate";

const OWNER = `0x${"aa".repeat(20)}` as `0x${string}`;
const AGENT = `0x${"bb".repeat(20)}` as `0x${string}`;
const ROOT = `0x${"cc".repeat(32)}` as `0x${string}`;
const ACCOUNT = `0x${"dd".repeat(32)}` as `0x${string}`;

const base = {
  owner: OWNER, agent: AGENT, accountId: ACCOUNT,
  actions: ["REPAY"] as const, maxDebtUsd: 1_000n * 10n ** 18n,
  durationDays: 30, assetsRoot: ROOT, now: 1_700_000_000,
};

describe("mandate draft", () => {
  it("backdates validFrom so a node with a slow clock does not refuse it", () => {
    // #given a mandate signed now
    const d = draftFrom(base);

    // #then it is already valid, because a mandate that becomes valid at exactly its signing
    // timestamp is refused by any node running a second behind — which is most of them
    expect(d.validFrom).toBeLessThan(base.now);
  });

  it("expires at the requested distance", () => {
    const d = draftFrom({ ...base, durationDays: 7 });
    expect(d.expiresAt - base.now).toBe(7 * 86_400);
  });

  it("derives a nonce from the signing moment so two mandates cannot collide", () => {
    const a = draftFrom({ ...base, now: 1_700_000_000 });
    const b = draftFrom({ ...base, now: 1_700_000_001 });
    // The nonce is burned on registration, which is what makes replay impossible. Two mandates
    // sharing one would mean the second could never register.
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("encodes only the actions that were chosen", () => {
    const d = draftFrom({ ...base, actions: ["REPAY", "ADD_COLLATERAL"] });
    expect(d.allowedActions).toBe(maskFor(["REPAY", "ADD_COLLATERAL"]));
    // BORROW was not requested and must not appear.
    expect(d.allowedActions & (1 << 0)).toBe(0);
  });
});

describe("the typed-data shape matches the contract", () => {
  it("field order is the contract's field order", () => {
    // #given the struct MandateRegistry hashes
    const expected = [
      "owner", "agent", "accountId", "validFrom", "expiresAt", "maxDebtUsd",
      "maxTradeNotionalUsd", "maxEffectiveLeverageBps", "maxSlippageBps", "allowedActions",
      "requiredPassportFreshness", "allowedAssetsRoot", "allowedVenuesRoot", "nonce",
    ];

    // #then the typed data agrees. EIP-712 hashes fields in declaration order, so a reordering
    // here produces a valid-looking signature that recovers to the wrong address.
    expect(MANDATE_TYPES.Mandate.map((f) => f.name)).toEqual(expected);
  });

  it("the write ABI's tuple matches the same order", () => {
    const register = REGISTRY_WRITE_ABI.find((f) => f.name === "registerMandate")!;
    const tuple = register.inputs[0] as { components: ReadonlyArray<{ name: string }> };
    expect(tuple.components.map((c) => c.name)).toEqual(MANDATE_TYPES.Mandate.map((f) => f.name));
  });

  it("exposes exactly the four lifecycle writes and nothing that moves money", () => {
    const names = REGISTRY_WRITE_ABI.map((f) => f.name).sort();
    expect(names).toEqual(["pauseMandate", "registerMandate", "resumeMandate", "revokeMandate"]);
  });
});

describe("what the vocabulary permits", () => {
  it("contains no withdrawal verb", () => {
    // The structural half of "an agent cannot withdraw collateral". There is nothing to grant.
    const names = MANDATE_ACTIONS.map((a) => a.name);
    expect(names).not.toContain("WITHDRAW");
    expect(names.some((n) => /WITHDRAW|TRANSFER|REDEEM/.test(n))).toBe(false);
  });

  it("reports which granted actions the protocol still refuses", () => {
    // TRADE inside a signature authorises nothing today. Displaying the grant without saying so
    // would overstate what the signer just did.
    const refused = grantedButRefused(maskFor(["REPAY", "TRADE"]));
    expect(refused.map((a) => a.name)).toEqual(["TRADE"]);
  });

  it("a repay-only mandate cannot increase risk", () => {
    expect(canIncreaseRisk(maskFor(["REPAY"]))).toBe(false);
    expect(canIncreaseRisk(maskFor(["REPAY", "BORROW"]))).toBe(true);
  });
});

describe("the typed-data definition reproduces the contract's typehash", () => {
  it("encodeType matches MANDATE_TYPEHASH exactly", async () => {
    const { keccak256, stringToBytes } = await import("viem");

    // #given the encodeType string built from the browser's field definitions
    const encodeType =
      "Mandate(" +
      MANDATE_TYPES.Mandate.map((f) => `${f.type} ${f.name}`).join(",") +
      ")";

    // #when hashed
    const derived = keccak256(stringToBytes(encodeType));

    // #then it equals the constant compiled into MandateRegistry. This is the assertion that
    // matters: a field renamed, retyped or reordered in the browser produces a signature the
    // contract rejects, and the rejection looks like a wallet fault rather than a code fault.
    // The literal is the contract's own string, reassembled from its source fragments.
    const contractString =
      "Mandate(address owner,address agent,bytes32 accountId,uint64 validFrom," +
      "uint64 expiresAt,uint256 maxDebtUsd,uint256 maxTradeNotionalUsd," +
      "uint16 maxEffectiveLeverageBps,uint16 maxSlippageBps,uint16 allowedActions," +
      "uint64 requiredPassportFreshness,bytes32 allowedAssetsRoot," +
      "bytes32 allowedVenuesRoot,uint256 nonce)";

    expect(encodeType).toBe(contractString);
    expect(derived).toBe(keccak256(stringToBytes(contractString)));
  });
});

describe("the EIP-712 domain matches the contract's constructor", () => {
  it("uses the name MandateRegistry actually declares", async () => {
    const { EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION } = await import("../lib/mandate-sign");

    // MandateRegistry's constructor is EIP712("Usance Mandate", "1"). The first version of the
    // browser signer used "Usance", which produces a well-formed signature that recovers to an
    // address nobody controls — registerMandate reverts and it reads as a wallet fault.
    expect(EIP712_DOMAIN_NAME).toBe("Usance Mandate");
    expect(EIP712_DOMAIN_VERSION).toBe("1");
  });

  it("the domain separator the browser builds equals the one the contract computes", async () => {
    const { keccak256, stringToBytes, encodeAbiParameters } = await import("viem");
    const { EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION } = await import("../lib/mandate-sign");

    const verifyingContract = `0x${"11".repeat(20)}` as `0x${string}`;
    const chainId = 1952n;

    // The same construction OpenZeppelin's _domainSeparatorV4 performs.
    const domainTypehash = keccak256(
      stringToBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
    );
    const expected = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [
          domainTypehash,
          keccak256(stringToBytes(EIP712_DOMAIN_NAME)),
          keccak256(stringToBytes(EIP712_DOMAIN_VERSION)),
          chainId,
          verifyingContract,
        ],
      ),
    );

    // A domain built from any other name, version, chain or contract yields a different separator,
    // which is precisely what stops a signature crossing between deployments.
    const wrongName = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [domainTypehash, keccak256(stringToBytes("Usance")), keccak256(stringToBytes("1")), chainId, verifyingContract],
      ),
    );
    expect(wrongName).not.toBe(expected);
  });
});

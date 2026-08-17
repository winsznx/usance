import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUILDER_CODE,
  ERC8021_MARKER,
  BuilderCodeError,
  decodeBuilderCodes,
  encodeBuilderSuffix,
  hasBuilderSuffix,
  withBuilderCode,
} from "../src/builder-code";
import { addChainParams, chainById, isXLayer, xLayerMainnet, xLayerTestnet } from "../src/chains";

describe("ERC-8021 builder codes", () => {
  it("matches the worked example from the specification", () => {
    // "baseapp" is 7 bytes: 62 61 73 65 61 70 70
    const suffix = encodeBuilderSuffix("baseapp");
    expect(suffix).toBe(`0762617365617070` + `00` + ERC8021_MARKER);
  });

  it("encodes the Usance code with a correct length prefix", () => {
    const suffix = encodeBuilderSuffix("usance");
    // 6 bytes, ASCII "usance" = 75 73 61 6e 63 65
    expect(suffix.startsWith("067573616e6365")).toBe(true);
    expect(suffix.endsWith(ERC8021_MARKER)).toBe(true);
    expect(suffix.length / 2).toBe(1 + 6 + 1 + 16);
  });

  it("appends to calldata without disturbing the original bytes", () => {
    const call = "0xa9059cbb0000000000000000000000001111111111111111111111111111111111111111";
    const out = withBuilderCode(call as `0x${string}`, "usance");
    expect(out.startsWith(call)).toBe(true);
    expect(hasBuilderSuffix(out)).toBe(true);
  });

  it("round-trips the code back out of calldata", () => {
    const call = "0x095ea7b3" + "00".repeat(64);
    const out = withBuilderCode(`0x${call.slice(2)}` as `0x${string}`, "usance");
    expect(decodeBuilderCodes(out)).toEqual(["usance"]);
  });

  it("is idempotent — wrapping twice does not double the suffix", () => {
    const call = "0x70a08231" + "00".repeat(32);
    const once = withBuilderCode(call as `0x${string}`);
    const twice = withBuilderCode(once);
    expect(twice).toBe(once);
  });

  it("returns null for calldata carrying no attribution", () => {
    expect(decodeBuilderCodes("0xa9059cbb" + "11".repeat(64))).toBeNull();
    expect(hasBuilderSuffix("0x")).toBe(false);
  });

  it("rejects non-ASCII and empty codes rather than emitting an unparseable suffix", () => {
    expect(() => encodeBuilderSuffix("usancé")).toThrow(BuilderCodeError);
    expect(() => encodeBuilderSuffix("")).toThrow(BuilderCodeError);
  });

  it("rejects malformed calldata", () => {
    expect(() => withBuilderCode("nothex" as `0x${string}`)).toThrow(BuilderCodeError);
    expect(() => withBuilderCode("0xabc" as `0x${string}`)).toThrow(BuilderCodeError);
  });

  it("defaults to the Usance code", () => {
    expect(decodeBuilderCodes(withBuilderCode("0xdeadbeef"))).toEqual([DEFAULT_BUILDER_CODE]);
  });
});

describe("X Layer chain configuration", () => {
  it("uses the verified chain ids", () => {
    expect(xLayerMainnet.id).toBe(196);
    expect(xLayerTestnet.id).toBe(1952);
  });

  it("carries the verified LayerZero V2 endpoint ids", () => {
    expect(xLayerMainnet.layerZeroEid).toBe(30274);
    expect(xLayerTestnet.layerZeroEid).toBe(40269);
  });

  it("produces wallet_addEthereumChain parameters with a hex chain id", () => {
    const p = addChainParams(xLayerMainnet);
    expect(p.chainId).toBe("0xc4");
    expect(p.rpcUrls[0]).toMatch(/^https:\/\//);
    expect(p.blockExplorerUrls[0]).toContain("oklink");
  });

  it("recognises only X Layer networks", () => {
    expect(isXLayer(196)).toBe(true);
    expect(isXLayer(1952)).toBe(true);
    expect(isXLayer(1)).toBe(false);
    expect(isXLayer(undefined)).toBe(false);
    expect(chainById(999)).toBeUndefined();
  });
});

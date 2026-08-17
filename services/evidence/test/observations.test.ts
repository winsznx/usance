import { describe, expect, it } from "vitest";
import { observationSchema, SourceClass, type Observation } from "@usance/schemas";
import { ObservationNotLowTrust, reviewActionsFor } from "../src/observations";
import { LowTrustSourceRejected, ingest } from "../src/ingest";
import { InMemoryObjectStore } from "../src/store";
import { loadFixture } from "../src/fixtures";

const WATCHED = [`0x${"aa".repeat(32)}`] as const;

function newsItem(headline: string): Observation {
  return observationSchema.parse({
    observationId: `chaingpt-news:${headline.length}`,
    sourceClass: SourceClass.NEWS,
    headline,
    uri: "https://api.chaingpt.org/news#1",
    observedAt: 1_786_987_000,
    assetIds: [],
  });
}

/**
 * A news observation may make Usance more cautious about an asset. It may never make Usance lend more
 * against one. These tests check that asymmetry at every point an observation could leak into the
 * claim-bearing path.
 */
describe("observations", () => {
  it("produces only restrictive or neutral actions", () => {
    const actions = reviewActionsFor(
      [
        newsItem("Issuer suspends redemptions for its tokenized treasury fund"),
        newsItem("Stablecoin market cap reaches a new high"),
        newsItem("Regulator opens review of a tokenized money market fund"),
      ],
      { watchedAssetIds: [...WATCHED] },
    );

    expect(actions).toHaveLength(3);
    for (const a of actions) expect(["REVIEW_REQUIRED", "PASSPORT_REFRESH"]).toContain(a.action);
  });

  it("routes a redemption or suspension headline to a re-read of the authoritative source", () => {
    const [suspended, neutral] = reviewActionsFor(
      [newsItem("Issuer halts redemptions"), newsItem("Conference announced for next quarter")],
      { watchedAssetIds: [...WATCHED] },
    );

    expect(suspended!.action).toBe("PASSPORT_REFRESH");
    expect(suspended!.reason).toMatch(/re-read the authoritative source/);
    expect(neutral!.action).toBe("REVIEW_REQUIRED");
  });

  it("carries no claim, no value and no limit", () => {
    const [action] = reviewActionsFor([newsItem("Issuer halts redemptions")], {
      watchedAssetIds: [...WATCHED],
    });

    // The shape is the guarantee. There is no field an action could put a number into, so there is
    // nothing a downstream consumer could read as permission.
    expect(Object.keys(action!).sort()).toEqual(
      ["action", "assetIds", "headline", "observationId", "observedAt", "reason", "uri"].sort(),
    );

    // The only number an action carries is the time it was observed. There is no basis-point field,
    // no boolean and no value slot, so nothing here can express a limit even by accident.
    const numeric = Object.entries(action!).filter(([, v]) => typeof v === "number");
    expect(numeric.map(([k]) => k)).toEqual(["observedAt"]);
    expect(Object.values(action!).some((v) => typeof v === "boolean")).toBe(false);
  });

  it("takes asset association from the operator's watchlist, never from the headline", () => {
    const [action] = reviewActionsFor([newsItem("FOBXX something happened")], {
      watchedAssetIds: [...WATCHED],
    });
    // Mapping a headline to an asset is an inference, and an inference made here would be
    // indistinguishable downstream from a verified association.
    expect(action!.assetIds).toEqual([...WATCHED]);
  });

  it("refuses an observation carrying a class that is not low-trust", () => {
    const smuggled = {
      observationId: "smuggled",
      // A caller reaching past the schema, which is exactly the case the runtime assert is for.
      sourceClass: SourceClass.ISSUER_SIGNED,
      headline: "Issuer attests to a 100% redemption floor",
      uri: "https://example.test/x",
      observedAt: 1_786_987_000,
      assetIds: [],
    } as unknown as Observation;

    expect(() => reviewActionsFor([smuggled], { watchedAssetIds: [] })).toThrow(ObservationNotLowTrust);
  });

  it("a low-trust class cannot re-enter through ingest either", async () => {
    // The other half of the containment. Even with real bytes and a correct source hash, a document
    // labelled NEWS is refused as claim-bearing evidence, so there is no route from the observation
    // channel into the Passport builder.
    const { entry, bytes } = await loadFixture("franklin-fobxx-2025");
    const store = new InMemoryObjectStore();

    await expect(
      ingest(
        {
          uri: entry.uri,
          issuerId: entry.issuer.issuerId,
          sourceClass: SourceClass.NEWS,
          bytes,
          mediaType: entry.mediaType,
          retrievedAt: entry.retrievedAt,
          effectiveAt: entry.effectiveAt,
          assertedSourceHash: entry.sourceHash,
        },
        store,
      ),
    ).rejects.toBeInstanceOf(LowTrustSourceRejected);
  });
});

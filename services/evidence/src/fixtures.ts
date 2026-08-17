import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { hex32Schema, sourceClassSchema, unixSecondsSchema, type Hex32 } from "@usance/schemas";
import { objectKey } from "./store";

/**
 * The fixture manifest and its loader.
 *
 * Fixtures in this package are real documents fetched from real origins, and the manifest is the record
 * of that fetch: URI, HTTP status, retrieval time, media type, and both digests. A loader that read the
 * bytes without checking them would make the manifest decorative, so `loadFixture` recomputes
 * `rawDigest` and refuses a mismatch. That check is the same one the object store makes and the same
 * one `ingest` makes about `sourceHash` — a fixture is not a special case.
 *
 * `isDerived` is the field that matters most. A derived fixture is one Usance modified, and every
 * entry carrying `isDerived: true` must also say what was changed and why. The adversarial fixture in
 * this package is a real SEC filing with a synthetic appendix, and it is labelled in three independent
 * places: the filename prefix, an HTML comment and a visible paragraph inside the document, and this
 * manifest field. Nobody reading any one of them can mistake it for something the issuer published.
 */

const fixtureEntrySchema = z
  .object({
    id: z.string().min(1),
    file: z.string().min(1),
    /** Human-readable, for the reviewer UI and for a receipt. */
    title: z.string().min(1),
    uri: z.string().url(),
    httpStatus: z.number().int(),
    /** As reported by the origin's Content-Type. */
    contentType: z.string().min(1),
    /** Normalised container the decoder dispatches on. */
    mediaType: z.string().min(1),
    bytes: z.number().int().positive(),
    retrievedAt: unixSecondsSchema,
    effectiveAt: unixSecondsSchema,
    effectiveAtBasis: z.string().min(1),
    sourceClass: sourceClassSchema,
    sourceClassName: z.string().min(1),
    issuer: z.object({
      legalName: z.string().min(1),
      jurisdiction: z.string().min(1),
      issuerId: hex32Schema,
    }),
    /** `keccak256` of the bytes exactly as fetched. Verified by the loader on every read. */
    rawDigest: hex32Schema,
    /** `keccak256(canonicalBytes(decodeToText(raw)))` — what a Passport commits to. */
    contentHash: hex32Schema,
    sourceHash: hex32Schema,
    evidenceId: hex32Schema,
    isDerived: z.boolean(),
    derivedFrom: z.string().nullable(),
    derivationNote: z.string().nullable(),
    notes: z.string(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.isDerived && (e.derivedFrom === null || e.derivationNote === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["derivationNote"],
        message: "a derived fixture must record what it was derived from and what was changed",
      });
    }
  });

export type FixtureEntry = z.infer<typeof fixtureEntrySchema>;

const failedFetchSchema = z
  .object({
    uri: z.string().min(1),
    httpStatus: z.number().int(),
    outcome: z.string().min(1),
    note: z.string().min(1),
  })
  .strict();

export const fixtureManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    generatedAt: unixSecondsSchema,
    canonicalizerVersion: z.string().min(1),
    mediaDecoderVersion: z.string().min(1),
    fetchTool: z.string().min(1),
    documents: z.array(fixtureEntrySchema).min(1),
    /**
     * Fetches that did not yield a document.
     *
     * Recorded rather than dropped. "We tried the issuer's own site and got a 403 or a JavaScript
     * shell" is a real finding about how obtainable primary sources are, and deleting the failures
     * would make the successes look like the whole story.
     */
    failedFetches: z.array(failedFetchSchema),
  })
  .strict();

export type FixtureManifest = z.infer<typeof fixtureManifestSchema>;

export class FixtureDigestMismatch extends Error {
  constructor(readonly id: string, readonly expected: Hex32, readonly actual: Hex32) {
    super(
      `fixture ${id}: manifest records rawDigest ${expected}, file hashes to ${actual}. ` +
        "The bytes on disk are not the bytes that were fetched.",
    );
    this.name = "FixtureDigestMismatch";
  }
}

/** Absolute path to `services/evidence/fixtures`, resolved from this module rather than from cwd. */
export function fixturesDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
}

export async function loadManifest(dir: string = fixturesDir()): Promise<FixtureManifest> {
  const raw = await readFile(join(dir, "manifest.json"), "utf8");
  return fixtureManifestSchema.parse(JSON.parse(raw));
}

export interface LoadedFixture {
  readonly entry: FixtureEntry;
  readonly bytes: Uint8Array;
}

export async function loadFixture(id: string, dir: string = fixturesDir()): Promise<LoadedFixture> {
  const manifest = await loadManifest(dir);
  const entry = manifest.documents.find((d) => d.id === id);
  if (!entry) throw new Error(`no fixture "${id}" in the manifest`);

  const buf = await readFile(join(dir, entry.file));
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

  const actual = objectKey(bytes);
  if (actual !== entry.rawDigest) throw new FixtureDigestMismatch(id, entry.rawDigest, actual);

  return { entry, bytes };
}

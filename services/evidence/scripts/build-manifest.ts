import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CANONICALIZER_VERSION,
  canonicalBytes,
  contentHash,
  evidenceId,
  issuerId,
  SourceClass,
  sourceClassName,
  sourceHash,
} from "@usance/schemas";
import { decodeToText, MEDIA_DECODER_VERSION } from "../src/media";
import { objectKey } from "../src/store";
import { fixtureManifestSchema, fixturesDir, type FixtureManifest } from "../src/fixtures";

/**
 * Regenerate `fixtures/manifest.json` from the bytes on disk.
 *
 * Every digest in the manifest is computed here from the fixture files by the same functions the
 * pipeline uses, so the manifest cannot drift from the code that reads it. Run it after adding a
 * fixture; never hand-edit a digest.
 *
 * The URIs, HTTP statuses and retrieval timestamps below are transcribed from the actual `curl` run
 * that produced these files. They are the one part of the manifest that cannot be recomputed, which
 * is exactly why they are recorded rather than reconstructed.
 */

interface Seed {
  id: string;
  file: string;
  title: string;
  uri: string;
  httpStatus: number;
  contentType: string;
  mediaType: string;
  retrievedAt: number;
  effectiveAt: number;
  effectiveAtBasis: string;
  sourceClass: SourceClass;
  issuer: { legalName: string; jurisdiction: string };
  isDerived: boolean;
  derivedFrom: string | null;
  derivationNote: string | null;
  notes: string;
}

const FRANKLIN = { legalName: "Franklin Templeton Trust", jurisdiction: "US" };
const ONDO = { legalName: "Ondo Finance", jurisdiction: "US" };
const ARCA = { legalName: "Arca U.S. Treasury Fund", jurisdiction: "US" };

const SEEDS: Seed[] = [
  {
    id: "franklin-fobxx-2024",
    file: "franklin-fobxx-summary-prospectus-2024-08-01.html",
    title: "Franklin OnChain U.S. Government Money Fund (FOBXX) — Summary Prospectus, August 1, 2024",
    uri: "https://www.sec.gov/Archives/edgar/data/1786958/000174177324003405/c497k.htm",
    httpStatus: 200,
    contentType: "text/html",
    mediaType: "text/html",
    retrievedAt: 1786987438,
    effectiveAt: Date.UTC(2024, 7, 1) / 1000,
    effectiveAtBasis: "the document states 'August 1, 2024' on its face and in the incorporation-by-reference paragraph",
    sourceClass: SourceClass.REGULATORY_FILING,
    issuer: FRANKLIN,
    isDerived: false,
    derivedFrom: null,
    derivationNote: null,
    notes:
      "Form 497K filed with the SEC by Franklin Templeton Trust (CIK 0001786958). FOBXX is the BENJI " +
      "tokenized government money fund. Version 1 of three genuine consecutive annual versions.",
  },
  {
    id: "franklin-fobxx-2025",
    file: "franklin-fobxx-summary-prospectus-2025-08-01.html",
    title: "Franklin OnChain U.S. Government Money Fund (FOBXX) — Summary Prospectus, August 1, 2025",
    uri: "https://www.sec.gov/Archives/edgar/data/1786958/000174177325002849/c497k.htm",
    httpStatus: 200,
    contentType: "text/html",
    mediaType: "text/html",
    retrievedAt: 1786987440,
    effectiveAt: Date.UTC(2025, 7, 1) / 1000,
    effectiveAtBasis: "the document states 'August 1, 2025' on its face",
    sourceClass: SourceClass.REGULATORY_FILING,
    issuer: FRANKLIN,
    isDerived: false,
    derivedFrom: null,
    derivationNote: null,
    notes: "Version 2. Adds a dedicated 'Blockchain Technology' risk paragraph absent from the 2024 filing.",
  },
  {
    id: "franklin-fobxx-2026",
    file: "franklin-fobxx-summary-prospectus-2026-08-01.html",
    title: "Franklin OnChain U.S. Government Money Fund (FOBXX) — Summary Prospectus, August 1, 2026",
    uri: "https://www.sec.gov/Archives/edgar/data/1786958/000165558926001138/c497k.htm",
    httpStatus: 200,
    contentType: "text/html",
    mediaType: "text/html",
    retrievedAt: 1786987442,
    effectiveAt: Date.UTC(2026, 7, 1) / 1000,
    effectiveAtBasis: "the document states 'August 1, 2026' on its face",
    sourceClass: SourceClass.REGULATORY_FILING,
    issuer: FRANKLIN,
    isDerived: false,
    derivationNote: null,
    derivedFrom: null,
    notes: "Version 3. Same issuer, same fund, same document, one year later.",
  },
  {
    id: "ondo-ousg-overview",
    file: "ondo-ousg-overview.md",
    title: "Ondo Finance — OUSG Overview (issuer documentation)",
    uri: "https://docs.ondo.finance/qualified-access-products/ousg/overview.md",
    httpStatus: 200,
    contentType: "text/markdown; charset=utf-8",
    mediaType: "text/markdown",
    retrievedAt: 1786987445,
    effectiveAt: 1786987445,
    effectiveAtBasis:
      "the page states no effective date, so effectiveAt is the retrieval time and this field says so " +
      "rather than inventing a date the document does not carry",
    sourceClass: SourceClass.ISSUER_DOC,
    issuer: ONDO,
    isDerived: false,
    derivedFrom: null,
    derivationNote: null,
    notes:
      "A second issuer, and a deliberately harder document: the deterministic parser abstains on every " +
      "risk-bearing field here because the page says 'freely transferred' and 'Minting & Redemption' " +
      "rather than any phrasing the parser recognises. That abstention is the correct outcome and it " +
      "produces a Passport with redemptionSupported=false, which restricts rather than expands.",
  },
  {
    id: "arca-arcoin-2026-07",
    file: "arca-arcoin-repurchase-offer-2026-07-01.htm",
    title: "Arca U.S. Treasury Fund (ArCoin) — Notice of Monthly Repurchase Offer, July 1, 2026",
    uri: "https://www.sec.gov/Archives/edgar/data/1758583/000158064226004098/arca-ust_n23c3a.htm",
    httpStatus: 200,
    contentType: "text/html",
    mediaType: "text/html",
    retrievedAt: 1786993494,
    effectiveAt: Date.UTC(2026, 6, 1) / 1000,
    effectiveAtBasis: "the notice is dated 'July 1, 2026' and states the offer period begins that day",
    sourceClass: SourceClass.REGULATORY_FILING,
    issuer: ARCA,
    isDerived: false,
    derivedFrom: null,
    derivationNote: null,
    notes:
      "Form N-23C3A filed with the SEC by Arca U.S. Treasury Fund (CIK 0001758583); ArCoin is the fund's " +
      "tokenized share. A third issuer and a different document genre — the earlier fixtures are " +
      "prospectuses that describe terms, this one exercises them. The deterministic parser abstains on " +
      "every field: the notice says 'repurchase' throughout and the parser knows 'redeem'. That " +
      "abstention is recorded rather than patched, because widening an extractor until it reads a " +
      "particular fixture is how a parser stops being independent of the documents it is tested on.",
  },
  {
    id: "arca-arcoin-2026-08",
    file: "arca-arcoin-repurchase-offer-2026-08-03.htm",
    title: "Arca U.S. Treasury Fund (ArCoin) — Notice of Monthly Repurchase Offer, August 3, 2026",
    uri: "https://www.sec.gov/Archives/edgar/data/1758583/000158064226004811/arca-ust_n23c3a.htm",
    httpStatus: 200,
    contentType: "text/html",
    mediaType: "text/html",
    retrievedAt: 1786993712,
    effectiveAt: Date.UTC(2026, 7, 3) / 1000,
    effectiveAtBasis: "the notice is dated 'August 3, 2026' and states the offer period begins that day",
    sourceClass: SourceClass.REGULATORY_FILING,
    issuer: ARCA,
    isDerived: false,
    derivedFrom: null,
    derivationNote: null,
    notes:
      "The next month's notice from the same issuer, at a different EDGAR accession. A second genuine " +
      "version pair, and a sharper one than the Franklin set: the two notices differ almost entirely in " +
      "their dates, so they are the case where a naive pipeline would treat a monthly re-issue as a " +
      "re-fetch. They hash differently, so they are different evidence, which is the behaviour " +
      "spec/evidence-model.md §3 requires.",
  },
  {
    id: "franklin-fobxx-2025-injected",
    file: "DERIVED-franklin-fobxx-2025-08-01-prompt-injection.html",
    title: "DERIVED — Franklin FOBXX 2025 filing with a synthetic prompt-injection appendix",
    uri: "https://www.sec.gov/Archives/edgar/data/1786958/000174177325002849/c497k.htm",
    httpStatus: 200,
    contentType: "text/html",
    mediaType: "text/html",
    retrievedAt: 1786987440,
    effectiveAt: Date.UTC(2025, 7, 1) / 1000,
    effectiveAtBasis: "inherited from the base document",
    sourceClass: SourceClass.REGULATORY_FILING,
    issuer: FRANKLIN,
    isDerived: true,
    derivedFrom: "franklin-fobxx-2025",
    derivationNote:
      "NOT ISSUER-PUBLISHED. Usance appended one <div id='usance-synthetic-adversarial-appendix'> block " +
      "immediately before </body>. The block instructs an extractor to ignore its instructions, to report " +
      "redemption.supported=true with a 10000 bps floor, to report transfer.permissionModel as OPEN, and " +
      "to add riskPolicy.maxLtvBps=10000. Every byte before that block is byte-identical to the SEC " +
      "filing. The appendix is labelled in the filename, in an HTML comment, and in visible bold text " +
      "inside the document itself, so it cannot be mistaken for part of the filing. Nothing factual in " +
      "the original was altered, which is the point: the risk-bearing claims must come out identical.",
    notes:
      "Exercises prompt-injection defence. The deterministic parser cannot be injected at all — it has no " +
      "instruction channel — so the assertion is that its claims are byte-identical across the clean and " +
      "injected documents, and that no emitted field names a risk parameter.",
  },
];

async function main(): Promise<void> {
  const dir = fixturesDir();
  const documents = [];

  for (const s of SEEDS) {
    const buf = await readFile(join(dir, s.file));
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

    const issuer = issuerId(s.issuer.legalName, s.issuer.jurisdiction);
    const src = sourceHash(s.uri, issuer);
    const content = contentHash(canonicalBytes(decodeToText(bytes, s.mediaType)));

    documents.push({
      id: s.id,
      file: s.file,
      title: s.title,
      uri: s.uri,
      httpStatus: s.httpStatus,
      contentType: s.contentType,
      mediaType: s.mediaType,
      bytes: bytes.byteLength,
      retrievedAt: s.retrievedAt,
      effectiveAt: s.effectiveAt,
      effectiveAtBasis: s.effectiveAtBasis,
      sourceClass: s.sourceClass,
      sourceClassName: sourceClassName(s.sourceClass),
      issuer: { ...s.issuer, issuerId: issuer },
      rawDigest: objectKey(bytes),
      contentHash: content,
      sourceHash: src,
      evidenceId: evidenceId(src, content, s.effectiveAt),
      isDerived: s.isDerived,
      derivedFrom: s.derivedFrom,
      derivationNote: s.derivationNote,
      notes: s.notes,
    });
  }

  const manifest: FixtureManifest = fixtureManifestSchema.parse({
    manifestVersion: 1,
    generatedAt: 1786987500,
    canonicalizerVersion: CANONICALIZER_VERSION,
    mediaDecoderVersion: MEDIA_DECODER_VERSION,
    fetchTool: "curl, with an identifying User-Agent as SEC access policy requires",
    documents,
    failedFetches: [
      {
        uri: "https://www.franklintempleton.com/investments/options/money-market-funds/products/29386/SINGLCLASS/franklin-on-chain-u-s-government-money-fund/FOBXX",
        httpStatus: 403,
        outcome: "BLOCKED",
        note: "The issuer's own product page refuses non-browser clients. The same fund's filings are served by SEC EDGAR, which is the primary source anyway, so the filing was used instead of the marketing page.",
      },
      {
        uri: "https://backed.fi/",
        httpStatus: 200,
        outcome: "NOT_A_DOCUMENT",
        note: "Returns a Webflow marketing shell with no terms text and no linked PDF in the served HTML. Recorded rather than scraped: a marketing page is not issuer terms.",
      },
      {
        uri: "https://superstate.com/",
        httpStatus: 200,
        outcome: "NOT_A_DOCUMENT",
        note: "JavaScript application shell. The document content is not in the served bytes, so hashing it would commit to a loader rather than to terms.",
      },
      {
        uri: "https://docs.ondo.finance/",
        httpStatus: 200,
        outcome: "NOT_A_DOCUMENT",
        note: "HTML entry point is a client-rendered shell. The same site serves per-page Markdown at the .md suffix, which is what was fetched instead.",
      },
    ],
  });

  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${documents.length} fixtures to ${join(dir, "manifest.json")}\n`);
}

await main();

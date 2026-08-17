/**
 * Media decoding: container bytes in, plain text out.
 *
 * This is NOT a canonicaliser. `canonicalizeText` in `@usance/schemas` is the one canonicaliser and
 * every path here hands its output straight to it. What this module does is strictly earlier: an SEC
 * filing arrives as HTML and a documentation page arrives as Markdown, and neither is text until
 * somebody decides what the markup means. That decision has to be deterministic and versioned for
 * the same reason canonicalisation does, because it also sits inside `contentHash`.
 *
 * The version is separate from `CANONICALIZER_VERSION` on purpose. A change to tag handling
 * invalidates hashes of HTML documents and leaves plain-text hashes untouched, so collapsing the two
 * versions would overstate the blast radius of either change.
 */

export const MEDIA_DECODER_VERSION = "usance-media/1" as const;

/** Media types this module can turn into text. Anything else is refused rather than guessed at. */
export const SUPPORTED_MEDIA_TYPES = ["text/plain", "text/markdown", "text/html"] as const;

export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export class UnsupportedMediaType extends Error {
  constructor(readonly mediaType: string) {
    super(
      `no decoder for media type "${mediaType}"; supported: ${SUPPORTED_MEDIA_TYPES.join(", ")}. ` +
        "A document Usance cannot read deterministically is not ingested at all — guessing at the " +
        "container would put an unreproducible contentHash onchain.",
    );
    this.name = "UnsupportedMediaType";
  }
}

/**
 * Strip the parameters off a Content-Type.
 *
 * `text/markdown; charset=utf-8` and `text/markdown` are the same container. Keeping the parameter
 * in the key would make the same document decode under two different names depending on which
 * server served it.
 */
export function baseMediaType(mediaType: string): string {
  const semi = mediaType.indexOf(";");
  return (semi < 0 ? mediaType : mediaType.slice(0, semi)).trim().toLowerCase();
}

export function isSupportedMediaType(mediaType: string): mediaType is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(baseMediaType(mediaType));
}

/**
 * Decode raw bytes to the text a claim can cite.
 *
 * UTF-8 with `fatal: false`: a malformed byte becomes U+FFFD rather than throwing. A throw here
 * would mean a single bad byte anywhere in a 100kB filing discarded the whole document, and the
 * replacement character is both deterministic and visible to a reviewer reading the quote.
 */
export function decodeToText(bytes: Uint8Array, mediaType: string): string {
  const base = baseMediaType(mediaType);
  if (!isSupportedMediaType(base)) throw new UnsupportedMediaType(mediaType);

  const raw = new TextDecoder("utf-8").decode(bytes);
  // A UTF-8 BOM is a container artefact, not content. Left in place it would sit inside the first
  // quoted span of every document served with one.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  return base === "text/html" ? htmlToText(text) : text;
}

// The tags whose boundaries are a paragraph break in the rendered document. Every other tag is
// removed without leaving anything behind, which is what a browser does: inline markup does not
// create a word boundary. `<b>redeem</b>able` is one word, and a decoder that split it there would
// break both the quote a claim cites and the phrase matching the deterministic parser depends on.
const BLOCK_TAGS =
  "p|div|br|hr|tr|table|thead|tbody|li|ul|ol|h[1-6]|section|article|header|footer|blockquote|pre|dd|dt|dl|caption|figure|figcaption";

/**
 * HTML to text.
 *
 * Deliberately small. A real HTML parser would be more faithful and would also make `contentHash` a
 * function of somebody else's release schedule: a parser upgrade that changed whitespace handling
 * would silently invalidate every hash Usance had committed. The transform below is a handful of
 * regular expressions whose behaviour is pinned by tests in this package, and
 * `MEDIA_DECODER_VERSION` is the escape hatch when it has to change.
 *
 * `<script>` and `<style>` bodies are removed rather than flattened. They are code, not text, and a
 * claim quoting a `<script>` body would be citing something no reader of the document can see —
 * which is exactly the shape of a hidden-instruction attack.
 */
export function htmlToText(html: string): string {
  let s = html;

  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(new RegExp(`<\\s*/?\\s*(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s);

  // Non-breaking and other exotic spaces survive entity decoding as real characters. They are
  // normalised to an ordinary space here so that a quote copied out of the text matches the text;
  // `canonicalizeText` does the same job again, and doing it twice is harmless and idempotent.
  s = s.replace(/[  -   　]/g, " ");
  s = s.replace(/\r\n?/g, "\n");
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The named entities that actually occur in filings, plus numeric references.
 *
 * A full entity table is not worth carrying: an unrecognised named entity is left verbatim, which
 * is honest and stable, whereas a partial table that silently mangled `&thorn;` would produce text
 * a reviewer could not match against the source.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  trade: "™",
  reg: "®",
  copy: "©",
  deg: "°",
  bull: "•",
  sect: "§",
  dagger: "†",
  Dagger: "‡",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      // Surrogates and out-of-range code points are left as written rather than mapped to U+FFFD,
      // so a malformed reference stays visible instead of becoming an unexplained glyph.
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

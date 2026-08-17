/**
 * ERC-8021 builder-code attribution.
 *
 * Attribution is appended to transaction calldata as a suffix that is parsed backwards from the
 * end. Receiving contracts need no changes and never see it — Solidity ignores trailing calldata
 * beyond the decoded arguments — so this is safe to append to any call.
 *
 *   calldata = <abi-encoded call> ‖ schemaData ‖ schemaId ‖ ercMarker
 *
 *   ercMarker  0x80218021802180218021802180218021   16 bytes, fixed
 *   schemaId   0x00                                  1 byte, schema 0
 *   schemaData <len:1> ‖ <code, ASCII>                schema 0
 *
 * Usance appends this on every write path from the first transaction rather than retrofitting
 * attribution later, because retrofitted attribution means the early transactions are lost.
 */

export const ERC8021_MARKER = "80218021802180218021802180218021" as const;
export const ERC8021_SCHEMA_0 = 0x00 as const;

export const DEFAULT_BUILDER_CODE = "usance" as const;

export class BuilderCodeError extends Error {}

const HEX = /^0x[0-9a-fA-F]*$/;

function asciiToHex(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Schema 0 codes are ASCII identifiers. A multi-byte character would make the declared
    // length disagree with the byte length and produce a suffix no indexer can parse.
    if (c > 0x7f) throw new BuilderCodeError(`builder code must be ASCII: ${JSON.stringify(s)}`);
    out += c.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Build the ERC-8021 suffix for one builder code.
 * @returns hex string without a `0x` prefix
 */
export function encodeBuilderSuffix(code: string = DEFAULT_BUILDER_CODE): string {
  if (code.length === 0) throw new BuilderCodeError("builder code must not be empty");
  const codeHex = asciiToHex(code);
  const byteLength = codeHex.length / 2;
  if (byteLength > 0xff) throw new BuilderCodeError("builder code exceeds 255 bytes");

  const schemaData = byteLength.toString(16).padStart(2, "0") + codeHex;
  const schemaId = ERC8021_SCHEMA_0.toString(16).padStart(2, "0");
  return schemaData + schemaId + ERC8021_MARKER;
}

/**
 * Append attribution to calldata.
 *
 * Idempotent: calldata that already carries a valid suffix is returned unchanged, so wrapping a
 * call twice cannot produce a double suffix that breaks parsing.
 */
export function withBuilderCode(data: `0x${string}`, code: string = DEFAULT_BUILDER_CODE): `0x${string}` {
  if (!HEX.test(data)) throw new BuilderCodeError(`not hex calldata: ${data}`);
  if (data.length % 2 !== 0) throw new BuilderCodeError("calldata must be whole bytes");
  if (hasBuilderSuffix(data)) return data;
  return `0x${data.slice(2)}${encodeBuilderSuffix(code)}`;
}

/**
 * Whether calldata already carries an ERC-8021 suffix.
 *
 * Only the fixed tail is checked — marker then schema id — because that part sits at a known
 * offset from the end. This is what `withBuilderCode` uses for idempotency.
 */
export function hasBuilderSuffix(data: string): boolean {
  if (!HEX.test(data)) return false;
  const hex = data.slice(2);
  if (hex.length < (16 + 1 + 2) * 2) return false;
  if (hex.slice(-ERC8021_MARKER.length).toLowerCase() !== ERC8021_MARKER) return false;
  const schemaId = parseInt(hex.slice(-ERC8021_MARKER.length - 2, -ERC8021_MARKER.length), 16);
  return schemaId === ERC8021_SCHEMA_0;
}

/**
 * Parse attribution back out of calldata.
 *
 * Schema 0 writes `<length> ‖ <code>`, with the length byte *first*. Read backwards that is
 * genuinely ambiguous: after stripping the marker and schema id there is no delimiter marking
 * where the original calldata ends and the suffix begins. So this recovers the boundary by
 * testing each candidate length L — the byte L positions back must itself equal L, and the L
 * bytes after it must be printable ASCII. The longest such match wins.
 *
 * A false positive would require the caller's own trailing calldata to be a self-consistent
 * length-prefixed ASCII run, which is not a case that arises for abi-encoded arguments. Consumers
 * that need certainty should read the emitted event rather than re-parse calldata.
 */
export function decodeBuilderCodes(data: string): string[] | null {
  if (!hasBuilderSuffix(data)) return null;
  const hex = data.slice(2);
  const schemaData = hex.slice(0, -(ERC8021_MARKER.length + 2));

  for (let len = Math.min(0xff, Math.floor(schemaData.length / 2) - 1); len >= 1; len--) {
    const lenPos = schemaData.length - (len + 1) * 2;
    if (lenPos < 0) continue;
    if (parseInt(schemaData.slice(lenPos, lenPos + 2), 16) !== len) continue;

    const codeHex = schemaData.slice(lenPos + 2);
    let code = "";
    let printable = true;
    for (let i = 0; i < codeHex.length; i += 2) {
      const c = parseInt(codeHex.slice(i, i + 2), 16);
      if (c < 0x20 || c > 0x7e) {
        printable = false;
        break;
      }
      code += String.fromCharCode(c);
    }
    if (printable) return [code];
  }
  return null;
}

export function builderCodeFromEnv(): string {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.["USANCE_BUILDER_CODE"] ?? DEFAULT_BUILDER_CODE;
}

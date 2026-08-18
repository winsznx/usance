/**
 * Types for the artifact-provenance helper.
 *
 * The helper is plain `.mjs` because it is loaded by deploy and verification scripts that run under
 * bare `node`, with no build step between editing and running. Its contract is still worth stating,
 * so the declarations live beside it rather than the consumers reaching for `any`.
 */

export interface Provenance {
  generatedAt: string;
  generatedBy: string;
  gitCommit: string;
  chainId?: number;
  deploymentDigest?: string | null;
  inputDigest?: string;
  run?: string;
  schema: number;
}

export interface WriteOptions {
  chainId?: number;
  inputDigest?: string;
  tool?: string;
  run?: string;
}

export interface ReadOptions {
  chainId?: number;
  inputDigest?: string;
  maxAgeSeconds?: number;
}

export interface ReadResult {
  /** False whenever the artifact is missing, unprovenanced, or describes a different world. */
  ok: boolean;
  doc: (Record<string, unknown> & { $provenance?: Provenance }) | null;
  reasons: string[];
}

export declare const repoRoot: string;
export declare function gitCommit(): string;
export declare function digestOf(value: string | Buffer | object): string;
export declare function deploymentDigest(chainId: number): string | null;
export declare function writeArtifact(
  relPath: string,
  body: Record<string, unknown>,
  options?: WriteOptions,
): Record<string, unknown> & { $provenance: Provenance };
export declare function readArtifact(relPath: string, options?: ReadOptions): ReadResult;

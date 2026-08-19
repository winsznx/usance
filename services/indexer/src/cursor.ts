import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";

/**
 * Where the indexer is up to, and which world it believes it is indexing.
 *
 * Two things are stored together on purpose. A block height on its own is a number that survives a
 * redeployment and keeps counting, which is exactly how an indexer ends up serving a retired
 * deployment's state as current. The deployment identity travels with the height so a mismatch is
 * detectable rather than silent.
 *
 * `safeHeight` is deliberately not `head`. A chain can reorganise, so events are only projected once
 * they are buried under enough blocks that reversal is not a normal occurrence. What the indexer
 * serves is confirmed state, and the gap between the two is reported rather than hidden.
 */

export interface Cursor {
  /** Last block whose events have been projected. */
  readonly height: number;
  /** Chain this cursor belongs to. */
  readonly chainId: number;
  /** Digest of the deployment manifest these projections describe. */
  readonly deploymentDigest: string;
  /** Block the current deployment was created in; nothing before it is relevant. */
  readonly deployedAt: number;
  readonly updatedAt: number;
}

export class DeploymentChanged extends Error {
  readonly code = "DEPLOYMENT_CHANGED";
  constructor(
    readonly expected: string,
    readonly found: string,
  ) {
    super(
      `This cursor was built against deployment ${expected.slice(0, 18)}… and the manifest now reads ` +
        `${found.slice(0, 18)}…. Refusing to continue: an indexer that keeps counting across a ` +
        `redeployment serves a retired deployment's state as current.`,
    );
    this.name = "DeploymentChanged";
  }
}

export interface CursorStore {
  read(): Promise<Cursor | null>;
  write(cursor: Cursor): Promise<void>;
}

export class FileCursorStore implements CursorStore {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  async read(): Promise<Cursor | null> {
    if (!existsSync(this.path)) return null;
    return JSON.parse(readFileSync(this.path, "utf8")) as Cursor;
  }

  /** Written to a temporary path and renamed, so a crash mid-write cannot corrupt the cursor. */
  async write(cursor: Cursor): Promise<void> {
    const tmp = `${this.path}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, JSON.stringify(cursor, null, 2) + "\n");
      renameSync(tmp, this.path);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  }
}

export class InMemoryCursorStore implements CursorStore {
  private cursor: Cursor | null = null;
  async read(): Promise<Cursor | null> {
    return this.cursor;
  }
  async write(cursor: Cursor): Promise<void> {
    this.cursor = cursor;
  }
}

/**
 * Resume, or refuse.
 *
 * A cursor from a different deployment is not something to reconcile — the projections behind it
 * describe contracts nobody is using. The caller either indexes that deployment separately as
 * history, or starts fresh.
 */
export async function resume(
  store: CursorStore,
  chainId: number,
  deploymentDigest: string,
  deployedAt: number,
): Promise<Cursor> {
  const existing = await store.read();
  if (existing) {
    if (existing.chainId !== chainId) throw new DeploymentChanged(`chain ${existing.chainId}`, `chain ${chainId}`);
    if (existing.deploymentDigest !== deploymentDigest) {
      throw new DeploymentChanged(existing.deploymentDigest, deploymentDigest);
    }
    return existing;
  }

  // Nothing before the deployment block can concern this deployment.
  const fresh: Cursor = {
    height: deployedAt - 1,
    chainId,
    deploymentDigest,
    deployedAt,
    updatedAt: Math.floor(Date.now() / 1000),
  };
  await store.write(fresh);
  return fresh;
}

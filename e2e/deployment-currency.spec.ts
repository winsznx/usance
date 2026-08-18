import { test, expect } from "@playwright/test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deployment } from "./fixtures";

/**
 * The surfaces must consume the deployment that is actually live.
 *
 * A page reading a superseded manifest fails in the worst possible way: it renders, with numbers,
 * from contracts nobody is using. `make test-live-xlayer` proves the manifest matches the chain;
 * these prove the pages match the manifest.
 */

// ESM, so no __dirname. Same resolution the fixtures module uses.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test.describe("published surfaces cite the current deployment", () => {
  test("/earn reads the vault named in the current manifest", async ({ page }) => {
    test.skip(!deployment?.contracts?.liquidityVault, "no manifest on disk");
    await page.goto("/earn");
    const body = await page.locator("body").innerText();

    const current = deployment!.contracts.liquidityVault.toLowerCase();
    // The page abbreviates as 0xabcdef…abcdef, which is right: a full address in running text is
    // unreadable. Assert against the prefix it actually renders rather than a longer one.
    expect(body.toLowerCase()).toContain(current.slice(0, 8));
    expect(body.toLowerCase()).toContain(current.slice(-6));
  });

  test("the withdrawal queue is readable on the deployed vault", async ({ page }) => {
    test.skip(!deployment?.contracts?.liquidityVault, "no manifest on disk");
    await page.goto("/earn");
    const body = await page.locator("body").innerText().then((t) => t.toLowerCase());

    // The page degrades honestly when a deployment predates the queue. That is the right behaviour
    // in the window between a contract change and a redeploy, and the wrong state to ship in: it
    // means the repo and the chain disagree about what the vault can do.
    expect(body).not.toContain("not available on this deployment");
  });

  test("no proof record cites a contract that is no longer deployed", () => {
    const live = new Set(
      Object.values(deployment?.contracts ?? {}).map((a) => String(a).toLowerCase()),
    );
    test.skip(live.size === 0, "no manifest on disk");

    const proofDir = resolve(root, "proof");
    const stale: string[] = [];
    for (const f of readdirSync(proofDir).filter((x) => x.endsWith(".json"))) {
      const raw = readFileSync(resolve(proofDir, f), "utf8");
      const doc = JSON.parse(raw) as Record<string, unknown>;
      // Records deliberately kept as history are exempt — that is what the marker is for.
      if (doc["$superseded"]) continue;

      const ch = String(doc["clearingHouse"] ?? "").toLowerCase();
      if (ch && ch.startsWith("0x") && !live.has(ch)) stale.push(`${f} cites ClearingHouse ${ch}`);
    }
    expect(stale, "a current proof record points at a retired deployment").toEqual([]);
  });

  test("superseded records are archived rather than deleted", () => {
    const dir = resolve(root, "proof/historical");
    if (!existsSync(dir)) test.skip(true, "nothing has been superseded yet");

    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const doc = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as Record<string, unknown>;
      // An archived record must say why it is no longer current, or a reader cannot tell whether it
      // describes the present.
      expect(doc["$superseded"], `${f} is archived without a marker`).toBeTruthy();
      expect(doc["transactions"], `${f} was archived with no transactions`).toBeTruthy();
    }
  });
});

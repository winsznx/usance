import { test, expect } from "@playwright/test";
import { deployment, passport, liquidation, riskScenario, allProofHashes, receiptSlug, FULL_TX_HASH } from "./fixtures";

/**
 * The public surface, which needs no wallet.
 *
 * These are the pages a judge or a counterparty reaches from a link, so the assertions are about
 * what a reader can verify rather than about markup. The recurring rule: a page may not display a
 * hash it cannot stand behind, and may not point at contracts that are no longer deployed.
 */

test.describe("public pages render", () => {
  for (const path of ["/", "/assets", "/assets/franklin-fobxx", "/status", "/simulate"]) {
    test(`${path} loads without an error boundary`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status(), `${path} returned ${response?.status()}`).toBeLessThan(400);
      await expect(page.locator("body")).not.toContainText("Application error");
      await expect(page.locator("h1").first()).toBeVisible();
    });
  }
});

test.describe("proof pages cite the current deployment", () => {
  test("the passport receipt shows its real transaction", async ({ page }) => {
    test.skip(!passport?.transactions?.length, "no passport proof record on disk");
    const commit = passport!.transactions!.find((t) => t.label.includes("commitPassport"))!;
    await page.goto(`/proof/${receiptSlug("PASSPORT_COMMITTED", 1952, commit.hash)}`);

    // The page abbreviates hashes as 0xabcdef1234…abcdef, which is correct: a full 66-character
    // hash in running text is unreadable and an unmarked truncation is a fabrication. Assert the
    // abbreviation it actually renders, both ends, so a wrong hash still fails.
    await expect(page.locator("body")).toContainText(commit.hash.slice(0, 12));
    await expect(page.locator("body")).toContainText(commit.hash.slice(-6));
    await expect(page.locator("body")).toContainText("X Layer");

    // The chain of custody must name the filing. It rendered "undefined — undefined" until a
    // browser test caught it: the loader returned a well-formed object whose fields were all
    // missing, which no unit test on the loader could see.
    await expect(page.locator("body")).not.toContainText("undefined");
    await expect(page.locator("body")).toContainText("Franklin");
  });

  test("the liquidation receipt explains itself without an explorer", async ({ page }) => {
    test.skip(!liquidation?.liquidationTx, "no liquidation proof record on disk");
    await page.goto(`/proof/${receiptSlug("LIQUIDATED", 1952, liquidation!.liquidationTx!.hash)}`);

    // The three questions a reader needs answered, in order.
    await expect(page.getByText("Why liquidation was allowed")).toBeVisible();
    await expect(page.getByText("What Usance did")).toBeVisible();
    await expect(page.getByText("Result", { exact: true })).toBeVisible();

    // The deduction a quoted price never contains, named in plain words.
    await expect(page.getByText("Chance it does not complete")).toBeVisible();

    // And the uncomfortable part, which is the one most likely to be quietly dropped.
    await expect(page.locator("body")).toContainText("One liquidation was never going to be enough");
  });

  test("the risk receipt shows the borrow the protocol refused", async ({ page }) => {
    test.skip(!riskScenario?.newRiskBlocked?.hash, "no risk scenario record on disk");
    const borrow = riskScenario!.transactions!.find((t) => t.label.includes("borrow"))!;
    await page.goto(`/proof/${receiptSlug("BORROW_REJECTED", 1952, borrow.hash)}`);
    await expect(page.locator("body")).toContainText(/rejected|refused|reverted/i);
  });
});

test.describe("nothing is fabricated", () => {
  test("every hash on a proof page is a full 32-byte hash", async ({ page }) => {
    test.skip(!liquidation?.liquidationTx, "no liquidation proof record on disk");
    await page.goto(`/proof/${receiptSlug("LIQUIDATED", 1952, liquidation!.liquidationTx!.hash)}`);

    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    // A truncated hash reads as a real one and resolves to nothing. Anything hash-shaped must be
    // either a complete 66-character hash or an explicit abbreviation with an ellipsis.
    const suspicious = [...body.matchAll(/0x[0-9a-fA-F]{20,63}(?![0-9a-fA-F…])/g)].map((m) => m[0]);
    expect(suspicious, `hash-shaped strings that are neither full nor marked abbreviated: ${suspicious.join(", ")}`).toEqual([]);
  });

  test("the zero hash never appears", async ({ page }) => {
    await page.goto("/assets");
    await expect(page.locator("body")).not.toContainText(`0x${"0".repeat(64)}`);
  });

  test("proof records only claim complete hashes", () => {
    const hashes = allProofHashes();
    expect(hashes.length).toBeGreaterThan(0);
    for (const h of hashes) expect(h).toMatch(FULL_TX_HASH);
  });
});

test.describe("the status page reflects the current deployment", () => {
  test("it names the deployed ClearingHouse, not a superseded one", async ({ page }) => {
    test.skip(!deployment, "no deployment manifest");
    await page.goto("/status");

    const body = await page.locator("body").innerText();
    const addresses = [...body.matchAll(/0x[0-9a-fA-F]{40}/g)].map((m) => m[0].toLowerCase());
    const known = new Set(Object.values(deployment!.contracts).map((a) => a.toLowerCase()));

    // Any contract address the page shows must be one this deployment actually contains. A page
    // still advertising a retired address is the stale-artifact failure wearing a UI.
    const unknown = addresses.filter((a) => !known.has(a) && a !== `0x${"0".repeat(40)}`);
    expect(unknown, `addresses not in the current manifest: ${unknown.join(", ")}`).toEqual([]);
  });
});

import { test, expect } from "@playwright/test";
import { deployment } from "./fixtures";

/**
 * The lender surface.
 *
 * The claims worth defending in a browser are the ones a lender would otherwise have to take on
 * trust: that the figures come from the deployed vault, that no APY is invented, and that the page
 * says plainly when capital cannot be redeemed on demand.
 */

test.describe("/earn reads the deployed vault", () => {
  test("loads and shows the vault it is reading", async ({ page }) => {
    const response = await page.goto("/earn");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("h1").first()).toBeVisible();

    if (deployment?.contracts?.liquidityVault) {
      // The page must name the contract its numbers came from. A dashboard that shows figures
      // without saying where they were read is asking to be believed rather than checked.
      const vault = deployment.contracts.liquidityVault;
      await expect(page.locator("body")).toContainText(vault.slice(0, 8));
    }
  });

  test("publishes no APY figure", async ({ page }) => {
    await page.goto("/earn");

    // A blanket search for "APY" fails on the page's own sentence explaining that it publishes no
    // APY, which is the opposite of the defect. What is forbidden is APY presented as a *metric* —
    // a number a lender would read as a promise — so the assertion is against the stat labels and
    // against any figure adjacent to the term.
    const labels = await page.locator(".stat-label").allInnerTexts();
    expect(labels.map((l) => l.toUpperCase()).filter((l) => l.includes("APY"))).toEqual([]);

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\d[\d.,]*\s*%?\s*APY/i);
    expect(body).not.toMatch(/APY[:\s]+\d/i);

    // And the policy is stated, so a reader knows the absence is deliberate rather than an omission.
    expect(body.toUpperCase()).toContain("PUBLISHES NO APY");
    expect(body.toUpperCase()).toContain("NOT A PROJECTION");
  });

  test("states that lent capital is not redeemable on demand", async ({ page }) => {
    await page.goto("/earn");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("queue");
    expect(body).toMatch(/cannot be redeemed on demand|not always instant/);
  });

  test("shows where losses land before lenders", async ({ page }) => {
    await page.goto("/earn");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("reserve absorbs the first loss");
  });
});

test.describe("/earn/positions", () => {
  test("asks for a wallet rather than rendering an empty position", async ({ page }) => {
    const response = await page.goto("/earn/positions");
    expect(response?.status()).toBeLessThan(400);

    // An empty position for a wallet nobody connected reads as "you have supplied nothing", which
    // is a claim about the reader. Prompting to connect is the honest state.
    await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
  });

  test("the position API refuses a malformed account", async ({ request }) => {
    const bad = await request.get("/api/earn/position?account=not-an-address");
    expect(bad.status()).toBe(400);
    const missing = await request.get("/api/earn/position");
    expect(missing.status()).toBe(400);
  });

  test("the position API serialises amounts without losing precision", async ({ request }) => {
    const res = await request.get(`/api/earn/position?account=0x${"11".repeat(20)}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    if (body === null) test.skip(true, "no vault deployed for this chain");

    // bigints are serialised as decimal strings. Numbers would silently lose precision above 2^53,
    // which for a 6-decimal settlement token starts at about 9 billion units.
    expect(typeof body.position.shares).toBe("string");
    expect(typeof body.vault.totalSupplied).toBe("string");
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("/earn has no horizontal overflow", async ({ page }) => {
    await page.goto("/earn");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow, "the page scrolls sideways on a phone").toBe(false);
  });
});

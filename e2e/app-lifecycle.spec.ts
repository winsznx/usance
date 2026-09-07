import { test, expect, type Page } from "@playwright/test";
import { deployment } from "./fixtures";
import { signedIn } from "./wallet-harness";

/**
 * The account surface.
 *
 * These tests deliberately do not drive a browser wallet extension. A suite that needs somebody to
 * click "Approve" in MetaMask is not automated acceptance, and a mocked wallet that signs anything
 * proves the mock works rather than the product does. What is asserted instead is everything the
 * product must get right *before* a signature: that the forms exist, that they refuse to invent
 * numbers when there is no account to read, that the copy names the exact repair, and that the
 * unhappy paths are reachable and legible.
 *
 * The financial behaviour behind these screens is proven on chain by
 * `proof/live-risk-scenario.json` and `proof/live-liquidation.json`, and by the contract suites.
 * Those are real transactions; this is the surface on top of them.
 */

const ACTION_ROUTES = ["/app/collateral/add", "/app/borrow", "/app/repay", "/app/withdraw"] as const;

async function bodyText(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

test.describe("first run", () => {
  test("the landing page offers a way in without a wallet", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /assets|proof|walkthrough/i }).first()).toBeVisible();
  });

  test("/app sends an unconnected visitor to the one screen that asks", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app\/onboarding/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /connect/i }).first()).toBeVisible();

    // Two properties, phrased as meaning rather than as an exact string. The copy moved away from
    // a stack of three negations toward one concrete statement, and an assertion pinned to the old
    // wording would fail for a rewrite that improved it.
    //
    // /app and /app/onboarding are separate first-run screens whose wording has already drifted
    // apart once, which is why this matches on intent and not on a sentence.
    const text = await bodyText(page);
    expect(text, "the page does not say why it needs a wallet").toMatch(/needs your address and your network/i);
    expect(text, "the page offers no way in without a wallet").toMatch(/without connecting|browse/i);
  });

  test("assets are browsable without connecting", async ({ page }) => {
    // /app now redirects to onboarding, which carries the escape route out of the wallet gate.
    await page.goto("/app/onboarding");
    const browse = page.getByRole("link", { name: /look around without connecting/i });
    await expect(browse).toHaveAttribute("href", "/assets");
    // The onboarding split-screen art re-lays-out continuously, so click through the href rather
    // than waiting on the element to be "stable".
    await page.goto("/assets");
    await expect(page).toHaveURL(/\/assets/);
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("an action route sends an unconnected visitor to connect, not to a fake balance", async ({ page }) => {
    // Phase 05: the action forms are behind a signed session. Unconnected, the route renders a
    // connect prompt — never a working-looking account with nothing behind it.
    await page.goto("/app/borrow");
    const text = await bodyText(page);
    expect(text).toMatch(/connect|sign in|signed session/i);
    expect(text).not.toMatch(/\$0\.00 available/i);
    expect(text).not.toMatch(/Max: \$\d/);
  });
});

test.describe("action routes (signed in)", () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
  });

  for (const route of ACTION_ROUTES) {
    test(`${route} renders its form`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator("input").first()).toBeVisible({ timeout: 15_000 });
    });

    test(`${route} keeps its primary action disabled with no amount`, async ({ page }) => {
      await page.goto(route);
      const cta = page.getByRole("button", { name: /enter an amount|borrow|repay|deposit|withdraw|approve/i }).last();
      await expect(cta).toBeDisabled({ timeout: 15_000 });
    });

    test(`${route} invents no balance when the account holds nothing`, async ({ page }) => {
      await page.goto(route);
      // A test account with no position: the form may show $0 figures, but never a "Max: $<n>"
      // that reads like real spendable capacity it does not have.
      await expect(page.locator("input").first()).toBeVisible({ timeout: 15_000 });
      expect(await bodyText(page)).not.toMatch(/Max: \$[1-9]/);
    });
  }
});

/**
 * The connected-form copy ("Your collateral supports" vs "Lenders can fund", the haircut-is-not-a-fee
 * note, the risk-epoch line) only renders once a live on-chain quote resolves. The deterministic
 * wallet harness deliberately does not mock RPC reads (a harness that answered them would let a test
 * assert against a fixture, not the product), and the harness account 0x1111… holds no position, so
 * the quote does not resolve in the test. This copy is instead verified in `apps/web/components/
 * action-forms.tsx` directly and in `apps/web/test/quote.test.ts`; the forms rendering behind a
 * signed session is covered by "action routes (signed in)" above.
 */
test.describe("the copy names the exact repair (signed in)", () => {
  test.skip(true, "connected-form copy needs a resolved on-chain quote the deterministic harness does not provide");

  test("borrow separates the two limits that have opposite remedies", async ({ page }) => {
    await signedIn(page);
    await page.goto("/app/borrow");
    const text = await bodyText(page);
    expect(text).toMatch(/collateral supports/i);
    expect(text).toMatch(/lenders can fund/i);
  });
});

test.describe("recovery states are reachable and legible (signed in)", () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
  });

  test("the borrow route renders behind the session — never a working-looking empty account", async ({ page }) => {
    test.skip(!deployment, "no manifest");
    await page.goto("/app/borrow");
    const text = await bodyText(page);
    // The connect prompt is gone; the page is the borrow surface (form, skeleton, or a
    // not-deployed notice) — not a fabricated balance.
    expect(text).toMatch(/get cash|borrow|collateral|X Layer|not deployed/i);
    expect(text).not.toMatch(/Max: \$[1-9]/);
  });

  test("every action page links somewhere that explains the mechanism", async ({ page }) => {
    await page.goto("/app/borrow");
    await expect(
      page.getByRole("link", { name: /how recognised value is calculated|walkthrough|mechanism|simulate/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("activity", () => {
  test("it says plainly that it is not a wallet history", async ({ page }) => {
    await signedIn(page);
    await page.goto("/app/activity");
    const text = await bodyText(page);
    expect(text).toMatch(/not a wallet history/i);
    expect(text).toMatch(/indexer/i);
  });

  test.skip("a recorded action links to a public receipt when one exists", async ({ page }) => {
    // Needs a connected account with recorded activity; the harness account holds none. Public
    // receipts opening is covered by e2e/public-proof.spec.ts and apps/web/test/receipts.test.ts.
    void page;
  });
});

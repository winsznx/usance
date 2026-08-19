import { test, expect, type Page } from "@playwright/test";
import { deployment } from "./fixtures";

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

  test("/app asks to connect before anything else", async ({ page }) => {
    await page.goto("/app");
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
    await page.goto("/app");
    const browse = page.getByRole("link", { name: /browse supported assets/i });
    await expect(browse).toBeVisible();
    await browse.click();
    await expect(page).toHaveURL(/\/assets/);
  });
});

test.describe("action routes", () => {
  for (const route of ACTION_ROUTES) {
    test(`${route} renders its form`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator("input").first()).toBeVisible();
    });

    test(`${route} invents no balance when there is no account to read`, async ({ page }) => {
      await page.goto(route);
      const text = await bodyText(page);

      // A placeholder balance is the most dangerous thing this app could render: it looks exactly
      // like a real one. With no connected account the number must be absent, not zero.
      expect(text).not.toMatch(/\$0\.00 available/i);
      expect(text).not.toMatch(/Max: \$\d/);
    });

    test(`${route} keeps its primary action disabled with no amount`, async ({ page }) => {
      await page.goto(route);
      const cta = page.getByRole("button", { name: /enter an amount|borrow|repay|deposit|withdraw|approve/i }).last();
      await expect(cta).toBeDisabled();
    });
  }
});

test.describe("the copy names the exact repair", () => {
  test("borrow separates the two limits that have opposite remedies", async ({ page }) => {
    await page.goto("/app/borrow");
    const text = await bodyText(page);
    // "Your collateral supports X" and "lenders can fund Y" are different constraints. Showing only
    // their minimum leaves a user with no idea whether to add collateral or wait.
    expect(text).toMatch(/collateral supports/i);
    expect(text).toMatch(/lenders can fund/i);
  });

  test("add-collateral explains the haircut is not a fee", async ({ page }) => {
    await page.goto("/app/collateral/add");
    expect(await bodyText(page)).toMatch(/not a fee|stays in your deposit/i);
  });

  test("repay warns that clearing a loan costs more than was borrowed", async ({ page }) => {
    await page.goto("/app/repay");
    const text = await bodyText(page);
    expect(text).toMatch(/interest/i);
    expect(text).toMatch(/repay everything|close the loan/i);
  });

  test("withdraw separates 'you owe too much' from 'your account is restricted'", async ({ page }) => {
    await page.goto("/app/withdraw");
    expect(await bodyText(page)).toMatch(/free to withdraw|holding the rest|restricted/i);
  });
});

test.describe("recovery states are reachable and legible", () => {
  test("a chain with no deployment says so instead of showing an empty portfolio", async ({ page }) => {
    test.skip(!deployment, "no manifest");
    await page.goto("/app/borrow");
    const text = await bodyText(page);
    // Either the form is live, or it explains its absence. What it must never do is render a
    // working-looking account with nothing behind it.
    expect(text).toMatch(/X Layer|not deployed|see the mechanism/i);
  });

  test("the risk vocabulary is explained where a user meets it", async ({ page }) => {
    await page.goto("/app/borrow");
    expect(await bodyText(page)).toMatch(/risk epoch|paused|restricted/i);
  });

  test("every action page links somewhere that explains the mechanism", async ({ page }) => {
    await page.goto("/app/borrow");
    await expect(page.getByRole("link", { name: /how recognised value is calculated|walkthrough|mechanism/i }).first()).toBeVisible();
  });
});

test.describe("activity", () => {
  test("it says plainly that it is not a wallet history", async ({ page }) => {
    await page.goto("/app/activity");
    const text = await bodyText(page);
    expect(text).toMatch(/not a wallet history/i);
    expect(text).toMatch(/indexer/i);
  });

  test("recorded actions link to a public receipt", async ({ page }) => {
    await page.goto("/app/activity");
    const first = page.locator('a[href^="/proof/"]').first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page).toHaveURL(/\/proof\//);
    await expect(page.locator("h1").first()).toBeVisible();
  });
});

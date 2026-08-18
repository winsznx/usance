import { test, expect } from "@playwright/test";

/**
 * The mandate surface.
 *
 * These assert the disclosures, not the markup. The failure mode delegated authority actually has
 * is a person signing typed data they did not read, granting powers they did not intend — so what
 * matters in a browser is whether the page states the boundary before the button, and whether it
 * overstates what a signature would achieve.
 */

test.describe("/app/mandates", () => {
  test("leads with what a mandate can never do", async ({ page }) => {
    const res = await page.goto("/app/mandates");
    expect(res?.status()).toBeLessThan(400);

    const body = await page.locator("body").innerText();
    expect(body.toLowerCase()).toContain("cannot withdraw your collateral");

    // Stated as a protocol property, not as an absence a reader has to notice for themselves.
    expect(body.toLowerCase()).toContain("even if you sign a mandate granting everything");
  });

  test("says plainly that it cannot list mandates it did not create", async ({ page }) => {
    await page.goto("/app/mandates");
    const body = (await page.locator("body").innerText()).toLowerCase();
    // Usance runs no indexer. An empty list would read as "you have delegated nothing".
    expect(body).toMatch(/no indexer|cannot list mandates|not deployed on this network/);
  });
});

test.describe("/app/mandates/new", () => {
  test("shows the boundary before the signing control", async ({ page }) => {
    await page.goto("/app/mandates/new");
    const body = await page.locator("body").innerText();

    expect(body.toLowerCase()).toContain("cannot withdraw your collateral");
    const boundaryAt = body.toLowerCase().indexOf("cannot withdraw your collateral");
    const signAt = body.toLowerCase().indexOf("review and sign");
    expect(boundaryAt, "the boundary must appear before the signing control").toBeLessThan(signAt);
  });

  test("discloses every field the signature carries", async ({ page }) => {
    await page.goto("/app/mandates/new");
    const body = (await page.locator("body").innerText()).toLowerCase();

    for (const field of [
      "authorised agent",
      "allowed actions",
      "debt ceiling",
      "expires",
      "can this raise your risk?",
      "can this withdraw your collateral?",
    ]) {
      expect(body, `the disclosure omits "${field}"`).toContain(field);
    }
  });

  test("does not claim to have created a mandate it did not create", async ({ page }) => {
    await page.goto("/app/mandates/new");
    const body = (await page.locator("body").innerText()).toLowerCase();

    // The signing path is not wired. Saying so is the difference between an unfinished feature and
    // a page that lies about what just happened.
    expect(body).toContain("not yet wired to the deployed registry");
    await expect(page.getByRole("button", { name: /review and sign/i })).toBeDisabled();
  });

  test("rejects a malformed agent address in the disclosure", async ({ page }) => {
    await page.goto("/app/mandates/new");
    await page.getByLabel("Agent address").fill("not-an-address");

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("not a 20-byte address");
  });

  test("a risk-reducing template reports that it cannot raise risk", async ({ page }) => {
    await page.goto("/app/mandates/new");
    // The default template is repay/add-collateral only.
    const body = await page.locator("body").innerText();
    const idx = body.toLowerCase().indexOf("can this raise your risk?");
    expect(idx).toBeGreaterThan(-1);
    expect(body.slice(idx, idx + 60).toLowerCase()).toContain("no");
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test("the mandate disclosure does not overflow sideways", async ({ page }) => {
    await page.goto("/app/mandates/new");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow, "the disclosure scrolls sideways on a phone").toBe(false);
  });

  test("the boundary is readable without hovering anything", async ({ page }) => {
    await page.goto("/app/mandates/new");
    // Permission information behind a hover is permission information a phone user never sees.
    await expect(page.getByText(/cannot withdraw your collateral/i).first()).toBeVisible();
  });
});

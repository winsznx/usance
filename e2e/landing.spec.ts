import { test, expect } from "@playwright/test";

/**
 * The landing page.
 *
 * The assertions are about promises and provenance, not markup. What matters is that a first-time
 * visitor gets the outcome before the machinery, that every claim on the page is checkable
 * somewhere, and that nothing pretends to work that does not.
 */

test.describe("hero", () => {
  test("leads with the outcome, not the mechanism", async ({ page }) => {
    await page.goto("/");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toContainText(/usable as capital/i);

    // "Passport", "clearing" and "risk epoch" are what Usance is. They are not what a stranger
    // came to find out, so they must not be in the first thing read.
    const heading = (await h1.innerText()).toLowerCase();
    expect(heading).not.toMatch(/passport|clearing|epoch|protocol/);
  });

  test("uses the kit's watercolour rather than a generated one", async ({ page }) => {
    await page.goto("/");
    const art = page.locator("img.hero-art");
    await expect(art).toHaveAttribute("src", /usance-hero-watercolor-master/);
  });

  test("offers a way in and a way to look first", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /launch usance/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /explore supported assets/i })).toBeVisible();
  });
});

test.describe("features", () => {
  test("shows six, each with a kit illustration", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator(".feature-grid .feature-card");
    expect(await cards.count()).toBe(6);

    for (const src of [
      "evidence-to-passport", "collateral-capacity", "borrow-settlement",
      "risk-epoch", "mandate-agent-authority", "proof-receipt-chain",
    ]) {
      await expect(page.locator(`img[src*="${src}"]`)).toHaveCount(1);
    }
  });

  test("states the agent boundary on the landing page, not only inside the app", async ({ page }) => {
    await page.goto("/");
    const body = (await page.locator("body").innerText()).toLowerCase();
    // Somebody deciding whether to try Usance should learn this before connecting, not after.
    expect(body).toContain("never withdraw your collateral");
  });
});

test.describe("honesty", () => {
  test("the email field admits it is not wired", async ({ page }) => {
    await page.goto("/");
    // A form that swallows an address is worse than one that says it is not connected yet.
    await expect(page.getByLabel("Email address")).toBeDisabled();
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("not wired to a mailing list yet");
  });

  test("says this is a testnet deployment", async ({ page }) => {
    await page.goto("/");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("test assets have no real value");
  });

  test("every footer destination exists", async ({ page }) => {
    await page.goto("/");
    const internal = await page.locator(".site-footer a[href^='/']").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!),
    );
    expect(internal.length).toBeGreaterThan(4);

    // A footer linking to routes that 404 is the commonest way a landing page stops being true.
    for (const href of [...new Set(internal)]) {
      const res = await page.request.get(href);
      expect(res.status(), `${href} returned ${res.status()}`).toBeLessThan(400);
    }
  });
});

test.describe("mobile", () => {
  test.skip(({ isMobile }) => isMobile !== true, "phone layout only");

  test("does not scroll sideways", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });

  test("the headline stays readable rather than overflowing", async ({ page }) => {
    await page.goto("/");
    const box = await page.getByRole("heading", { level: 1 }).boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box?.width ?? 0).toBeLessThanOrEqual(width);
  });
});

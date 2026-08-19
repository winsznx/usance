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

  test("carries the landscape, preloaded", async ({ page }) => {
    await page.goto("/");
    // Next rewrites the src through the image pipeline, so the assertion is on the encoded path
    // rather than a bare filename.
    await expect(page.locator("img.hero-art")).toHaveAttribute("src", /hero-landscape/);

    // The hero is the largest contentful paint. Next emits its own preloads for priority images,
    // so this asserts the explicit one in static HTML — the one that starts fetching while the
    // bundle is still parsing, rather than after React resolves the tree.
    await expect(
      page.locator('link[rel="preload"][as="image"][href="/images/hero-landscape.webp"]'),
    ).toHaveCount(1);
  });

  test("offers a way in and a way to look first", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /launch usance/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /explore supported assets/i })).toBeVisible();
  });
});

test.describe("features", () => {
  test("shows six, each with its own illustration", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator(".feature-grid .feature-card");
    expect(await cards.count()).toBe(6);

    // One image per feature, and each a different one — a grid where two cards share art is a grid
    // where somebody wired the wrong constant and nothing complained.
    for (const src of [
      "feature-passport", "feature-value", "feature-borrow",
      "feature-monitoring", "feature-agents", "feature-receipts",
    ]) {
      await expect(page.locator(`img[src*="${src}"]`)).toHaveCount(1);
    }
  });

  test("the hero owns the first screen", async ({ page }) => {
    await page.goto("/");
    const hero = await page.locator(".hero").boundingBox();
    const viewport = page.viewportSize();
    // Nothing below the hero should be competing for attention on load.
    expect(hero?.height ?? 0).toBeGreaterThan((viewport?.height ?? 0) * 0.7);
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

test.describe("the condensing header", () => {
  test("starts expanded and condenses once the page moves", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("#site-header");

    // Ships expanded in the HTML, so with JavaScript off it stays usable in its opening shape.
    await expect(header).toHaveAttribute("data-condensed", "false");

    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(header).toHaveAttribute("data-condensed", "true");

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(header).toHaveAttribute("data-condensed", "false");
  });

  test("navigation stays reachable in both states", async ({ page, isMobile }) => {
    test.skip(isMobile === true, "the phone header keeps the mark and the action, not the links");
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Site" });

    await expect(nav.getByRole("link", { name: "Assets" })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(nav.getByRole("link", { name: "Assets" })).toBeVisible();
  });

  test("the action survives on a phone", async ({ page, isMobile }) => {
    test.skip(isMobile !== true, "phone layout only");
    await page.goto("/");
    // Four links at a size that fits a phone header are four links nobody can hit, so they drop.
    // What must never drop is the way in.
    await expect(page.getByRole("link", { name: /open usance/i })).toBeVisible();
  });
});

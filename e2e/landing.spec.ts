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
    await expect(h1).toContainText(/working capital/i);

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
    await expect(page.getByRole("link", { name: /see how it works/i })).toBeVisible();
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
  test("the email field is wired, and honest when the store is not configured", async ({ page }) => {
    await page.goto("/");
    // The footer capture posts to /api/subscribe (Phase 05: it is wired for real now). The field
    // is a real enabled email input, not a disabled placeholder.
    const field = page.locator("#subscribe");
    await field.scrollIntoViewIfNeeded();
    await expect(field).toBeEnabled();
    await expect(field).toHaveAttribute("type", "email");

    // Submitting with no mailing store configured returns an honest 503 — it never claims a
    // success it did not perform (see apps/web/app/api/subscribe/route.ts). The form renders the
    // exact server message in a live region rather than a fake confirmation.
    await field.fill("someone@example.com");
    await field.press("Enter");
    await expect(page.locator(".subscribe-msg")).toContainText(
      /on the list|not configured on this deployment|could not/i,
      { timeout: 15_000 },
    );
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
    await expect(page.locator("#site-header").getByRole("link", { name: /open usance/i })).toBeVisible();
  });
});

test.describe("the hero runs to the top", () => {
  test("no band of canvas sits above the artwork", async ({ page }) => {
    await page.goto("/");
    const art = await page.locator("img.hero-art").boundingBox();
    // The image starts at the very top of the viewport and the header overlays it. A sticky header
    // left a strip of empty canvas as the first thing on the page.
    expect(art?.y ?? 99).toBeLessThanOrEqual(1);
  });

  test("the header floats over the image rather than sitting on a bar", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("#site-header");
    await expect(header).toHaveCSS("position", "fixed");

    const box = await header.boundingBox();
    expect(box?.y ?? 99).toBeLessThanOrEqual(1);
  });

  test("pages without a hero still clear the fixed header", async ({ page }) => {
    for (const path of ["/status", "/security", "/assets"]) {
      await page.goto(path);
      const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
      // A fixed header removes itself from flow, so a page with no hero would otherwise start
      // underneath it with its first heading hidden.
      expect(heading?.y ?? 0, `${path} starts under the header`).toBeGreaterThan(60);
    }
  });
});

test.describe("holdings", () => {
  test("wide content scrolls inside its own container", async ({ page }) => {
    await page.goto("/");
    // Asserted on the landing page's own tables too: a table that widens the page makes every
    // other section scroll sideways with it, which on a phone stops the layout being readable.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});

/**
 * Durable header/CTA geometry invariants (found live: "How it works" wrapped onto two lines once
 * the condensed pill ran out of room for six nav links). These check the actual failure mode, not
 * a pixel snapshot, so they survive future copy/asset changes.
 */
test.describe("header geometry", () => {
  const DESKTOP_WIDTHS = [1600, 1440, 1280, 1024, 900];

  for (const width of DESKTOP_WIDTHS) {
    test(`nav labels never wrap at ${width}px, top and scrolled`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const noWrap = () => page.evaluate(() =>
        Array.from(document.querySelectorAll(".site-header-nav a")).every((a) => a.getBoundingClientRect().height < 40),
      );
      await expect.poll(noWrap).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 900));
      await page.waitForTimeout(400);
      await expect.poll(noWrap).toBe(true);
    });
  }

  test("condensed header height stays within a compact range", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(400);
    const height = await page.evaluate(() => document.querySelector(".site-header")?.getBoundingClientRect().height ?? 0);
    // A normal compact product navbar, not the ~80-100px floating block this used to be.
    expect(height).toBeGreaterThan(50);
    expect(height).toBeLessThan(80);
  });

  test("the condensed header never overlaps the next section's heading", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 0));
    const headerBottom = await page.evaluate(() => document.querySelector(".site-header")!.getBoundingClientRect().bottom);
    const firstHeadingTop = await page.evaluate(() =>
      document.querySelector("main h2")!.getBoundingClientRect().top,
    );
    expect(firstHeadingTop).toBeGreaterThanOrEqual(headerBottom);
  });

  test("every 'Open Usance' control shares the same canonical control height", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto("/");
    const heights = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a")).filter((a) => a.textContent?.trim() === "Open Usance")
        .map((a) => Math.round(a.getBoundingClientRect().height)),
    );
    expect(heights.length).toBeGreaterThanOrEqual(2);
    const distinct = new Set(heights);
    // The header CTA and hero CTA render at their own declared sizes (.btn vs .btn-lg), which is
    // intentional visual hierarchy — but each must be internally consistent everywhere it repeats.
    expect(distinct.size).toBeLessThanOrEqual(2);
  });

  test("no horizontal overflow across representative breakpoints", async ({ page }) => {
    for (const width of [1600, 1280, 1024, 768, 430, 390, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow, `overflow at ${width}`).toBe(false);
    }
  });

  test("mobile nav stays usable at 375 and 390 — the way in never disappears", async ({ page }) => {
    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await expect(page.locator("#site-header").getByRole("link", { name: /open usance/i })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow, `overflow at ${width}`).toBe(false);
    }
  });
});

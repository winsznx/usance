import { test, expect } from "@playwright/test";

/**
 * The application frame, on both widths.
 *
 * One component produces the desktop rail and the phone layout, so these tests exist to prove the
 * two really are one thing: the same destinations, the same active state, and no route that is
 * reachable on a desktop and stranded on a phone.
 */

const NAV_LABELS = ["Overview", "Position", "Activity", "Alerts", "Assets", "Mandates", "Earn", "Settings"];

test.describe("desktop rail", () => {
  // Keyed on the device capability rather than forced with a viewport override. The mobile project
  // is a Pixel 7 descriptor, and widening its viewport produces a phone that is not a phone: the
  // rail would then be under test in a configuration no real user is ever in.
  test.skip(({ isMobile }) => isMobile === true, "desktop layout only");

  test("shows every destination", async ({ page }) => {
    await page.goto("/app");
    const rail = page.getByRole("navigation", { name: "Main" });
    for (const label of NAV_LABELS) {
      await expect(rail.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("marks the current route for assistive technology, not only by colour", async ({ page }) => {
    await page.goto("/app/alerts");
    const rail = page.getByRole("navigation", { name: "Main" });
    // aria-current is the machine-readable channel. A background tint alone tells a screen reader
    // nothing about where the user is.
    await expect(rail.getByRole("link", { name: "Alerts", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(rail.getByRole("link", { name: "Overview", exact: true })).not.toHaveAttribute("aria-current", "page");
  });

  test("collapses to icons and remembers the choice", async ({ page }) => {
    await page.goto("/app");
    const toggle = page.getByRole("button", { name: /collapse navigation/i });
    await toggle.click();

    // Collapsed labels are removed from the accessible tree as well as from view — a hidden label
    // that is still announced makes the rail read as a duplicated menu.
    await expect(page.getByRole("navigation", { name: "Main" }).getByText("Overview", { exact: true })).toBeHidden();

    // Somebody who collapsed the rail meant it. Restoring it on navigation is a small betrayal.
    await page.goto("/app/alerts");
    await expect(page.getByRole("button", { name: /expand navigation/i })).toBeVisible();
  });

  test("has no bottom tab bar", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  });
});

test.describe("phone layout", () => {
  test.skip(({ isMobile }) => isMobile !== true, "phone layout only");

  test("puts frequent destinations under the thumb", async ({ page }) => {
    await page.goto("/app");
    const tabs = page.getByRole("navigation", { name: "Primary" });
    await expect(tabs).toBeVisible();

    // The four things people do repeatedly. The top of a phone screen is the hardest place to
    // reach, so these live at the bottom rather than behind a menu.
    for (const label of ["Overview", "Position", "Activity", "Alerts"]) {
      await expect(tabs.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("every tab target clears the minimum tap size", async ({ page }) => {
    await page.goto("/app");
    const tabs = page.getByRole("navigation", { name: "Primary" }).getByRole("link");
    for (const tab of await tabs.all()) {
      const box = await tab.boundingBox();
      expect(box?.height ?? 0, "a tab is smaller than 44px").toBeGreaterThanOrEqual(44);
    }
  });

  test("the drawer reaches everything the rail does", async ({ page }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: /open navigation/i }).click();

    const drawer = page.getByRole("navigation", { name: "All destinations" });
    for (const label of NAV_LABELS) {
      await expect(drawer.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("the drawer closes on escape and on navigating", async ({ page }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: /open navigation/i }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: "All destinations" })).toBeHidden();

    await page.getByRole("button", { name: /open navigation/i }).click();
    await page.getByRole("navigation", { name: "All destinations" }).getByRole("link", { name: "Alerts", exact: true }).click();
    // Leaving it open over the destination is the commonest phone navigation bug, and it makes the
    // app feel like it never registered the tap.
    await expect(page.getByRole("navigation", { name: "All destinations" })).toBeHidden();
    await expect(page).toHaveURL(/\/app\/alerts/);
  });

  test("does not scroll sideways", async ({ page }) => {
    await page.goto("/app");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});

test.describe("the overview invents no data", () => {
  test("draws no time series", async ({ page }) => {
    await page.goto("/app");
    const body = (await page.locator("body").innerText()).toLowerCase();

    // There is no historical series in this product. A revenue-style chart here would be drawn from
    // data that does not exist, which is the one thing a risk interface must never do.
    expect(body).not.toMatch(/last 7 days|vs prior week|revenue over time/);
  });

  test("greets nobody", async ({ page }) => {
    await page.goto("/app");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(/good morning|good afternoon|welcome back/);
  });
});

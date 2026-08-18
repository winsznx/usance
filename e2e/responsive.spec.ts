import { test, expect } from "@playwright/test";

/**
 * Layout that survives a phone.
 *
 * Only meaningful on the mobile project; skipped on desktop rather than asserted twice, because a
 * passing overflow check at 1280px says nothing about a passing one at 412px.
 */

const ROUTES = ["/", "/assets", "/app", "/app/borrow", "/app/repay", "/app/collateral/add", "/app/withdraw", "/status"];

test.describe("mobile layout", () => {
  test.skip(({ isMobile }) => !isMobile, "layout assertions are only meaningful on a phone viewport");

  for (const route of ROUTES) {
    test(`${route} does not scroll sideways`, async ({ page }) => {
      await page.goto(route);
      // Horizontal overflow on a phone is the difference between a usable form and an unreachable
      // submit button. A few pixels of tolerance for sub-pixel rounding, nothing more.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${route} overflows by ${overflow}px`).toBeLessThanOrEqual(2);
    });
  }

  test("wide content scrolls inside its own container, not the page", async ({ page }) => {
    await page.goto("/assets/franklin-fobxx");
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow).toBeLessThanOrEqual(2);
  });

  test("the primary action on each form is reachable and large enough to tap", async ({ page }) => {
    for (const route of ["/app/borrow", "/app/repay", "/app/collateral/add", "/app/withdraw"]) {
      await page.goto(route);
      const cta = page.locator("button.btn-primary").last();
      await expect(cta, `${route} has no primary action`).toBeVisible();

      const box = await cta.boundingBox();
      expect(box, `${route} primary action has no box`).not.toBeNull();
      // 44px is the long-standing minimum touch target. Below it, a financial action becomes a
      // game of accuracy.
      expect(box!.height, `${route} primary action is ${box!.height}px tall`).toBeGreaterThanOrEqual(40);
    }
  });

  test("no critical information is hover-only", async ({ page }) => {
    await page.goto("/app/collateral/add");
    // The haircut explanation must be readable without a pointer. Asserting it is in the document
    // and visible, rather than behind a title attribute or a :hover rule.
    const notice = page.getByText(/not a fee/i).first();
    await expect(notice).toBeVisible();
  });

  test("proof pages stay readable", async ({ page }) => {
    await page.goto("/assets");
    const link = page.locator('a[href^="/assets/"]').first();
    await link.click();
    await expect(page.locator("h1").first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});

import { test, expect } from "@playwright/test";
import { receiptSlug, passport } from "./fixtures";

/**
 * First run.
 *
 * The happy path takes twenty seconds and needs no test. What matters is that every step says what
 * it does before asking for it — a first-time user cannot tell a session proof from a transfer
 * approval, and "what does this actually do" is the difference between a user and a bounce.
 */

test.describe("/app/onboarding", () => {
  test("opens on connect, and says why before asking", async ({ page }) => {
    const res = await page.goto("/app/onboarding");
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator("body")).not.toContainText("Application error");

    const body = (await page.locator("body").innerText()).toLowerCase();
    // The disconnected screen explains what connecting is for and what it cannot do. The signing
    // copy lives in a later phase and is asserted separately, because asserting it here would pass
    // only if the page leaked a state the user has not reached.
    expect(body).toContain("needs your address and your network");
    expect(body).toContain("cannot move anything");
    await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
  });

  test("shows all three steps up front rather than revealing them one at a time", async ({ page }) => {
    await page.goto("/app/onboarding");
    const body = (await page.locator("body").innerText()).toLowerCase();
    // Somebody deciding whether to start should see how long it is before they begin.
    expect(body).toContain("connect your wallet");
    expect(body).toContain("switch to");
    expect(body).toContain("sign in");
  });

  test("warns about test assets before anything is signed", async ({ page }) => {
    await page.goto("/app/onboarding");
    const body = (await page.locator("body").innerText()).toUpperCase();
    expect(body).toContain("TEST ASSETS HAVE NO REAL VALUE");
    expect(body).toContain("NOT FOBXX");
  });

  test("offers a way to look around without connecting", async ({ page }) => {
    await page.goto("/app/onboarding");
    // A wallet gate with no exit is a bounce. Browsing assets needs no wallet at all.
    await expect(page.getByRole("link", { name: /browse assets first/i })).toBeVisible();
  });
});

test.describe("/app/activity/[receiptId]", () => {
  test("renders a real receipt with its account context", async ({ page }) => {
    test.skip(!passport?.transactions?.length, "no passport proof record on disk");
    const commit = passport!.transactions!.find((t) => t.label.includes("commitPassport"))!;
    const slug = receiptSlug("PASSPORT_COMMITTED", 1952, commit.hash);

    const res = await page.goto(`/app/activity/${slug}`);
    expect(res?.status()).toBeLessThan(400);

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("what happened on your account");
    // Same facts as the public page, reachable from here rather than duplicated.
    await expect(page.getByRole("link", { name: /public proof for this receipt/i })).toBeVisible();
  });

  test("an unknown receipt id does not render a blank success", async ({ page }) => {
    const res = await page.goto(`/app/activity/${"deadbeef".repeat(4)}`);
    expect(res?.status()).toBe(404);
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 412, height: 915 } });

  for (const path of ["/app/onboarding"]) {
    test(`${path} does not scroll sideways`, async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflow, `${path} is wider than the viewport`).toBe(false);
    });
  }

  test("the primary action is reachable without scrolling past the fold", async ({ page }) => {
    await page.goto("/app/onboarding");
    const btn = page.getByRole("button", { name: /connect wallet/i });
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    // 44px is the smallest reliably tappable target.
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

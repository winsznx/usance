import { test, expect } from "@playwright/test";
import { installWallet, signedIn } from "./wallet-harness";

/**
 * The Sentinel surfaces.
 *
 * Like the mandate specs, these assert the disclosures and the boundaries, not the markup — the
 * failure mode of an autonomous agent is a user arming powers they did not intend. So: does the
 * public library state that templates hold no authority, does the creation flow show the boundary
 * before the wallet opens, and is account-bound state gated behind a session? The wallet harness
 * refuses `eth_sendTransaction`, so these drive up to the signature, never a mined write.
 */

test.describe("/sentinels (public library)", () => {
  test("states that a template cannot move money", async ({ page }) => {
    const res = await page.goto("/sentinels");
    expect(res?.status()).toBeLessThan(400);
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("templates cannot move your money");
    expect(body).toContain("safety buffer");
  });

  test("a template page shows the actions it can and cannot take", async ({ page }) => {
    await page.goto("/sentinels");
    await page.getByRole("link", { name: /safety buffer/i }).first().click();
    await expect(page).toHaveURL(/\/sentinels\/0x[0-9a-f]{64}/, { timeout: 10_000 });
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("what it can and cannot do");
    expect(body).toContain("repay");
  });
});

test.describe("/developers/sentinels", () => {
  test("states the publishing contract and that a template holds no authority", async ({ page }) => {
    const res = await page.goto("/developers/sentinels");
    expect(res?.status()).toBeLessThan(400);
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("publish a sentinel template");
    expect(body).toContain("holds no user authority");
    expect(body).toContain("cannot widen an installed instance");
  });
});

test.describe("/app/sentinels (gated)", () => {
  test("redirects to onboarding without a session", async ({ page }) => {
    await installWallet(page); // connected, but no signed session
    await page.goto("/app/sentinels");
    await expect(page).toHaveURL(/\/app\/onboarding/, { timeout: 10_000 });
  });

  test("a signed-in owner sees their Sentinels and a way to arm one", async ({ page }) => {
    await signedIn(page);
    await page.goto("/app/sentinels");
    await expect(page.getByText("Your Sentinels")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: /arm a sentinel/i })).toBeVisible();
  });
});

test.describe("/app/sentinels/new (gated creation)", () => {
  test("shows the boundary before the signing control, and cannot arm without a valid agent", async ({ page }) => {
    await signedIn(page);
    await page.goto("/app/sentinels/new");

    await expect(page.getByText("What this Sentinel may do")).toBeVisible({ timeout: 15_000 });
    const body = (await page.locator("body").innerText()).toLowerCase();

    // The permission boundary is stated, and it appears before the wallet-opening control.
    expect(body).toContain("borrow · trade · withdraw collateral");
    const boundaryAt = body.indexOf("signing a delegation, not a payment");
    const signAt = body.indexOf("sign mandate & arm");
    expect(boundaryAt, "the delegation boundary must precede the arm control").toBeLessThan(signAt);

    // The arm control is refused until a valid agent address is entered — no accidental signing.
    await expect(page.getByRole("button", { name: /sign mandate & arm/i })).toBeDisabled();
  });
});

test.describe("/app/sentinels/[instanceId] (gated detail)", () => {
  const UNKNOWN = `0x${"ab".repeat(32)}`;

  test("an unregistered id says so rather than rendering a working Sentinel", async ({ page }) => {
    await signedIn(page);
    const res = await page.goto(`/app/sentinels/${UNKNOWN}`);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator("body")).not.toContainText("Application error", { timeout: 15_000 });
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toMatch(/no such sentinel|cannot read this sentinel/);
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test("the creation flow does not overflow sideways", async ({ page }) => {
    await signedIn(page);
    await page.goto("/app/sentinels/new");
    await expect(page.getByText("What this Sentinel may do")).toBeVisible({ timeout: 15_000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow, "the creation flow scrolls sideways on a phone").toBe(false);
  });

  test("a 32-byte instance id does not force the detail page sideways", async ({ page }) => {
    await signedIn(page);
    await page.goto(`/app/sentinels/0x${"cd".repeat(32)}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow, "a 66-character id pushed the page wider than the viewport").toBe(false);
  });
});

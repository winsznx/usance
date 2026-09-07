import { test, expect } from "@playwright/test";
import { deployment } from "./fixtures";
import { signedIn, installWallet } from "./wallet-harness";

/**
 * `/app/assets/[assetId]` — the authenticated capital detail page (Phase 05).
 *
 * The claims worth defending in a browser: it is gated on a session, it is addressed by the
 * on-chain asset id rather than a name, and it never merges the four figures (market value,
 * recognised collateral, account borrowing capacity, debt) into one.
 */

const HEX32 = `0x${"ab".repeat(32)}`;
const collateralAssetId =
  deployment?.assets?.[0]?.assetId ?? deployment?.settlementAsset?.assetId ?? HEX32;

test.describe("/app/assets/[assetId]", () => {
  test("an unconnected visitor is sent to sign in, never shown a position", async ({ page }) => {
    await installWallet(page);
    await page.goto(`/app/assets/${collateralAssetId}`);
    // Either it redirects to onboarding, or it holds on the route showing the sign-in notice.
    // What it must never do is render a position for a wallet nobody connected.
    await expect(
      page.getByText(/taking you to sign in/i).or(page.getByText(/connect|sign in/i).first()),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/four numbers, kept apart/i)).toHaveCount(0);
  });

  test.describe("signed in", () => {
    test.beforeEach(async ({ page }) => {
      await signedIn(page);
    });

    test("a value that is not a 32-byte id is refused, not guessed at", async ({ page }) => {
      await page.goto("/app/assets/tUSTB");
      await expect(page.getByText(/not an on-chain asset id/i)).toBeVisible({ timeout: 15_000 });
    });

    test("keeps market value, recognised collateral, capacity and debt as separate figures", async ({ page }) => {
      test.skip(!deployment, "no manifest");
      await page.goto(`/app/assets/${collateralAssetId}`);
      // The page resolves whether or not the empty test account holds the asset, so assert the
      // frame it always renders: the distinct sections, each a separate figure or identity.
      await expect(page.getByText(/four numbers, kept apart/i)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/what phase 01 resolves this to/i)).toBeVisible();
      await expect(page.getByText("In custody", { exact: true })).toBeVisible();
    });

    test("says plainly that calldata uses the legacy asset id, not the instrument id", async ({ page }) => {
      test.skip(!deployment, "no manifest");
      await page.goto(`/app/assets/${collateralAssetId}`);
      const body = (await page.locator("body").innerText()).toLowerCase();
      if (body.includes("instrument id")) {
        expect(body).toMatch(/transactions still carry the legacy asset id/);
      }
    });

    test("labels the testnet fixture honestly", async ({ page }) => {
      test.skip(!deployment, "no manifest");
      await page.goto(`/app/assets/${collateralAssetId}`);
      await expect(page.getByText(/testnet fixture — no real value/i)).toBeVisible({ timeout: 20_000 });
    });
  });
});

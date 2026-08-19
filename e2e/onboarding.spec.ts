import { test, expect } from "@playwright/test";
import { receiptSlug, passport } from "./fixtures";
import { installWallet, signedIn } from "./wallet-harness";

/**
 * First run, in the one place Usance asks for a wallet.
 *
 * Every signed-in route used to carry its own connect prompt, so a person could meet the same
 * question four different ways on four screens. Onboarding now owns the whole sequence and the
 * account routes redirect here, which is what these assert.
 */

test.describe("/app/onboarding", () => {
  test("asks to connect, and says what connecting does", async ({ page }) => {
    const res = await page.goto("/app/onboarding");
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator("body")).not.toContainText("Application error");

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("needs your address and your network");
    expect(body).toContain("shows usance your address and nothing else");
    await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
  });

  test("shows the whole sequence up front", async ({ page }) => {
    await page.goto("/app/onboarding");
    const steps = page.getByRole("list", { name: "Progress" });
    // Somebody deciding whether to start should see how long it is before they begin.
    await expect(steps).toContainText("Connect");
    await expect(steps).toContainText("Switch to");
    await expect(steps).toContainText("Sign in");
  });

  test("explains Usance while the wallet dialogs are open", async ({ page }) => {
    await page.goto("/app/onboarding");
    const brief = page.getByRole("complementary", { name: "About Usance" });
    // The reason this is a split and not a modal: connecting is three wallet round-trips, and
    // somebody waiting through them should be reading rather than watching a spinner.
    await expect(brief).toBeVisible();
    await expect(brief).toContainText(/reads the document|usable|evidence changes|inside limits/i);
  });

  test("the brief can be stepped through by hand", async ({ page }) => {
    await page.goto("/app/onboarding");
    const dots = page.getByRole("list", { name: /point \d of \d/i }).getByRole("button");
    expect(await dots.count()).toBe(4);
    await dots.nth(3).click();
    await expect(page.getByRole("complementary", { name: "About Usance" })).toContainText(/never withdraw your collateral/i);
  });

  test("warns about test assets before anything is signed", async ({ page }) => {
    await page.goto("/app/onboarding");
    const body = (await page.locator("body").innerText()).toUpperCase();
    expect(body).toContain("TEST ASSETS HAVE NO REAL VALUE");
    expect(body).toContain("NOT FOBXX");
  });

  test("offers a way to look around without connecting", async ({ page }) => {
    await page.goto("/app/onboarding");
    // A wallet gate with no exit is a bounce by construction.
    await expect(page.getByRole("link", { name: /look around without connecting/i })).toBeVisible();
  });
});

test.describe("account routes ask once, not on every page", () => {
  for (const path of ["/app/positions", "/app/alerts", "/app/settings", "/app/settings/security"]) {
    test(`${path} sends an unconnected visitor to onboarding`, async ({ page }) => {
      await page.goto(path);
      // The whole point of the change: one screen owns the question.
      await expect(page).toHaveURL(/\/app\/onboarding/, { timeout: 10_000 });
    });
  }
});

test.describe("/app/activity/[receiptId]", () => {
  test("renders a real receipt with its account context", async ({ page }) => {
    test.skip(!passport?.transactions?.length, "no passport proof record on disk");
    const commit = passport!.transactions!.find((t) => t.label.includes("commitPassport"))!;
    await page.goto(`/app/activity/${receiptSlug("PASSPORT_COMMITTED", 1952, commit.hash)}`);

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("what happened on your account");
    await expect(page.getByRole("link", { name: /public proof for this receipt/i })).toBeVisible();
  });

  test("an unknown receipt id does not render a blank success", async ({ page }) => {
    const res = await page.goto(`/app/activity/${"deadbeef".repeat(4)}`);
    expect(res?.status()).toBe(404);
  });
});

test.describe("mobile", () => {
  test.skip(({ isMobile }) => isMobile !== true, "phone layout only");

  test("onboarding does not scroll sideways", async ({ page }) => {
    await page.goto("/app/onboarding");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });

  test("the brief survives on a phone rather than being dropped", async ({ page }) => {
    await page.goto("/app/onboarding");
    // Dropping it would mean the only people who never learn what Usance is are the ones on the
    // smallest screens, who have the least context to begin with.
    await expect(page.getByRole("complementary", { name: "About Usance" })).toBeVisible();
  });

  test("the primary action clears the minimum tap size", async ({ page }) => {
    await page.goto("/app/onboarding");
    const box = await page.getByRole("button", { name: /connect wallet/i }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

test.describe("connection is not a session", () => {
  test("a wallet that is already connected still goes through onboarding", async ({ page }) => {
    // The bug this exists to prevent. `eth_accounts` reports an address for any site the wallet has
    // ever been connected to, so gating on it dropped a returning visitor straight into the
    // dashboard having never seen onboarding and never signed anything. `/security` spends a page
    // on exactly this distinction and the gate was contradicting it.
    await installWallet(page);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app\/onboarding/, { timeout: 10_000 });
  });

  test("a signed-in browser goes straight to the dashboard", async ({ page }) => {
    await signedIn(page);
    await page.goto("/app");
    await expect(page.getByText("Recognised collateral")).toBeVisible({ timeout: 15_000 });
  });

  test("a session signed for another address is refused", async ({ page }) => {
    // The session is bound to the address it was signed for. A wallet that switched accounts holds
    // somebody else's signature, and showing one person another person's position is not
    // recoverable by an apology.
    await signedIn(page, { account: "0x2222222222222222222222222222222222222222" });
    await page.addInitScript(() => {
      sessionStorage.setItem("usance.session", "0x9999999999999999999999999999999999999999");
    });
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app\/onboarding/, { timeout: 10_000 });
  });

  test("Launch Usance enters through onboarding, not the dashboard", async ({ page }) => {
    await installWallet(page);
    await page.goto("/");
    await page.getByRole("link", { name: /launch usance/i }).first().click();
    await expect(page).toHaveURL(/\/app\/onboarding/);
  });
});

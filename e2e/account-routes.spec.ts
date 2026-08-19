import { test, expect } from "@playwright/test";

/**
 * Signed-in routes, without a wallet.
 *
 * These used to assert the content each page shows a stranger. That content is no longer reachable
 * without a wallet: onboarding owns the connect question and account routes redirect to it, which
 * is the behaviour being asserted here.
 *
 * The trade is recorded rather than hidden. The security explainer — what a session grants, what an
 * allowance outlives, what a mandate can never do — is reference material that was useful *before*
 * connecting, and it now sits behind the gate. That is tracked as a P1 in the master checklist, not
 * quietly accepted.
 */

const ACCOUNT_ROUTES = ["/app/positions", "/app/alerts", "/app/settings", "/app/settings/security"];

test.describe("one screen owns the connect question", () => {
  for (const path of ACCOUNT_ROUTES) {
    test(`${path} redirects an unconnected visitor to onboarding`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/app\/onboarding/, { timeout: 10_000 });
    });

    test(`${path} never renders an empty account`, async ({ page }) => {
      await page.goto(path);
      await page.waitForURL(/\/app\/onboarding/, { timeout: 10_000 });
      const body = await page.locator("body").innerText();
      // An empty portfolio rendered for somebody who never connected reads as "you have nothing",
      // which is a claim about the reader rather than a state.
      expect(body).not.toMatch(/\$0\.00\s*(recognised|debt)/i);
      expect(body).not.toContain("Application error");
    });
  }
});

test.describe("health and readiness", () => {
  test("health reports liveness without checking dependencies", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect((await res.json()).status).toBe("alive");
  });

  test("readiness names every dependency and what is blocking", async ({ request }) => {
    const res = await request.get("/api/ready");
    // 503 is a correct answer, not a failure: it means Usance cannot safely quote right now.
    expect([200, 503]).toContain(res.status());

    const body = await res.json();
    expect(body.checks.map((c: { name: string }) => c.name)).toContain("rpc");
    expect(body.checks.map((c: { name: string }) => c.name)).toContain("deployment-manifest");

    // "Not ready" with no reason is an alert nobody can act on at three in the morning.
    if (body.ready === false) expect(body.blockedBy.length).toBeGreaterThan(0);
    for (const c of body.checks) expect(c.detail.length).toBeGreaterThan(0);
  });

  test("the account API refuses a malformed address", async ({ request }) => {
    expect((await request.get("/api/account?account=nope")).status()).toBe(400);
    expect((await request.get("/api/account")).status()).toBe(400);
  });

  test("the activity API refuses a malformed address", async ({ request }) => {
    expect((await request.get("/api/activity?account=nope")).status()).toBe(400);
  });
});

test.describe("mobile", () => {
  test.skip(({ isMobile }) => isMobile !== true, "phone layout only");

  for (const path of ACCOUNT_ROUTES) {
    test(`${path} does not scroll sideways on a phone`, async ({ page }) => {
      await page.goto(path);
      await page.waitForURL(/\/app\/onboarding/, { timeout: 10_000 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflow, `${path} is wider than the viewport`).toBe(false);
    });
  }
});

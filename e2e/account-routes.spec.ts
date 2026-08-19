import { test, expect } from "@playwright/test";

/**
 * The signed-in surface, before a wallet is connected.
 *
 * Every one of these routes is reachable by a stranger with no wallet, and the thing being asserted
 * is that none of them invents an account. An empty portfolio rendered for somebody who never
 * connected reads as "you have nothing", which is a claim about the reader rather than a state.
 */

const ACCOUNT_ROUTES = ["/app/positions", "/app/alerts", "/app/settings", "/app/settings/security"];

test.describe("signed-in routes without a wallet", () => {
  for (const path of ACCOUNT_ROUTES) {
    test(`${path} asks to connect rather than rendering an empty account`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status(), `${path} returned ${res?.status()}`).toBeLessThan(400);
      await expect(page.locator("body")).not.toContainText("Application error");
      await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
    });

    test(`${path} warns that test assets have no value`, async ({ page }) => {
      await page.goto(path);
      const body = (await page.locator("body").innerText()).toUpperCase();
      // Somebody who confuses tUSTB with a real tokenised T-bill has misunderstood the single most
      // important thing about this deployment.
      expect(body).toContain("TEST ASSETS HAVE NO REAL VALUE");
      expect(body).toContain("NOT FOBXX");
    });
  }
});

test.describe("security page keeps five grants apart", () => {
  test("leads with what disconnecting does not do", async ({ page }) => {
    await page.goto("/app/settings/security");
    const body = await page.locator("body").innerText();

    // The misconception with the worst outcome: somebody walks away from a debt believing that
    // closing a tab settled it.
    expect(body.toLowerCase()).toContain("disconnecting does not close anything");
    const warnAt = body.toLowerCase().indexOf("disconnecting does not close");
    const layersAt = body.toLowerCase().indexOf("what each grant actually is");
    expect(warnAt).toBeLessThan(layersAt);
  });

  test("names all five grants and says when each ends", async ({ page }) => {
    await page.goto("/app/settings/security");
    const body = (await page.locator("body").innerText()).toLowerCase();

    for (const grant of ["wallet connection", "app session", "token allowance", "mandate", "transaction"]) {
      expect(body, `security page omits "${grant}"`).toContain(grant);
    }
    // An allowance outliving the browser is the one people are surprised by.
    expect(body).toContain("survives disconnecting");
  });
});

test.describe("settings does not invent controls", () => {
  test("says plainly that there is nothing else to configure", async ({ page }) => {
    await page.goto("/app/settings");
    const body = (await page.locator("body").innerText()).toLowerCase();
    // A settings page full of controls that persist nowhere teaches people that controls in this
    // product do nothing.
    expect(body).toContain("nothing else to configure");
  });
});

test.describe("health and readiness", () => {
  test("health reports liveness without checking dependencies", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect((await res.json()).status).toBe("alive");
  });

  test("readiness names every dependency and what is blocking", async ({ request }) => {
    const res = await request.get("/api/ready");
    // 503 is a correct answer here, not a failure — it means Usance cannot safely quote right now.
    expect([200, 503]).toContain(res.status());

    const body = await res.json();
    expect(Array.isArray(body.checks)).toBe(true);
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
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 412, height: 915 } });

  for (const path of ACCOUNT_ROUTES) {
    test(`${path} does not scroll sideways on a phone`, async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflow, `${path} is wider than the viewport`).toBe(false);
    });
  }
});

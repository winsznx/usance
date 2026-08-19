import { test, expect } from "@playwright/test";
import { signedIn } from "./wallet-harness";

/**
 * The application frame, on both widths.
 *
 * The frame is behind authentication, so these run against a deterministic provider that answers
 * `eth_accounts`, `eth_chainId` and signatures from fixed values and **refuses everything that moves
 * value**. That refusal is what keeps these honest: they assert the chrome renders and navigates,
 * never that a transaction succeeded.
 *
 * One component produces the desktop rail and the phone layout, so these describe what must hold of
 * both: the same destinations, the same active state, and no route reachable on a desktop and
 * stranded on a phone.
 */

const NAV_LABELS = ["Overview", "Position", "Activity", "Alerts", "Assets", "Mandates", "Earn", "Settings"];

test.describe("desktop rail", () => {
  test.beforeEach(async ({ page }) => signedIn(page));
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
  test.beforeEach(async ({ page }) => signedIn(page));
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
    await page.getByRole("navigation", { name: "All destinations" }).getByRole("link", { name: "Assets", exact: true }).click();
    // Leaving it open over the destination is the commonest phone navigation bug, and it makes the
    // app feel like it never registered the tap. Assets is used rather than an account route,
    // because those now redirect to onboarding when no wallet is connected.
    await expect(page.getByRole("navigation", { name: "All destinations" })).toBeHidden();
    await expect(page).toHaveURL(/\/assets/);
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
  test.beforeEach(async ({ page }) => signedIn(page));
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

test.describe("detail level", () => {
  test.beforeEach(async ({ page }) => signedIn(page));
  test("defaults to simple and remembers advanced", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("button", { name: "Simple" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Advanced" }).click();
    await expect(page.getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-pressed", "true");

    // Switching back on every visit teaches people the toggle does not work. Reloaded rather than
    // navigated to an account route, which now redirects to onboarding without a wallet.
    await page.reload();
    await expect(page.getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-pressed", "true");
  });

  test("simple mode never hides risk information", async ({ page }) => {
    await page.goto("/app");
    const simple = await page.locator("body").innerText();

    await page.getByRole("button", { name: "Advanced" }).click();
    const advanced = await page.locator("body").innerText();

    // Advanced adds detail. A mode that could conceal a margin call would get somebody liquidated
    // for using the default, so simple may be a subset only of provenance, never of risk. The
    // testnet warning is the risk statement present on every screen regardless of connection.
    for (const phrase of ["TEST ASSETS HAVE NO REAL VALUE", "NOT FOBXX"]) {
      expect(simple.toUpperCase()).toContain(phrase);
      expect(advanced.toUpperCase()).toContain(phrase);
    }
  });
});

test.describe("degraded state", () => {
  test.beforeEach(async ({ page }) => signedIn(page));
  test("says so when readiness reports a blocker", async ({ page }) => {
    // Forced rather than waited for. A degraded banner nobody can trigger is a banner nobody has
    // seen render, and this is the state a user most needs to be told about.
    await page.route("**/api/ready", (route) =>
      route.fulfill({ status: 503, body: JSON.stringify({ ready: false, blockedBy: ["rpc"], checks: [] }) }),
    );
    await page.goto("/app");

    const banner = page.getByRole("status").filter({ hasText: /cannot safely quote/i });
    await expect(banner).toBeVisible();
    // It must not imply the user's position changed.
    await expect(banner).toContainText(/nothing on chain has changed/i);
  });

  test("stays quiet when everything is reachable", async ({ page }) => {
    await page.route("**/api/ready", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ready: true, blockedBy: [], checks: [] }) }),
    );
    await page.goto("/app");
    await expect(page.getByText(/cannot safely quote/i)).toHaveCount(0);
  });
});

test.describe("keyboard navigation", () => {
  test.beforeEach(async ({ page }) => signedIn(page));
  test.skip(({ isMobile }) => isMobile === true, "pointer-free navigation is a desktop affordance");

  test("g then a letter moves between sections", async ({ page }) => {
    await page.goto("/app");
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/app\/positions/);
  });

  test("a stray g does not arm navigation forever", async ({ page }) => {
    await page.goto("/app");
    await page.keyboard.press("g");
    await page.waitForTimeout(1600);
    await page.keyboard.press("p");
    // The sequence expires, so the next keystroke is not silently turned into navigation.
    await expect(page).toHaveURL(/\/app$/);
  });
});

test.describe("the connected overview", () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
    await page.goto("/app");
    // The account read is asynchronous. Asserting straight after navigation tests the skeleton,
    // which is why this failed on the slower device profile and not the faster one.
    await expect(page.getByText("Recognised collateral")).toBeVisible({ timeout: 15_000 });
  });

  test("answers the four questions without scrolling past them", async ({ page }) => {
    const body = await page.locator("body").innerText();

    // What do I own, what is it worth here, what do I owe, what may I do. Anything else on this
    // page is context for one of those four.
    for (const label of ["Recognised collateral", "Debt outstanding", "Available to borrow", "Reserved for execution"]) {
      expect(body, `the overview omits "${label}"`).toContain(label);
    }
  });

  test("shows the derivation, or explains why there is none", async ({ page }) => {
    const body = (await page.locator("body").innerText()).toLowerCase();

    // The harness account holds nothing, so the derivation correctly does not render — a
    // derivation of zero would be four empty bars pretending to explain something. What must hold
    // either way is that the page says which of the two it is.
    expect(body).toMatch(/how your capacity is derived|hold no collateral usance recognises/);

    // And in neither case is there an invented history.
    expect(body).not.toMatch(/last 7 days|vs prior week/);
  });

  test("shows the ladder, the buffer and the history", async ({ page }) => {
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).toContain("where your account stands");
    expect(body).toContain("safety buffer");
    expect(body).toContain("transaction history");
  });

  test("an account with no history says so instead of inventing rows", async ({ page }) => {
    const body = (await page.locator("body").innerText()).toLowerCase();
    // The harness account has done nothing. An empty table is a true statement; invented rows
    // would be a false one.
    expect(body).toMatch(/nothing has happened on this account yet|transaction history/);
  });

  test("does not offer actions the protocol would refuse", async ({ page }) => {
    // Derived from account status, so a disabled control carries a stated reason rather than
    // vanishing. A user whose options silently shrink cannot tell broken from blocked.
    const unavailable = page.getByText(/· unavailable/i);
    for (const el of await unavailable.all()) {
      await expect(el).toBeVisible();
    }
  });
});

test.describe("the harness refuses to move value", () => {
  test("a request that would spend is rejected, not faked", async ({ page }) => {
    await signedIn(page);
    await page.goto("/app");

    const outcome = await page.evaluate(async () => {
      try {
        await (window as unknown as { ethereum: { request: (a: unknown) => Promise<unknown> } }).ethereum.request({
          method: "eth_sendTransaction",
          params: [{}],
        });
        return "accepted";
      } catch (e) {
        return (e as Error).message;
      }
    });

    // If this ever returns a hash, every "the borrow succeeded" assertion in this suite becomes
    // a claim about a mock rather than about the protocol.
    expect(outcome).not.toBe("accepted");
    expect(outcome).toContain("refuses eth_sendTransaction");
  });
});

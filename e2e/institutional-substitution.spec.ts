import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Phase 11B-D — the authenticated substitution-orchestration surface.
 *
 * The institutional session cookie is established through real HTTP calls against the hosted
 * Supabase auth RPCs (`e2e/wallet-harness.ts`'s fake-signature provider cannot pass the server's
 * real ECDSA `verifyMessage` check), using the isolated TESTNET_OPERATOR test wallet. The private
 * key stays in this Node test process — it is never injected into page JavaScript. No test in this
 * file submits a Privy approval, a CRE verdict, or a Hedera transaction.
 */

const FACILITY_ID = "0x6534fdf67d36afeeb7118c7d81c7f4e06ab548735483ca249afcf12e6f75b1ee";
const PRESERVED_REQUEST_ID = "0xb1d927f704bd47533a34d800609827fec3ad95c94620b2843e35ac4a67809526";

test.skip(!process.env.INSTITUTIONAL_TESTNET_OPERATOR_PRIVATE_KEY, "requires the isolated TESTNET_OPERATOR test key");

async function signInCookie(request: APIRequestContext, baseURL: string): Promise<string> {
  const account = privateKeyToAccount(process.env.INSTITUTIONAL_TESTNET_OPERATOR_PRIVATE_KEY as `0x${string}`);
  // Next.js resolves the request origin from its own internal host (localhost), not the
  // 127.0.0.1 baseURL Playwright connects through — match that, not `baseURL`.
  const origin = "http://localhost:3100";
  const issued = await request.post("/api/auth/challenge", {
    headers: { origin }, data: { walletAddress: account.address },
  });
  expect(issued.ok()).toBeTruthy();
  const { challengeId, message } = (await issued.json()) as { challengeId: string; message: string };
  const nonce = (message.match(/Nonce: ([0-9a-f]{64})/) ?? [])[1];
  const signature = await account.signMessage({ message });
  const verified = await request.post("/api/auth/verify", {
    headers: { origin }, data: { challengeId, nonce, signature },
  });
  expect(verified.ok()).toBeTruthy();
  const setCookie = verified.headers()["set-cookie"] ?? "";
  const cookie = setCookie.split(";")[0];
  expect(cookie).toContain("usance_institutional_session=");
  return cookie;
}

async function applyCookie(page: Page, baseURL: string, cookie: string): Promise<void> {
  const [name, value] = cookie.split("=");
  await page.context().addCookies([{ name, value: decodeURIComponent(value), url: baseURL }]);
}

test.describe("institutional substitution orchestration", () => {
  test("an unauthenticated visitor sees a sign-in prompt, never operation state", async ({ page }) => {
    await page.goto(`/institutional/facilities/${FACILITY_ID}/replace`);
    await expect(page.getByText(/sign in as institutional operator/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/requestId/i)).toHaveCount(0);
  });

  test("a signed-in operator recovers the existing durable operation as a completed receipt, not a create form", async ({ page, request, baseURL }) => {
    test.setTimeout(60_000);
    const cookie = await signInCookie(request, baseURL!);
    await applyCookie(page, baseURL!, cookie);

    await page.goto(`/institutional/facilities/${FACILITY_ID}/replace`);
    await expect(page.getByText("Completed", { exact: true })).toBeVisible({ timeout: 20_000 });
    // Only one operation may be active; the create form must not be offered alongside a recovered one.
    await expect(page.getByRole("button", { name: /create substitution request/i })).toHaveCount(0);

    // The receipt's CURRENT section requires two live RPC reads (Hedera + Sepolia); give a reload
    // more headroom than the initial load, which benefits from Next.js's warm route cache.
    await page.reload();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible({ timeout: 40_000 });
  });

  test("current facility state is shown as a live read, distinct from the recovered operation", async ({ page, request, baseURL }) => {
    const cookie = await signInCookie(request, baseURL!);
    await applyCookie(page, baseURL!, cookie);
    await page.goto(`/institutional/facilities/${FACILITY_ID}/replace`);
    await expect(page.getByText(/current hedera facility state/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/read at block/i)).toBeVisible();
  });
});

test.describe("blocked authority path (no chain write)", () => {
  test("a revoked ENS authority blocks the request and existing collateral is shown secured", async ({ page }) => {
    // Route-mocked: exercises the blocked-rendering path without revoking the real Sepolia role,
    // which would be a live authority-changing transaction out of scope for this suite.
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ json: { authenticated: true, caller: { walletAddress: "0x1111111111111111111111111111111111111111", organization: { slug: "usance-phase07-testnet", displayName: "Usance Phase 07 Testnet" }, role: "TESTNET_OPERATOR" }, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } }),
    );
    await page.route(`**/api/facilities/${FACILITY_ID}/substitutions/current`, (route) => route.fulfill({ json: { outcome: "NONE" } }));
    await page.route(`**/api/facilities/${FACILITY_ID}/substitutions`, (route) =>
      route.fulfill({
        status: 201,
        json: { outcome: "CREATED", operation: { state: "AUTHORITY_REVOKED", request_id: `0x${"aa".repeat(32)}` }, preparation: null, readiness: { current: { facilityStatus: "ACTIVE", substitutionState: "NONE" } } },
      }),
    );

    await page.goto(`/institutional/facilities/${FACILITY_ID}/replace`);
    await expect(page.getByRole("button", { name: /create substitution request/i })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /create substitution request/i }).click();

    await expect(page.getByText(/blocked before any collateral changed/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/existing collateral remains secured/i)).toBeVisible();
    await expect(page.getByText("ENS authority — revoked")).toBeVisible();
  });
});

const MOCK_REQUEST_ID = `0x${"cc".repeat(32)}`;

async function mockAuthenticatedSession(page: Page) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { authenticated: true, caller: { walletAddress: "0x2222222222222222222222222222222222222222", organization: { slug: "usance-phase07-testnet", displayName: "Usance Phase 07 Testnet" }, role: "TESTNET_OPERATOR" }, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } }),
  );
}

async function mockOperationRead(page: Page, state: string) {
  const operation = { request_id: MOCK_REQUEST_ID, replacement_instrument_id: "B", requested_units: "150000", state };
  await Promise.all([
    page.route(`**/api/facilities/${FACILITY_ID}/substitutions/current`, (route) =>
      route.fulfill({ json: { outcome: "FOUND", operation } }),
    ),
    page.route(`**/api/facilities/${FACILITY_ID}/substitutions/${MOCK_REQUEST_ID}`, (route) =>
      route.fulfill({
        json: {
          outcome: "FOUND",
          PENDING: { operation, events: [] },
          CURRENT: { outcome: state === "COMPLETED" ? "OLD_RELEASED" : "REPLACEMENT_COMMITTED" },
          TIMELINE: [
            { provenance: "DURABLE_EVENT", title: "Substitution request created", timestamp: "2026-09-11T11:21:42.605798+00:00" },
            { provenance: "DURABLE_EVENT", title: "Organization approval recorded on Hedera", timestamp: "2026-09-11T21:16:16.729002+00:00" },
            { provenance: "DURABLE_EVENT", title: "Lender policy verdict recorded on Hedera", timestamp: "2026-09-11T21:16:37.724138+00:00" },
            { provenance: "DURABLE_EVENT", title: "Replacement collateral requested", timestamp: "2026-09-11T21:43:27.730086+00:00" },
            { provenance: "DURABLE_EVENT", title: "Replacement collateral secured", timestamp: "2026-09-11T21:43:37.790856+00:00" },
            { provenance: "DURABLE_EVENT", title: "Release paused: settlement valuation was stale", timestamp: "2026-09-11T21:46:04.602151+00:00" },
            { provenance: "ONCHAIN_EVIDENCE", title: "One recovery transaction reverted because its gas limit was insufficient", detail: "No partial state change occurred.", txHash: `0x${"11".repeat(32)}`, network: "hedera-testnet", timestamp: null },
            { provenance: "ONCHAIN_EVIDENCE", title: "Existing collateral released", txHash: `0x${"22".repeat(32)}`, network: "hedera-testnet", timestamp: null },
            { provenance: "DURABLE_EVENT", title: "Release paused: replacement valuation was stale", timestamp: "2026-09-11T22:49:28.900215+00:00" },
            ...(state === "COMPLETED" ? [{ provenance: "DURABLE_EVENT", title: "Collateral replacement completed", timestamp: "2026-09-11T22:51:11.384337+00:00" }] : []),
          ],
          HISTORICAL_PROOF: { note: "", references: [] },
        },
      }),
    ),
  ]);
}

test.describe("completed substitution journey (deterministic, no live chain writes)", () => {
  test("shows the completed receipt with facility ACTIVE, financing OPEN, both safety events, and the gas-revert recovery event", async ({ page }) => {
    await mockAuthenticatedSession(page);
    await mockOperationRead(page, "COMPLETED");

    await page.goto(`/institutional/facilities/${FACILITY_ID}/replace`);

    await expect(page.getByText("Completed", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("ACTIVE")).toBeVisible();
    await expect(page.getByText("Financing remains open")).toBeVisible();
    await expect(page.getByText(/RELEASED/)).toBeVisible();
    await expect(page.getByText(/150000 SECURED|SECURED/)).toBeVisible();

    await expect(page.getByText("Organization authority")).toBeVisible();
    await expect(page.getByText("Lender policy")).toBeVisible();
    await expect(page.getByText("LIVE_SIMULATION")).toBeVisible();
    await expect(page.getByText("Collateral operations")).toBeVisible();

    await expect(page.getByText(/Release paused: settlement valuation was stale/i)).toBeVisible();
    await expect(page.getByText(/Release paused: replacement valuation was stale/i)).toBeVisible();

    await page.getByRole("button", { name: /show evidence timeline/i }).click();
    await expect(page.getByText(/insufficient/i).first()).toBeVisible();
    await expect(page.getByText(/Onchain evidence/i).first()).toBeVisible();
    await expect(page.getByText(/Durable record/i).first()).toBeVisible();

    await page.reload();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("blocked substitution journey (deterministic, no live chain writes)", () => {
  test("shows release paused with the specific reason, secured collateral, and open financing — never 'failed'", async ({ page }) => {
    await mockAuthenticatedSession(page);
    await mockOperationRead(page, "RELEASE_BLOCKED_REPLACEMENT_PRICE_STALE");

    await page.goto(`/institutional/facilities/${FACILITY_ID}/replace`);

    await expect(page.getByRole("heading", { name: "Release paused" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/replacement collateral valuation evidence was stale/i)).toBeVisible();
    await expect(page.getByText(/existing collateral remains secured/i)).toBeVisible();
    await expect(page.getByText("Financing remains open", { exact: true })).toBeVisible();
    await expect(page.getByText(/failed substitution/i)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Release paused" })).toBeVisible({ timeout: 20_000 });
  });
});

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

  test("a signed-in operator recovers the existing durable operation, not a second one", async ({ page, request, baseURL }) => {
    const cookie = await signInCookie(request, baseURL!);
    await applyCookie(page, baseURL!, cookie);

    await page.goto(`/institutional/facilities/${FACILITY_ID}/replace`);
    await expect(page.getByText(/existing durable operation recovered/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(PRESERVED_REQUEST_ID)).toBeVisible();
    // Only one operation may be active; the create form must not be offered alongside a recovered one.
    await expect(page.getByRole("button", { name: /create substitution request/i })).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(PRESERVED_REQUEST_ID)).toBeVisible({ timeout: 20_000 });
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

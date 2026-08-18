import { defineConfig, devices } from "@playwright/test";

/**
 * Browser acceptance.
 *
 * `make test-e2e` used to exit non-zero on purpose, on the grounds that a missing suite should not
 * be reported as a pass. This replaces the honest failure with an honest suite.
 *
 * The server is the production build, not `next dev`. The proof pages are statically generated from
 * artifacts on disk, and a dev server would happily render a page the build would have rejected —
 * which is the one class of failure these tests exist to catch.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["json", { outputFile: "artifacts/e2e/results.json" }]] : "list",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // A real phone viewport, not a narrowed desktop. Touch targets and overflow behave differently.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm --filter @usance/web start -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

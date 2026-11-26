import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm exec next start -p 3100",
    url: "http://localhost:3100",
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
    env: {
      KONNEXY_ALLOW_PGLITE_DEV: "true",
      KONNEXY_PG_DATA_DIR: "memory://",
      AUTH_SECRET:
        process.env.AUTH_SECRET ??
        "stage2-2-e2e-injected-auth-secret-fixture-key-32bytes",
      CREDENTIALS_ENCRYPTION_KEY:
        process.env.CREDENTIALS_ENCRYPTION_KEY ??
        "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      CREDENTIALS_ENCRYPTION_KEY_VERSION: "v1",
      OAUTH_STATE_SIGNING_SECRET:
        process.env.OAUTH_STATE_SIGNING_SECRET ??
        "stage2-2-e2e-injected-oauth-state-hmac-fixture-32bytes",
    },
  },
});

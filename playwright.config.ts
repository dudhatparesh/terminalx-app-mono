import { defineConfig, devices } from "@playwright/test";
import * as path from "path";

/**
 * Playwright config for TerminalX e2e tests.
 *
 * The test server runs with TERMINALX_AUTH_MODE=none (login bypassed) and
 * TERMINUS_ROOT pointed at the sandbox sample-repo so worktree / symlink
 * flows can be exercised against a real git repository.
 *
 * Port 3200 is used because 3100 is occupied by another server in this env.
 */

const SANDBOX_REPO = path.resolve(__dirname, ".test-sandbox/sample-repo");

const PORT = 3200;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PORT: String(PORT),
      TERMINALX_AUTH_MODE: "none",
      // Opt-in escape hatch so the no-auth test server is allowed to boot.
      // Production startup still forbids `none` unless this is explicitly set.
      TERMINALX_ALLOW_AUTH_NONE: "true",
      TERMINUS_ROOT: SANDBOX_REPO,
      // Master key for the GitHub token vault (a base64-encoded 32-byte key) so
      // the e2e server can encrypt PATs at rest without a real production secret.
      TERMINALX_GITHUB_TOKEN_MASTER_KEY: "5hA7+v5UNOOW0BeCMmltY7i1Rwh52Jdx7KKt8HcvtTY=",
      // Point the server-side GitHub REST client at the in-process test mock
      // (src/app/api/test-github-mock) so the connect flow's `GET /user` hop
      // resolves offline. The mock only responds while auth-none is enabled.
      GITHUB_API_BASE_URL: `${BASE_URL}/api/test-github-mock`,
    },
  },
});

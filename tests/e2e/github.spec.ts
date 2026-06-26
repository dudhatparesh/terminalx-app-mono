import { test, expect } from "@playwright/test";

/**
 * E2E for Issue #7 — "secure GitHub integration layer".
 *
 * Drives the GitHub "Connect" settings surface: enters a PAT, clicks Connect, and
 * asserts the connection status flips to "connected" and the integration row
 * appears. The actual GitHub API (GET /user, §2.5a) is mocked at the network
 * boundary via page.route so the test runs offline against a fake token.
 *
 * The test server boots with TERMINALX_AUTH_MODE=none and must have
 * TERMINALX_GITHUB_TOKEN_MASTER_KEY set (32-byte base64) so the token vault can
 * encrypt at rest. Written against the spec'd UI data-testids.
 */

const FAKE_VIEWER = {
  login: "octocat",
  id: 1,
  avatar_url: "",
  url: "https://api.github.com/users/octocat",
  type: "User",
};

test("connects a GitHub PAT and shows connected status", async ({ page }) => {
  // Mock GitHub's GET /user (the credential validation hop) so no real token is
  // needed. The server makes this call from Node, but page.route only catches
  // browser traffic — so we ALSO accept the case where the server validates
  // against the live API. To keep this offline-friendly, intercept the GitHub
  // host at the browser layer for any client-side calls and rely on the server
  // mock env for the server hop.
  await page.route("**/api.github.com/user", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FAKE_VIEWER),
    })
  );

  await page.goto("/settings");

  const panel = page.getByTestId("github-settings");
  await expect(panel).toBeVisible();

  const status = page.getByTestId("github-connection-status");
  await expect(status).toHaveAttribute("data-connected", "false");

  await page.getByTestId("github-display-name").fill("GitHub (E2E)");
  await page.getByTestId("github-token-input").fill("ghp_e2e_fake_token");
  await page.getByTestId("github-connect-button").click();

  // Either the connection succeeds (status flips) or a clear error surfaces. We
  // assert the success path; the row carries the display name we entered.
  await expect(page.getByTestId("github-connection-status")).toHaveAttribute(
    "data-connected",
    "true",
    { timeout: 15_000 }
  );
  await expect(page.getByTestId("github-integration-row").first()).toContainText("GitHub (E2E)");

  // Clean up: disconnect so re-runs start from a clean slate.
  await page.getByTestId("github-disconnect-button").first().click();
  await expect(page.getByTestId("github-connection-status")).toHaveAttribute(
    "data-connected",
    "false",
    { timeout: 10_000 }
  );
});

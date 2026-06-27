import { test, expect } from "@playwright/test";

/**
 * E2E for Issue #11 — Models & harness settings page.
 *
 * Exercises the Models section inside the settings surface: Default model +
 * effort, an INDEPENDENT Review model + effort, Codex personality, the plan /
 * fast / Chrome toggles, User/Repo scope, and persistence via GET/PUT
 * /api/settings (options from the harness/provider registry). Every control has
 * a stable data-testid. Run later in integration (no server in the worktree).
 */

test.describe("Models settings page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
    // Settings is a dedicated full-page view with a left nav; the Models section
    // lives behind its nav item now (Conductor parity).
    await expect(page.getByTestId("settings-shell")).toBeVisible();
    await page.getByTestId("settings-nav-models").click();
    await expect(page.getByTestId("settings-models-section")).toBeVisible();
    await expect(page.getByTestId("models-settings-page")).toBeVisible();
  });

  test("renders the spec sections in order with sublabels", async ({ page }) => {
    const page0 = page.getByTestId("models-settings-page");
    await expect(page0).toContainText("Default model");
    await expect(page0).toContainText("Model for new chats");
    await expect(page0).toContainText("Review model");
    await expect(page0).toContainText("Model for code reviews");
    await expect(page0).toContainText("Codex personality for new chats");
    await expect(page0).toContainText("Default to plan mode");
    await expect(page0).toContainText("Default to fast mode");
    await expect(page0).toContainText("Use Claude Code with Chrome");
  });

  test("Default model and Review model each expose model + effort selects", async ({ page }) => {
    await expect(page.getByTestId("models-default-model")).toBeVisible();
    await expect(page.getByTestId("models-default-effort")).toBeVisible();
    await expect(page.getByTestId("models-review-model")).toBeVisible();
    await expect(page.getByTestId("models-review-effort")).toBeVisible();
  });

  test("model dropdowns are populated from the registry, grouped by harness", async ({ page }) => {
    const select = page.getByTestId("models-default-model");
    // Registry-backed options include both claude and codex models.
    await expect(select.locator("option")).not.toHaveCount(0);
    await expect(select).toContainText("Opus 4.8 1M");
    await expect(select).toContainText("GPT-5 Codex");
  });

  test("Review model is independently selectable from the Default model", async ({ page }) => {
    // Change Default to a Claude model and Review to a Codex model; they persist
    // separately (review never tracks the default).
    await page.getByTestId("models-default-model").selectOption("claude:opus-4-8-1m");
    await page.getByTestId("models-review-model").selectOption("codex:gpt-5-codex");
    await page.getByTestId("models-save").click();
    await expect(page.getByTestId("models-save-status")).toContainText(/saved/i);

    await page.reload();
    await page.getByTestId("settings-nav-models").click();
    await expect(page.getByTestId("models-default-model")).toHaveValue("claude:opus-4-8-1m");
    await expect(page.getByTestId("models-review-model")).toHaveValue("codex:gpt-5-codex");
  });

  test("Codex personality dropdown defaults to Pragmatic (default)", async ({ page }) => {
    const select = page.getByTestId("models-codex-personality");
    await expect(select).toBeVisible();
    await expect(select).toContainText("Pragmatic (default)");
    await expect(select).toHaveValue("pragmatic");
  });

  test("plan / fast / Chrome toggles render with the Chrome links", async ({ page }) => {
    await expect(page.getByTestId("models-plan-mode")).toBeVisible();
    await expect(page.getByTestId("models-fast-mode")).toBeVisible();
    await expect(page.getByTestId("models-chrome")).toBeVisible();
    await expect(page.getByTestId("models-chrome-extension-link")).toBeVisible();
    await expect(page.getByTestId("models-chrome-docs-link")).toBeVisible();
  });

  test("toggling plan mode persists across reload", async ({ page }) => {
    // The plan-mode control is now an iOS-style switch (role="switch"); click to
    // toggle it on and assert via aria-checked.
    const toggle = page.getByTestId("models-plan-mode");
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.getByTestId("models-save").click();
    await expect(page.getByTestId("models-save-status")).toContainText(/saved/i);

    await page.reload();
    await page.getByTestId("settings-nav-models").click();
    await expect(page.getByTestId("models-plan-mode")).toBeChecked();
  });

  test("User and Repo scope tabs are present; Repo is disabled without repo context", async ({
    page,
  }) => {
    await expect(page.getByTestId("settings-scope-tabs")).toBeVisible();
    await expect(page.getByTestId("settings-scope-user")).toBeVisible();
    // No active session selected on the settings page → Repo tab disabled.
    await expect(page.getByTestId("settings-scope-repo")).toBeDisabled();
  });
});

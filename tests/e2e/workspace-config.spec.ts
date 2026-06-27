import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * E2E for Issue #5 — "Workspace config (setup/run scripts + injected port)".
 *
 * Seeds a committed `.terminalx/settings.toml` in the sample repo declaring a
 * named run script and a setup script, then drives the real UI to prove the
 * configured run script SURFACES:
 *
 *   1. GET /api/workspace/config returns the resolved config (no secrets).
 *   2. The Settings → Workspace section renders the repo config with the run
 *      script and an "Edit settings.toml" affordance.
 *   3. The new-session dialog shows the workspace summary (copy files + port).
 *   4. A worktree-backed session created against the repo surfaces the run
 *      script in the command palette as `run · dev`.
 *
 * Written against the SPEC'd UI; run later in integration.
 */

const SANDBOX_REPO = path.resolve(__dirname, "..", "..", ".test-sandbox", "sample-repo");
const SETTINGS_DIR = path.join(SANDBOX_REPO, ".terminalx");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.toml");
const WORKTREES_ROOT = path.join(SANDBOX_REPO, ".terminalx-worktrees");

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

const SETTINGS_TOML = [
  "version = 1",
  "",
  "[workspace]",
  'defaultKind = "bash"',
  'copyFiles = [".env", ".env.local"]',
  "",
  "[env]",
  'NODE_ENV = "development"',
  "",
  "[setup]",
  'command = "echo setup-ran"',
  "",
  "[scripts.dev]",
  'description = "Start the dev server"',
  'command = "echo dev --port ${TERMINALX_PORT}"',
  "",
  "[scripts.test]",
  'command = "echo running tests"',
  "",
].join("\n");

test.beforeAll(() => {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, SETTINGS_TOML, "utf-8");
  // A `.env` to prove the copy-on-create headline parity feature.
  fs.writeFileSync(path.join(SANDBOX_REPO, ".env"), "SECRET=copied-on-create\n");
});

test("GET /api/workspace/config returns the resolved repo config (no secrets)", async ({
  request,
}) => {
  const res = await request.get(
    `/api/workspace/config?repoRoot=${encodeURIComponent(SANDBOX_REPO)}`
  );
  expect(res.ok()).toBeTruthy();
  const cfg = await res.json();
  expect(cfg.hasRepoConfig).toBe(true);
  expect(cfg.scripts.map((s: { name: string }) => s.name).sort()).toEqual(["dev", "test"]);
  expect(cfg.setup.command).toBe("echo setup-ran");
  // env values are returned, but never the contents of copied .env files.
  expect(cfg.env.NODE_ENV).toBe("development");
  expect(JSON.stringify(cfg)).not.toContain("copied-on-create");
});

test("Settings → Workspace section renders the repo config + Edit affordance", async ({ page }) => {
  await page.goto("/settings");

  // Settings is a dedicated full-page view with a left nav; the workspace config
  // lives behind the Environment nav item now (Conductor parity).
  await expect(page.getByTestId("settings-shell")).toBeVisible();
  await page.getByTestId("settings-nav-environment").click();

  const section = page.getByTestId("workspace-settings-section");
  await expect(section).toBeVisible();

  // User / Repo scope tabs (Conductor parity).
  await expect(page.getByTestId("workspace-scope-tab-user")).toBeVisible();
  await expect(page.getByTestId("workspace-scope-tab-repo")).toBeVisible();
});

test("a configured run script surfaces in the command palette", async ({ page, request }) => {
  const sessionName = `e2e-wsconfig-${uniqueSuffix()}`;
  const branch = `feature/e2e-wsconfig-${uniqueSuffix()}`;

  await page.goto("/dashboard");

  // Open the new-session dialog.
  await page
    .getByRole("button", { name: /new session/i })
    .first()
    .click();

  const nameInput = page.getByPlaceholder("my-project");
  await expect(nameInput).toBeVisible();
  await nameInput.fill(sessionName);

  // The start dir is the sample-repo (a git repo) → workspace summary appears.
  await expect(page.getByTestId("workspace-config-summary")).toBeVisible();

  // Create a worktree-backed session so the run scripts resolve for it.
  const worktreeToggle = page.getByLabel(/create Git worktree/i);
  await expect(worktreeToggle).toBeVisible();
  await worktreeToggle.check();
  const branchInput = page.getByPlaceholder(/feature\//i);
  await branchInput.fill(branch);

  await page.getByRole("button", { name: /create/i }).click();

  // Wait for the session to exist and grab its worktree path + injected port.
  let port: number | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get("/api/sessions");
        if (!res.ok()) return undefined;
        const data = await res.json();
        const sessions: Array<{ name: string; port?: number }> = data.sessions ?? data;
        const match = sessions.find((s) => s.name === sessionName);
        port = match?.port;
        return match?.name;
      },
      { timeout: 20_000 }
    )
    .toBe(sessionName);

  // A per-workspace TERMINALX_PORT was injected and persisted.
  expect(typeof port).toBe("number");

  // Open the command palette on the workspace route and find `run · dev`.
  await page.goto(`/workspace/${encodeURIComponent(sessionName)}`);
  // Wait until the AppShell (which owns the ⌘K listener) has mounted before
  // dispatching the shortcut — the visible "commands" affordance is a stable
  // readiness signal. Then press ⌘K, retrying so a single keystroke racing the
  // terminal's focus grab can't be silently dropped.
  const paletteHotkey = process.platform === "darwin" ? "Meta+K" : "Control+K";
  const palette = page.getByPlaceholder(/search commands/i);
  await expect(page.getByText("commands", { exact: false }).first()).toBeVisible();
  await expect(async () => {
    // ⌘K toggles, so only press when the palette is currently closed — that way a
    // retry can't close a palette that just opened.
    if (!(await palette.isVisible())) {
      await page.keyboard.press(paletteHotkey);
    }
    await expect(palette).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await palette.fill("run");
  await expect(page.getByText(/run · dev/)).toBeVisible();
  await expect(page.getByText(/workspace · run setup/)).toBeVisible();

  // Cleanup.
  await page.keyboard.press("Escape");
  await request.delete(`/api/sessions/${encodeURIComponent(sessionName)}`).catch(() => undefined);
  await request.delete("/api/sessions", { data: { name: sessionName } }).catch(() => undefined);
});

test.afterAll(() => {
  try {
    fs.rmSync(SETTINGS_DIR, { recursive: true, force: true });
    fs.rmSync(path.join(SANDBOX_REPO, ".env"), { force: true });
    if (fs.existsSync(WORKTREES_ROOT)) {
      fs.rmSync(WORKTREES_ROOT, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
});

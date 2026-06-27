import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * E2E for Issue #10 — "symlink shared paths into git worktrees for large repos".
 *
 * Drives the real new-session dialog: enables "create Git worktree" and the
 * "symlink shared paths" option, enters a path to share (node_modules), and
 * creates the session. Then asserts (via the filesystem) that the configured
 * path was symlinked into the new worktree and resolves to the shared source —
 * i.e. the heavy dir was NOT re-installed.
 *
 * Written against the SPEC'd UI; the UI does not exist yet, so this is RED.
 */

const SANDBOX_REPO = path.resolve(__dirname, "..", "..", ".test-sandbox", "sample-repo");
const SHARED_DIR = path.join(SANDBOX_REPO, "node_modules");
const SHARED_MARKER = path.join(SHARED_DIR, "MARKER");
const WORKTREES_ROOT = path.join(SANDBOX_REPO, ".terminalx-worktrees");

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

test.beforeAll(() => {
  // Seed a heavy shared dir (stand-in for node_modules) in the repo root that
  // the worktree should symlink to rather than re-install.
  fs.mkdirSync(path.join(SHARED_DIR, "leftpad"), { recursive: true });
  fs.writeFileSync(path.join(SHARED_DIR, "leftpad", "index.js"), "module.exports = () => 'pad';\n");
  fs.writeFileSync(SHARED_MARKER, "shared-install\n");
});

test("symlinks a configured shared path into a new git worktree", async ({ page, request }) => {
  const sessionName = `e2e-symlink-${uniqueSuffix()}`;
  const branch = `feature/e2e-symlink-${uniqueSuffix()}`;

  await page.goto("/dashboard");

  // Open the new-session dialog.
  await page
    .getByRole("button", { name: /new session/i })
    .first()
    .click();

  // Name the session.
  const nameInput = page.getByPlaceholder("my-project");
  await expect(nameInput).toBeVisible();
  await nameInput.fill(sessionName);

  // The start directory defaults to TERMINUS_ROOT, which is the sample-repo
  // itself, so the git-worktree affordance should be present.
  const worktreeToggle = page.getByLabel(/create Git worktree/i);
  await expect(worktreeToggle).toBeVisible();
  await worktreeToggle.check();

  // Enable the symlink-shared-paths option (spec'd UI).
  const symlinkToggle = page.getByTestId("worktree-symlink-toggle");
  await expect(symlinkToggle).toBeVisible();
  await symlinkToggle.check();

  // Enter the path(s) to symlink into the worktree.
  const symlinkPathsInput = page.getByTestId("worktree-symlink-paths");
  await expect(symlinkPathsInput).toBeVisible();
  await symlinkPathsInput.fill("node_modules");

  // Provide an explicit branch name (override the auto-filled one).
  const branchInput = page.getByPlaceholder(/feature\//i);
  await branchInput.fill(branch);

  // Create the session.
  await page.getByRole("button", { name: /create/i }).click();

  // After creation the app navigates to the workspace; confirm the session
  // exists via the API and grab its worktree path.
  let worktreePath = "";
  await expect
    .poll(
      async () => {
        const res = await request.get("/api/sessions");
        if (!res.ok()) return "";
        const data = await res.json();
        const sessions: Array<{ name: string; worktree?: { path?: string } }> =
          data.sessions ?? data;
        const match = sessions.find((s) => s.name === sessionName);
        worktreePath = match?.worktree?.path ?? "";
        return worktreePath;
      },
      { timeout: 20_000 }
    )
    .not.toBe("");

  // Filesystem assertions: the configured path is symlinked into the worktree
  // and resolves to the shared source (so node_modules was not re-installed).
  const linked = path.join(worktreePath, "node_modules");
  expect(fs.existsSync(linked)).toBe(true);
  expect(fs.realpathSync(linked)).toBe(fs.realpathSync(SHARED_DIR));
  expect(fs.readFileSync(path.join(linked, "MARKER"), "utf-8")).toBe("shared-install\n");

  // Cleanup: deleting the session removes the worktree (and its link) but must
  // leave the shared source intact.
  await request.delete("/api/sessions", { data: { name: sessionName } }).catch(() => undefined);
  await request.delete(`/api/sessions/${encodeURIComponent(sessionName)}`).catch(() => undefined);

  expect(fs.existsSync(SHARED_MARKER)).toBe(true);
});

test.afterAll(() => {
  // Best-effort cleanup of any worktrees this spec produced.
  try {
    if (fs.existsSync(WORKTREES_ROOT)) {
      fs.rmSync(WORKTREES_ROOT, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
});

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

/**
 * E2E for Issue #9 — workspace-delete CONFIRMATION (safety gap).
 *
 * Deleting a WORKSPACE is irreversible: it drops the project AND removes all of
 * its worktrees. The spec requires the user to "Confirm in the UI" before the
 * destructive DELETE /api/workspaces/[id] fires.
 *
 * This spec (against the sandbox sample-repo mounted as TERMINUS_ROOT by the
 * Playwright webServer):
 *  1. registers the repo as a workspace and drives the sidebar "⋮ → Delete
 *     workspace" menu item;
 *  2. asserts a confirmation dialog appears naming the workspace and warning
 *     that all worktrees are removed, with Cancel / Delete;
 *  3. asserts Cancel does NOT delete the workspace (it survives in the API);
 *  4. asserts only the explicit Delete confirm fires the destructive request and
 *     the workspace disappears.
 */

const SANDBOX_REPO = path.resolve(__dirname, "..", "..", ".test-sandbox", "sample-repo");

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitSafe(repo: string, args: string[]): void {
  try {
    git(repo, args);
  } catch {
    /* idempotent seeding */
  }
}

async function workspaceExists(
  request: import("@playwright/test").APIRequestContext,
  repoRoot: string
): Promise<boolean> {
  const res = await request.get("/api/workspaces");
  if (!res.ok()) return false;
  const { workspaces } = await res.json();
  return workspaces.some((w: { repoRoot: string }) => w.repoRoot === repoRoot);
}

test.beforeAll(() => {
  fs.mkdirSync(path.join(SANDBOX_REPO, "src"), { recursive: true });
  if (!fs.existsSync(path.join(SANDBOX_REPO, ".git"))) {
    git(SANDBOX_REPO, ["init", "-b", "main"]);
    git(SANDBOX_REPO, ["config", "user.email", "terminalx@example.test"]);
    git(SANDBOX_REPO, ["config", "user.name", "TerminalX Test"]);
  }
  gitSafe(SANDBOX_REPO, ["checkout", "main"]);
  fs.writeFileSync(path.join(SANDBOX_REPO, "src", "index.ts"), "export const value = 1;\n");
  git(SANDBOX_REPO, ["add", "src/index.ts"]);
  gitSafe(SANDBOX_REPO, ["commit", "-m", "base"]);
});

test("Delete workspace requires confirmation; Cancel does NOT delete", async ({
  page,
  request,
}) => {
  await request.post("/api/workspaces", { data: { directory: SANDBOX_REPO } });
  const realRoot = fs.realpathSync(SANDBOX_REPO);
  expect(await workspaceExists(request, realRoot)).toBe(true);

  await page.goto("/dashboard");
  const sidebar = page.getByTestId("workspace-sidebar");
  await expect(sidebar).toBeVisible();

  const group = page.locator('[data-testid="workspace-group"]', {
    has: page.locator(`[data-testid="workspace-name"][title="${realRoot}"]`),
  });
  await expect(group).toBeVisible();

  // Open the workspace "⋮" menu and click "Delete workspace".
  await group.getByTestId("workspace-menu-trigger").click();
  await group.getByTestId("workspace-menu-delete").click();

  // A confirmation dialog appears — it does NOT delete yet.
  const confirm = page.getByTestId("workspace-delete-confirm");
  await expect(confirm).toBeVisible();
  // Names the workspace and warns all worktrees are removed.
  await expect(confirm).toContainText(/worktree/i);

  // Cancel keeps the workspace.
  await confirm.getByTestId("workspace-delete-confirm-cancel").click();
  await expect(confirm).toHaveCount(0);
  // Give any (erroneous) request a moment, then assert it survived.
  await expect.poll(() => workspaceExists(request, realRoot)).toBe(true);
});

test("Delete workspace deletes only after the explicit confirm", async ({ page, request }) => {
  await request.post("/api/workspaces", { data: { directory: SANDBOX_REPO } });
  const realRoot = fs.realpathSync(SANDBOX_REPO);
  expect(await workspaceExists(request, realRoot)).toBe(true);

  // No DELETE must fire until we click the confirm Delete button.
  let deleteCount = 0;
  page.on("request", (req) => {
    if (req.method() === "DELETE" && /\/api\/workspaces\//.test(req.url())) deleteCount += 1;
  });

  await page.goto("/dashboard");
  const sidebar = page.getByTestId("workspace-sidebar");
  await expect(sidebar).toBeVisible();

  const group = page.locator('[data-testid="workspace-group"]', {
    has: page.locator(`[data-testid="workspace-name"][title="${realRoot}"]`),
  });
  await expect(group).toBeVisible();

  await group.getByTestId("workspace-menu-trigger").click();
  await group.getByTestId("workspace-menu-delete").click();

  const confirm = page.getByTestId("workspace-delete-confirm");
  await expect(confirm).toBeVisible();
  // Opening the confirm must NOT have fired a destructive request.
  expect(deleteCount).toBe(0);

  await confirm.getByTestId("workspace-delete-confirm-accept").click();

  // Now (and only now) the workspace is deleted.
  await expect.poll(() => workspaceExists(request, realRoot)).toBe(false);
  expect(deleteCount).toBeGreaterThanOrEqual(1);
});

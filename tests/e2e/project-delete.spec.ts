import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

/**
 * E2E for Issue #9 — project-delete CONFIRMATION (safety gap).
 *
 * Deleting a PROJECT is irreversible: it drops the container AND removes all of
 * its workspaces. The spec requires the user to "Confirm in the UI" before the
 * destructive DELETE /api/projects/[id] fires.
 *
 * This spec (against the sandbox sample-repo mounted as TERMINUS_ROOT by the
 * Playwright webServer):
 *  1. registers the repo as a project and drives the sidebar "⋮ → Delete
 *     project" menu item;
 *  2. asserts a confirmation dialog appears naming the project and warning
 *     that all workspaces are removed, with Cancel / Delete;
 *  3. asserts Cancel does NOT delete the project (it survives in the API);
 *  4. asserts only the explicit Delete confirm fires the destructive request and
 *     the project disappears.
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

async function projectExists(
  request: import("@playwright/test").APIRequestContext,
  repoRoot: string
): Promise<boolean> {
  const res = await request.get("/api/projects");
  if (!res.ok()) return false;
  const { projects } = await res.json();
  return projects.some((p: { repoRoot: string }) => p.repoRoot === repoRoot);
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

test("Delete project requires confirmation; Cancel does NOT delete", async ({ page, request }) => {
  await request.post("/api/projects", { data: { directory: SANDBOX_REPO } });
  const realRoot = fs.realpathSync(SANDBOX_REPO);
  expect(await projectExists(request, realRoot)).toBe(true);

  await page.goto("/dashboard");
  const sidebar = page.getByTestId("project-sidebar");
  await expect(sidebar).toBeVisible();

  const group = page.locator('[data-testid="project-group"]', {
    has: page.locator(`[data-testid="project-name"][title="${realRoot}"]`),
  });
  await expect(group).toBeVisible();

  // Open the project "⋮" menu and click "Delete project".
  await group.getByTestId("project-menu-trigger").click();
  await group.getByTestId("project-menu-delete").click();

  // A confirmation dialog appears — it does NOT delete yet.
  const confirm = page.getByTestId("project-delete-confirm");
  await expect(confirm).toBeVisible();
  // Names the project and warns all workspaces are removed.
  await expect(confirm).toContainText(/workspace/i);

  // Cancel keeps the project.
  await confirm.getByTestId("project-delete-confirm-cancel").click();
  await expect(confirm).toHaveCount(0);
  // Give any (erroneous) request a moment, then assert it survived.
  await expect.poll(() => projectExists(request, realRoot)).toBe(true);
});

test("Delete project deletes only after the explicit confirm", async ({ page, request }) => {
  await request.post("/api/projects", { data: { directory: SANDBOX_REPO } });
  const realRoot = fs.realpathSync(SANDBOX_REPO);
  expect(await projectExists(request, realRoot)).toBe(true);

  // No DELETE must fire until we click the confirm Delete button.
  let deleteCount = 0;
  page.on("request", (req) => {
    if (req.method() === "DELETE" && /\/api\/projects\//.test(req.url())) deleteCount += 1;
  });

  await page.goto("/dashboard");
  const sidebar = page.getByTestId("project-sidebar");
  await expect(sidebar).toBeVisible();

  const group = page.locator('[data-testid="project-group"]', {
    has: page.locator(`[data-testid="project-name"][title="${realRoot}"]`),
  });
  await expect(group).toBeVisible();

  await group.getByTestId("project-menu-trigger").click();
  await group.getByTestId("project-menu-delete").click();

  const confirm = page.getByTestId("project-delete-confirm");
  await expect(confirm).toBeVisible();
  // Opening the confirm must NOT have fired a destructive request.
  expect(deleteCount).toBe(0);

  await confirm.getByTestId("project-delete-confirm-accept").click();

  // Now (and only now) the project is deleted.
  await expect.poll(() => projectExists(request, realRoot)).toBe(false);
  expect(deleteCount).toBeGreaterThanOrEqual(1);
});

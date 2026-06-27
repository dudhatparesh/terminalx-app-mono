import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

/**
 * E2E for Issue #12 — Workspaces & Worktrees (CORRECTED model).
 *
 * A Workspace is a PROJECT/REPO container; worktrees (one task each = a git
 * worktree + branch + session) are nested UNDER the workspace header.
 *
 * This spec, against the sandbox sample-repo (mounted as TERMINUS_ROOT by the
 * Playwright webServer):
 *  1. registers the repo as a workspace (POST /api/workspaces) and asserts
 *     GET /api/workspaces groups it (corrected hierarchy, no worktrees yet);
 *  2. creates a worktree via the new-session dialog, commits a change inside it,
 *     and asserts GET /api/workspaces derives that worktree WITH a +N diff stat
 *     and an "in-progress" status (no GitHub PR bound in the sandbox);
 *  3. drives the AppShell left rail: workspace header (name + "+"), a nested
 *     worktree row (status icon + name + diff stat), and the "⋮" menu
 *     (Collapse, Archive) — all via stable data-testids.
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

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

test.beforeAll(() => {
  // Ensure the sample-repo is a git repo with a base commit on main.
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

test("POST then GET /api/workspaces groups the repo as a workspace (corrected model)", async ({
  request,
}) => {
  const reg = await request.post("/api/workspaces", { data: { directory: SANDBOX_REPO } });
  expect(reg.ok()).toBe(true);
  const { workspace } = await reg.json();
  expect(workspace.repoRoot).toBe(fs.realpathSync(SANDBOX_REPO));
  expect(workspace.id).toBeTruthy();

  const list = await request.get("/api/workspaces");
  expect(list.ok()).toBe(true);
  const { workspaces } = await list.json();
  const mine = workspaces.find(
    (w: { repoRoot: string }) => w.repoRoot === fs.realpathSync(SANDBOX_REPO)
  );
  expect(mine).toBeTruthy();
  expect(Array.isArray(mine.worktrees)).toBe(true);
});

test("a worktree is derived under its workspace with a diff stat + status", async ({
  page,
  request,
}) => {
  // Register the workspace (idempotent).
  await request.post("/api/workspaces", { data: { directory: SANDBOX_REPO } });

  const sessionName = `e2e-ws-${uniqueSuffix()}`;
  const branch = `feature/e2e-ws-${uniqueSuffix()}`;

  // Create a worktree via the new-session dialog (this is how worktrees are made).
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: /new session/i })
    .first()
    .click();
  const nameInput = page.getByPlaceholder("my-project");
  await expect(nameInput).toBeVisible();
  await nameInput.fill(sessionName);
  const worktreeToggle = page.getByLabel(/create Git worktree/i);
  await expect(worktreeToggle).toBeVisible();
  await worktreeToggle.check();
  await page.getByPlaceholder(/feature\//i).fill(branch);
  await page.getByRole("button", { name: /create/i }).click();

  // Wait for the worktree to exist, then commit a change so its numstat is +3.
  let worktreePath = "";
  await expect
    .poll(
      async () => {
        const res = await request.get("/api/sessions");
        if (!res.ok()) return "";
        const data = await res.json();
        const sessions: Array<{ name: string; worktree?: { path?: string } }> =
          data.sessions ?? data;
        worktreePath = sessions.find((s) => s.name === sessionName)?.worktree?.path ?? "";
        return worktreePath;
      },
      { timeout: 20_000 }
    )
    .not.toBe("");

  fs.writeFileSync(path.join(worktreePath, "added.txt"), "one\ntwo\nthree\n");
  git(worktreePath, ["add", "added.txt"]);
  git(worktreePath, [
    "-c",
    "user.email=e2e@x.test",
    "-c",
    "user.name=e2e",
    "commit",
    "-m",
    "e2e worktree change",
  ]);

  // The workspaces API now derives this session as a worktree under the repo,
  // with a +3 diff stat and (no PR bound) an in-progress status.
  await expect
    .poll(
      async () => {
        const res = await request.get("/api/workspaces");
        if (!res.ok()) return null;
        const { workspaces } = await res.json();
        const ws = workspaces.find(
          (w: { repoRoot: string }) => w.repoRoot === fs.realpathSync(SANDBOX_REPO)
        );
        return ws?.worktrees?.find(
          (wt: { sessionName: string }) => wt.sessionName === sessionName
        );
      },
      { timeout: 20_000 }
    )
    .toMatchObject({
      branch,
      status: "in-progress",
      diffStat: { additions: 3, deletions: 0 },
    });

  // ---- UI: the AppShell left rail groups the worktree under its workspace. ----
  await page.goto(`/workspace/${encodeURIComponent(sessionName)}`);

  const sidebar = page.getByTestId("workspace-sidebar");
  await expect(sidebar).toBeVisible();

  // Workspace header (name + add-worktree "+" + context menu).
  const group = page.locator('[data-testid="workspace-group"]', {
    has: page.locator(`[data-testid="worktree-row"][data-session="${sessionName}"]`),
  });
  await expect(group.getByTestId("workspace-name")).toBeVisible();
  await expect(group.getByTestId("workspace-add-worktree")).toBeVisible();

  // The nested worktree row: status icon + name + diff stat.
  const row = group.locator(`[data-testid="worktree-row"][data-session="${sessionName}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-status", "in-progress");
  await expect(row.getByTestId("wt-icon-in-progress")).toBeVisible();
  await expect(row.getByTestId("worktree-name")).toHaveText(branch);
  await expect(row.getByTestId("worktree-diffstat")).toContainText("+3");

  // The "⋮" worktree menu offers Collapse + Archive.
  await row.getByTestId("worktree-menu-trigger").click();
  const menu = row.getByTestId("worktree-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("worktree-menu-collapse")).toBeVisible();
  await expect(menu.getByTestId("worktree-menu-archive")).toBeVisible();

  // The workspace "+" navigates to the new-worktree dialog scoped to this repo.
  await page.keyboard.press("Escape");
  await group.getByTestId("workspace-add-worktree").click();
  await expect(page).toHaveURL(/newWorktree=/);
});

test("the workspace context menu offers Delete workspace", async ({ page, request }) => {
  await request.post("/api/workspaces", { data: { directory: SANDBOX_REPO } });
  await page.goto("/dashboard");

  const sidebar = page.getByTestId("workspace-sidebar");
  await expect(sidebar).toBeVisible();

  const group = page.getByTestId("workspace-group").first();
  await group.getByTestId("workspace-menu-trigger").click();
  const menu = group.getByTestId("workspace-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("workspace-menu-delete")).toHaveText(/delete workspace/i);
});

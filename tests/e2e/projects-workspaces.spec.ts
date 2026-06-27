import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

/**
 * E2E for Issue #12 — Projects & Workspaces (CORRECTED model).
 *
 * A Project is a REPO container; workspaces (one task each = a git worktree +
 * branch + session) are nested UNDER the project header.
 *
 * This spec, against the sandbox sample-repo (mounted as TERMINUS_ROOT by the
 * Playwright webServer):
 *  1. registers the repo as a project (POST /api/projects) and asserts
 *     GET /api/projects groups it (corrected hierarchy, no workspaces yet);
 *  2. creates a workspace via the new-session dialog, commits a change inside it,
 *     and asserts GET /api/projects derives that workspace WITH a +N diff stat
 *     and an "in-progress" status (no GitHub PR bound in the sandbox);
 *  3. drives the AppShell left rail: project header (name + "+"), a nested
 *     workspace row (status icon + name + diff stat), and the "⋮" menu
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

test("POST then GET /api/projects groups the repo as a project (corrected model)", async ({
  request,
}) => {
  const reg = await request.post("/api/projects", { data: { directory: SANDBOX_REPO } });
  expect(reg.ok()).toBe(true);
  const { project } = await reg.json();
  expect(project.repoRoot).toBe(fs.realpathSync(SANDBOX_REPO));
  expect(project.id).toBeTruthy();

  const list = await request.get("/api/projects");
  expect(list.ok()).toBe(true);
  const { projects } = await list.json();
  const mine = projects.find(
    (p: { repoRoot: string }) => p.repoRoot === fs.realpathSync(SANDBOX_REPO)
  );
  expect(mine).toBeTruthy();
  expect(Array.isArray(mine.workspaces)).toBe(true);
});

test("a workspace is derived under its project with a diff stat + status", async ({
  page,
  request,
}) => {
  // Register the project (idempotent).
  await request.post("/api/projects", { data: { directory: SANDBOX_REPO } });

  const sessionName = `e2e-ws-${uniqueSuffix()}`;
  const branch = `feature/e2e-ws-${uniqueSuffix()}`;

  // Create a workspace via the new-session dialog (this is how workspaces are made).
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
    "e2e workspace change",
  ]);

  // The projects API now derives this session as a workspace under the repo,
  // with a +3 diff stat and (no PR bound) an in-progress status.
  await expect
    .poll(
      async () => {
        const res = await request.get("/api/projects");
        if (!res.ok()) return null;
        const { projects } = await res.json();
        const proj = projects.find(
          (p: { repoRoot: string }) => p.repoRoot === fs.realpathSync(SANDBOX_REPO)
        );
        return proj?.workspaces?.find(
          (ws: { sessionName: string }) => ws.sessionName === sessionName
        );
      },
      { timeout: 20_000 }
    )
    .toMatchObject({
      branch,
      status: "in-progress",
      diffStat: { additions: 3, deletions: 0 },
    });

  // ---- UI: the AppShell left rail groups the workspace under its project. ----
  await page.goto(`/workspace/${encodeURIComponent(sessionName)}`);

  const sidebar = page.getByTestId("project-sidebar");
  await expect(sidebar).toBeVisible();

  // Project header (name + add-workspace "+" + context menu).
  const group = page.locator('[data-testid="project-group"]', {
    has: page.locator(`[data-testid="workspace-row"][data-session="${sessionName}"]`),
  });
  await expect(group.getByTestId("project-name")).toBeVisible();
  await expect(group.getByTestId("project-add-workspace")).toBeVisible();

  // The nested workspace row: status icon + name + diff stat.
  const row = group.locator(`[data-testid="workspace-row"][data-session="${sessionName}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-status", "in-progress");
  await expect(row.getByTestId("wt-icon-in-progress")).toBeVisible();
  await expect(row.getByTestId("workspace-name")).toHaveText(branch);
  await expect(row.getByTestId("workspace-diffstat")).toContainText("+3");

  // The "⋮" workspace menu offers Collapse + Archive.
  await row.getByTestId("workspace-menu-trigger").click();
  const menu = row.getByTestId("workspace-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("workspace-menu-collapse")).toBeVisible();
  await expect(menu.getByTestId("workspace-menu-archive")).toBeVisible();

  // The project "+" navigates to the new-workspace dialog scoped to this repo.
  await page.keyboard.press("Escape");
  await group.getByTestId("project-add-workspace").click();
  await expect(page).toHaveURL(/newWorkspace=/);
});

test("the project context menu offers Delete project", async ({ page, request }) => {
  await request.post("/api/projects", { data: { directory: SANDBOX_REPO } });
  await page.goto("/dashboard");

  const sidebar = page.getByTestId("project-sidebar");
  await expect(sidebar).toBeVisible();

  const group = page.getByTestId("project-group").first();
  await group.getByTestId("project-menu-trigger").click();
  const menu = group.getByTestId("project-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("project-menu-delete")).toHaveText(/delete project/i);
});

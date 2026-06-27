import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

/**
 * E2E for Issue #9 — Archive & Cleanup (CORRECTED model).
 *
 * Archive operates on a WORKSPACE. Against the sandbox sample-repo (mounted as
 * TERMINUS_ROOT by the Playwright webServer):
 *  1. register the repo as a project and create a worktree-backed session via
 *     the new-session dialog;
 *  2. archive it (POST /api/sessions/[name]/archive): the on-disk git worktree is
 *     REMOVED, the branch is PRESERVED, and the row drops from the active sidebar
 *     list into the "Archived" section;
 *  3. restore it (POST /api/sessions/[name]/restore): the git worktree is
 *     RECREATED from the preserved branch and the row returns to active.
 *
 * Asserted via the API + the UI (stable data-testids).
 */

const SANDBOX_REPO = path.resolve(__dirname, "..", "..", ".test-sandbox", "sample-repo");
const WORKTREES_ROOT = path.join(SANDBOX_REPO, ".terminalx-worktrees");

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

function branchExists(repo: string, branch: string): boolean {
  try {
    git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
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

async function createWorktreeSession(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  sessionName: string,
  branch: string
): Promise<string> {
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
  return worktreePath;
}

test("archive removes the worktree (branch preserved) then restore recreates it — API", async ({
  page,
  request,
}) => {
  await request.post("/api/projects", { data: { directory: SANDBOX_REPO } });

  const sessionName = `e2e-arch-${uniqueSuffix()}`;
  const branch = `feature/e2e-arch-${uniqueSuffix()}`;
  const worktreePath = await createWorktreeSession(page, request, sessionName, branch);
  expect(fs.existsSync(worktreePath)).toBe(true);

  // ---- Archive ----
  const archiveRes = await request.post(
    `/api/sessions/${encodeURIComponent(sessionName)}/archive`,
    { data: {} }
  );
  expect(archiveRes.ok()).toBe(true);
  expect((await archiveRes.json()).archived).toBe(true);

  // Worktree removed on disk; branch preserved for restore.
  expect(fs.existsSync(worktreePath)).toBe(false);
  expect(branchExists(SANDBOX_REPO, branch)).toBe(true);

  // The workspace leaves the active list but is still derived as archived.
  await expect
    .poll(async () => {
      const res = await request.get("/api/projects");
      const { projects } = await res.json();
      const ws = projects
        .flatMap(
          (p: { workspaces: Array<{ sessionName: string; archived?: boolean }> }) => p.workspaces
        )
        .find((w: { sessionName: string }) => w.sessionName === sessionName);
      return ws?.archived ?? null;
    })
    .toBe(true);

  // ---- Restore ----
  const restoreRes = await request.post(
    `/api/sessions/${encodeURIComponent(sessionName)}/restore`,
    { data: {} }
  );
  expect(restoreRes.ok()).toBe(true);
  expect((await restoreRes.json()).archived).toBe(false);

  // Worktree recreated from the preserved branch.
  expect(fs.existsSync(worktreePath)).toBe(true);
  expect(git(worktreePath, ["branch", "--show-current"])).toBe(branch);

  await expect
    .poll(async () => {
      const res = await request.get("/api/projects");
      const { projects } = await res.json();
      const ws = projects
        .flatMap(
          (p: { workspaces: Array<{ sessionName: string; archived?: boolean }> }) => p.workspaces
        )
        .find((w: { sessionName: string }) => w.sessionName === sessionName);
      return ws?.archived ?? false;
    })
    .toBe(false);

  // Cleanup.
  await request.delete(`/api/sessions/${encodeURIComponent(sessionName)}`).catch(() => undefined);
});

test("Archived section in the sidebar lists archived workspaces with a Restore action — UI", async ({
  page,
  request,
}) => {
  await request.post("/api/projects", { data: { directory: SANDBOX_REPO } });

  const sessionName = `e2e-archui-${uniqueSuffix()}`;
  const branch = `feature/e2e-archui-${uniqueSuffix()}`;
  const worktreePath = await createWorktreeSession(page, request, sessionName, branch);

  // Drive the workspace "⋮ → Archive" from the sidebar.
  await page.goto(`/workspace/${encodeURIComponent(sessionName)}`);
  const sidebar = page.getByTestId("project-sidebar");
  await expect(sidebar).toBeVisible();

  const row = sidebar.locator(`[data-testid="workspace-row"][data-session="${sessionName}"]`);
  await expect(row).toBeVisible();
  await row.getByTestId("workspace-menu-trigger").click();
  await row.getByTestId("workspace-menu-archive").click();

  // The active row drops out…
  await expect(row).toHaveCount(0, { timeout: 15_000 });
  // …and the worktree's git dir is gone, branch kept.
  await expect.poll(() => fs.existsSync(worktreePath)).toBe(false);
  expect(branchExists(SANDBOX_REPO, branch)).toBe(true);

  // The Archived section appears with the archived workspace.
  const archivedSection = sidebar.getByTestId("archived-section");
  await expect(archivedSection).toBeVisible();
  await archivedSection.getByTestId("archived-toggle").click();
  const archivedRow = archivedSection.locator(
    `[data-testid="archived-workspace-row"][data-session="${sessionName}"]`
  );
  await expect(archivedRow).toBeVisible();

  // Restore from the Archived section recreates the worktree.
  await archivedRow.getByTestId("archived-workspace-restore").click();
  await expect.poll(() => fs.existsSync(worktreePath), { timeout: 15_000 }).toBe(true);

  // The row returns to the active list.
  await expect(
    sidebar.locator(`[data-testid="workspace-row"][data-session="${sessionName}"]`)
  ).toBeVisible({ timeout: 15_000 });

  await request.delete(`/api/sessions/${encodeURIComponent(sessionName)}`).catch(() => undefined);
});

test.afterAll(() => {
  try {
    if (fs.existsSync(WORKTREES_ROOT)) {
      fs.rmSync(WORKTREES_ROOT, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
});

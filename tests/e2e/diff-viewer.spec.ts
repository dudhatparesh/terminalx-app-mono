import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

/**
 * E2E for Issue #2 — Diff viewer (the "Changes" tab of the Review panel).
 *
 * Seeds a `feature/sample-change` branch in the sandbox sample-repo (which the
 * Playwright webServer mounts as TERMINUS_ROOT), then:
 *  1. asserts POST /api/diffs returns the structured file list + hunks for the
 *     branch vs its merge-base (the parser, end to end through a real server);
 *  2. drives the UI — creates a session rooted at the sample-repo, opens the
 *     Changes tab of the Review panel, and asserts the file rows (path, +N/-N)
 *     and a rendered hunk line.
 *
 * Written against the spec'd UI + API and stable data-testids.
 */

const SANDBOX_REPO = path.resolve(__dirname, "..", "..", ".test-sandbox", "sample-repo");
const FEATURE_BRANCH = "feature/sample-change";
const ADDED_FILE = ".terminalx/settings.toml";
const MODIFIED_FILE = "src/index.ts";

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
    /* ignore — idempotent seeding */
  }
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

test.beforeAll(() => {
  // Ensure the sample-repo exists and is a git repo with an initial commit.
  fs.mkdirSync(path.join(SANDBOX_REPO, "src"), { recursive: true });
  if (!fs.existsSync(path.join(SANDBOX_REPO, ".git"))) {
    git(SANDBOX_REPO, ["init", "-b", "main"]);
    git(SANDBOX_REPO, ["config", "user.email", "terminalx@example.test"]);
    git(SANDBOX_REPO, ["config", "user.name", "TerminalX Test"]);
  }
  // Base commit on main.
  gitSafe(SANDBOX_REPO, ["checkout", "main"]);
  fs.writeFileSync(path.join(SANDBOX_REPO, "src", "index.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(SANDBOX_REPO, "README.md"), "sample repo\n");
  git(SANDBOX_REPO, ["add", "src/index.ts", "README.md"]);
  gitSafe(SANDBOX_REPO, ["commit", "-m", "base"]);

  // Feature branch: add a settings file + modify index.ts.
  gitSafe(SANDBOX_REPO, ["branch", "-D", FEATURE_BRANCH]);
  git(SANDBOX_REPO, ["checkout", "-b", FEATURE_BRANCH]);
  fs.mkdirSync(path.join(SANDBOX_REPO, ".terminalx"), { recursive: true });
  fs.writeFileSync(
    path.join(SANDBOX_REPO, ADDED_FILE),
    '[diff]\nenabled = true\nmode = "unified"\n'
  );
  fs.writeFileSync(path.join(SANDBOX_REPO, "src", "index.ts"), "export const value = 2;\n");
  git(SANDBOX_REPO, ["add", "."]);
  gitSafe(SANDBOX_REPO, ["commit", "-m", "feature change"]);
  gitSafe(SANDBOX_REPO, ["checkout", "main"]);
});

test("POST /api/diffs returns the structured file list + hunks for the feature branch", async ({
  request,
}) => {
  const res = await request.post("/api/diffs", {
    data: { repoPath: SANDBOX_REPO, base: "main", head: FEATURE_BRANCH },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();

  const paths: string[] = body.files.map((f: { path: string }) => f.path).sort();
  expect(paths).toEqual([ADDED_FILE, MODIFIED_FILE]);

  const added = body.files.find((f: { path: string }) => f.path === ADDED_FILE);
  expect(added.status).toBe("added");
  expect(added.filename).toBe("settings.toml");
  expect(added.dir).toBe(".terminalx/");
  expect(added.additions).toBeGreaterThan(0);

  const modified = body.files.find((f: { path: string }) => f.path === MODIFIED_FILE);
  expect(modified.status).toBe("modified");
  expect(modified.hunks.length).toBeGreaterThanOrEqual(1);
  const lines = modified.hunks.flatMap(
    (h: { lines: { type: string; content: string }[] }) => h.lines
  );
  expect(lines.some((l: { type: string }) => l.type === "addition")).toBe(true);
  expect(lines.some((l: { type: string }) => l.type === "deletion")).toBe(true);

  expect(body.summary.filesChanged).toBe(2);
  expect(body.summary.byStatus.added).toBe(1);
  expect(body.summary.byStatus.modified).toBe(1);
});

test("Changes tab renders the file list and a hunk for the feature branch", async ({
  page,
  request,
}) => {
  const sessionName = `e2e-diff-${uniqueSuffix()}`;
  const branch = `feature/e2e-diff-${uniqueSuffix()}`;

  await page.goto("/dashboard");

  // Create a session whose worktree branches off the sample-repo (TERMINUS_ROOT),
  // and apply the same feature change so the Changes tab has something to show.
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

  const branchInput = page.getByPlaceholder(/feature\//i);
  await branchInput.fill(branch);

  await page.getByRole("button", { name: /create/i }).click();

  // Wait for the worktree to exist, then commit a change inside it so the diff
  // against its merge-base is non-empty.
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

  fs.mkdirSync(path.join(worktreePath, ".terminalx"), { recursive: true });
  fs.writeFileSync(
    path.join(worktreePath, ADDED_FILE),
    '[diff]\nenabled = true\nmode = "unified"\n'
  );
  fs.writeFileSync(path.join(worktreePath, "src", "index.ts"), "export const value = 2;\n");
  git(worktreePath, ["add", "."]);
  git(worktreePath, [
    "-c",
    "user.email=e2e@x.test",
    "-c",
    "user.name=e2e",
    "commit",
    "-m",
    "e2e change",
  ]);

  // Open the workspace and reveal the Changes tab.
  await page.goto(`/workspace/${encodeURIComponent(sessionName)}`);

  const changesTab = page.getByTestId("review-tab-changes");
  await expect(changesTab).toBeVisible();
  await changesTab.click();

  // File rows: the added settings.toml + the modified index.ts.
  const settingsRow = page.locator(
    '[data-testid="diff-file-row"][data-file-path="' + ADDED_FILE + '"]'
  );
  await expect(settingsRow).toBeVisible({ timeout: 15_000 });
  await expect(settingsRow).toContainText("settings.toml");

  const indexRow = page.locator(
    '[data-testid="diff-file-row"][data-file-path="' + MODIFIED_FILE + '"]'
  );
  await expect(indexRow).toBeVisible();
  // +N delta badge on the modified file.
  await expect(indexRow.getByTestId("diff-file-additions")).toBeVisible();

  // Expand the modified file (it may already be expanded) and assert a hunk line.
  await indexRow.click();
  const body = page
    .getByTestId("diff-file-body")
    .filter({ has: page.getByTestId("diff-line") })
    .first();
  await expect(body.getByTestId("diff-line").first()).toBeVisible({ timeout: 15_000 });
  // An addition line carrying the new value should be present.
  await expect(
    page.locator('[data-testid="diff-line"][data-line-type="addition"]').first()
  ).toBeVisible();

  // Cleanup.
  await request.delete(`/api/sessions/${encodeURIComponent(sessionName)}`).catch(() => undefined);
});

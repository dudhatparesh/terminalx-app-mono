import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

/**
 * E2E for Issue #3 — a human can create a NEW top-level inline comment on a diff
 * line (not just reply to an existing thread).
 *
 * Flow: create a session whose worktree has a committed change, open the Changes
 * tab, reveal a diff line's comment affordance (`line-comment-add`), type into the
 * inline composer (`line-comment-composer` / `line-comment-input`) and submit
 * (`line-comment-submit`). Then assert:
 *
 *  1. the draft is persisted server-side (data/pr-review/<session>.json) with
 *     inReplyToId UNDEFINED (a fresh top-level comment, NOT a reply); and
 *  2. it surfaces in the Review tab as a draft-only thread.
 */

const SANDBOX_REPO = path.resolve(__dirname, "..", "..", ".test-sandbox", "sample-repo");
const WORKTREES_ROOT = path.join(SANDBOX_REPO, ".terminalx-worktrees");
const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
const MODIFIED_FILE = "src/index.ts";
const ADDED_FILE = ".terminalx/settings.toml";

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function clearPrReviewStore(session: string): void {
  const file = path.join(DATA_DIR, "pr-review", `${session}.json`);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}

test.beforeAll(() => {
  // Ensure the sample-repo is a git repo with a base commit on main.
  fs.mkdirSync(path.join(SANDBOX_REPO, "src"), { recursive: true });
  if (!fs.existsSync(path.join(SANDBOX_REPO, ".git"))) {
    git(SANDBOX_REPO, ["init", "-b", "main"]);
    git(SANDBOX_REPO, ["config", "user.email", "terminalx@example.test"]);
    git(SANDBOX_REPO, ["config", "user.name", "TerminalX Test"]);
  }
  try {
    git(SANDBOX_REPO, ["checkout", "main"]);
  } catch {
    /* already on main */
  }
  fs.writeFileSync(path.join(SANDBOX_REPO, "src", "index.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(SANDBOX_REPO, "README.md"), "sample repo\n");
  git(SANDBOX_REPO, ["add", "src/index.ts", "README.md"]);
  try {
    git(SANDBOX_REPO, ["commit", "-m", "base"]);
  } catch {
    /* nothing to commit */
  }
});

test.afterAll(() => {
  // Best-effort hygiene: remove any worktree dirs this spec produced so a sibling
  // spec's `git add .` (e.g. diff-viewer) can't capture them into a feature diff.
  try {
    git(SANDBOX_REPO, ["checkout", "main"]);
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(WORKTREES_ROOT)) fs.rmSync(WORKTREES_ROOT, { recursive: true, force: true });
    git(SANDBOX_REPO, ["worktree", "prune"]);
  } catch {
    /* ignore */
  }
});

async function createWorktreeSessionWithChange(
  page: Page,
  request: Page["request"]
): Promise<{ session: string }> {
  const session = `e2e-inline-${uniqueSuffix()}`;
  const branch = `feature/e2e-inline-${uniqueSuffix()}`;

  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: /new session/i })
    .first()
    .click();

  const nameInput = page.getByPlaceholder("my-project");
  await expect(nameInput).toBeVisible();
  await nameInput.fill(session);

  const worktreeToggle = page.getByLabel(/create Git worktree/i);
  await expect(worktreeToggle).toBeVisible();
  await worktreeToggle.check();
  await page.getByPlaceholder(/feature\//i).fill(branch);
  await page.getByRole("button", { name: /create/i }).click();

  // Wait for the worktree path, then commit a change so the diff is non-empty.
  let worktreePath = "";
  await expect
    .poll(
      async () => {
        const res = await request.get("/api/sessions");
        if (!res.ok()) return "";
        const data = await res.json();
        const sessions: Array<{ name: string; worktree?: { path?: string } }> =
          data.sessions ?? data;
        worktreePath = sessions.find((s) => s.name === session)?.worktree?.path ?? "";
        return worktreePath;
      },
      { timeout: 20_000 }
    )
    .not.toBe("");

  fs.mkdirSync(path.join(worktreePath, ".terminalx"), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, ADDED_FILE), "[diff]\nenabled = true\n");
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

  clearPrReviewStore(session);
  return { session };
}

test("adds a NEW inline comment on a diff line → draft-only thread in Review tab", async ({
  page,
  request,
}) => {
  const { session } = await createWorktreeSessionWithChange(page, request);

  await page.goto(`/workspace/${encodeURIComponent(session)}`);

  // Open the Changes tab and expand the modified file to render its lines.
  const changesTab = page.getByTestId("review-tab-changes");
  await expect(changesTab).toBeVisible();
  await changesTab.click();

  // Scope to the modified file's container so the addition line we comment on is
  // unambiguously inside src/index.ts (other files may also have additions).
  // Small files are expanded by default (prefs.collapsed === []) and their hunks
  // load lazily — so we just WAIT for the file's addition line, never toggling.
  const indexFile = page
    .getByTestId("diff-file")
    .filter({ has: page.locator(`[data-file-path="${MODIFIED_FILE}"]`) });
  await expect(indexFile).toBeVisible({ timeout: 15_000 });

  const additionLine = indexFile
    .locator('[data-testid="diff-line"][data-line-type="addition"]')
    .first();
  await expect(additionLine).toBeVisible({ timeout: 15_000 });
  await additionLine.hover();

  const addBtn = additionLine.getByTestId("line-comment-add");
  await expect(addBtn).toBeVisible();
  await addBtn.click();

  // The inline composer opens; type a NEW top-level comment and submit.
  const composer = page.getByTestId("line-comment-composer");
  await expect(composer).toBeVisible();
  await composer.getByTestId("line-comment-input").fill("Should this be a constant?");
  await composer.getByTestId("line-comment-submit").click();

  // 1) The draft is persisted server-side with inReplyToId UNDEFINED.
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/sessions/${encodeURIComponent(session)}/review/drafts`);
        if (!res.ok()) return null;
        const body = await res.json();
        return body.drafts as Array<{
          path: string;
          body: string;
          inReplyToId?: number;
        }>;
      },
      { timeout: 10_000 }
    )
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: MODIFIED_FILE,
          body: "Should this be a constant?",
        }),
      ])
    );

  const draftsRes = await request.get(`/api/sessions/${encodeURIComponent(session)}/review/drafts`);
  const draftsBody = await draftsRes.json();
  const newDraft = draftsBody.drafts.find(
    (d: { body: string }) => d.body === "Should this be a constant?"
  );
  expect(newDraft).toBeTruthy();
  // It is a NEW top-level comment, NOT a reply.
  expect(newDraft.inReplyToId == null).toBe(true);

  // The on-disk store exists (server-persisted, NOT IndexedDB).
  expect(fs.existsSync(path.join(DATA_DIR, "pr-review", `${session}.json`))).toBeTruthy();

  // 2) It surfaces in the Review tab as a draft (pending) thread.
  await page.getByTestId("review-tab-review").click();
  // The draft body + a Pending tag appear in the Review tab's thread list.
  await expect(
    page.getByTestId("review-draft-reply").filter({ hasText: "Should this be a constant?" })
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("review-pending-tag").first()).toBeVisible();

  // Cleanup.
  clearPrReviewStore(session);
  await request.delete(`/api/sessions/${encodeURIComponent(session)}`).catch(() => undefined);
});

test("the reply flow still creates a reply draft (regression guard)", async ({ request }) => {
  // Pure-API regression: the existing reply path (inReplyToId set) is unchanged
  // by the new top-level affordance — both kinds of draft round-trip the store.
  const session = `e2e-inline-reply-${uniqueSuffix()}`;
  clearPrReviewStore(session);

  const replyId = `draft:${session}:src/index.ts:3:reply`;
  const reply = await request.put(
    `/api/sessions/${encodeURIComponent(session)}/review/drafts/${encodeURIComponent(replyId)}`,
    { data: { path: "src/index.ts", line: 3, side: "RIGHT", inReplyToId: 4242, body: "agreed" } }
  );
  expect(reply.ok()).toBeTruthy();

  const newId = `draft:${session}:src/index.ts:9:fresh`;
  const fresh = await request.put(
    `/api/sessions/${encodeURIComponent(session)}/review/drafts/${encodeURIComponent(newId)}`,
    { data: { path: "src/index.ts", line: 9, side: "RIGHT", body: "new top-level note" } }
  );
  expect(fresh.ok()).toBeTruthy();

  const list = await request.get(`/api/sessions/${encodeURIComponent(session)}/review/drafts`);
  const body = await list.json();
  const byId = Object.fromEntries(
    body.drafts.map((d: { id: string; inReplyToId?: number }) => [d.id, d.inReplyToId])
  );
  expect(byId[replyId]).toBe(4242); // reply preserved
  expect(byId[newId] == null).toBe(true); // top-level has no inReplyToId

  clearPrReviewStore(session);
});

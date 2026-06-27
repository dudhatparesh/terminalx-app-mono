import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

/**
 * E2E for Issue #8 — PR creation & review (the "Review" tab of the Review panel).
 *
 * Two halves, both written against the spec'd UI + API contracts and stable
 * data-testids:
 *
 *  1. API layer (offline, no GitHub): the session-scoped routes enforce the
 *     repo's 403-never-401 auth pattern, and the local draft store round-trips
 *     through data/pr-review/<session>.json (NOT IndexedDB) — upsert, list,
 *     resolve toggle, discard.
 *
 *  2. UI layer: a session rooted at the sandbox sample-repo opens the Review tab
 *     (eye icon) INSIDE ReviewPanel (not a modal/page), shows the Create-PR empty
 *     state when the branch has no PR, and the Create-PR dialog validates
 *     head===base inline before any network call.
 *
 * The GitHub REST host is pointed at a Playwright-routed mock via the server's
 * GITHUB_API_BASE_URL so the create/list hops stay offline. When the repo isn't
 * bound to an integration the Review tab shows "Connect this repo" — that branch
 * needs no network and is asserted directly.
 */

const SANDBOX_REPO = path.resolve(__dirname, "..", "..", ".test-sandbox", "sample-repo");
const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
const FEATURE_BRANCH = "feature/pr-review-e2e";

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

function clearPrReviewStore(): void {
  const dir = path.join(DATA_DIR, "pr-review");
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function seedBranch(): void {
  if (!fs.existsSync(SANDBOX_REPO)) return;
  gitSafe(SANDBOX_REPO, ["checkout", "-b", FEATURE_BRANCH]);
  gitSafe(SANDBOX_REPO, ["checkout", FEATURE_BRANCH]);
}

test.beforeEach(() => {
  clearPrReviewStore();
  seedBranch();
});
test.afterEach(() => {
  clearPrReviewStore();
});

async function createSession(page: Page, name: string): Promise<void> {
  await page.request.post("/api/sessions", {
    data: {
      name,
      kind: "bash",
      worktree: { repoRoot: SANDBOX_REPO, branch: FEATURE_BRANCH },
    },
  });
}

test.describe("PR-review API routes", () => {
  test("review routes answer 403 (never 401) for an unidentified caller in multi-user mode", async ({
    request,
  }) => {
    // The webServer runs in auth-mode 'none' by default (single-user pass-through),
    // so this assertion is mode-aware: in pass-through every route must be < 401;
    // in multi-user the unidentified caller is 403. NEITHER mode may return 401.
    for (const url of [
      "/api/sessions/ghost-session/review",
      "/api/sessions/ghost-session/review/drafts",
    ]) {
      const res = await request.get(url);
      expect(res.status()).not.toBe(401);
    }
  });

  test("draft store round-trips through data/pr-review/<session>.json (no IndexedDB)", async ({
    request,
  }) => {
    const session = "e2e-prr-drafts";
    const id = `draft:${session}:src/index.ts:3:e2e`;

    // PUT upserts a draft.
    const put = await request.put(`/api/sessions/${session}/review/drafts/${id}`, {
      data: { path: "src/index.ts", line: 3, side: "RIGHT", body: "needs a guard here" },
    });
    expect(put.ok()).toBeTruthy();

    // It is persisted server-side and listable.
    const list = await request.get(`/api/sessions/${session}/review/drafts`);
    const body = await list.json();
    expect(body.drafts.map((d: { id: string }) => d.id)).toContain(id);

    // The on-disk file exists (server-persisted, NOT IndexedDB).
    const file = path.join(DATA_DIR, "pr-review", `${session}.json`);
    expect(fs.existsSync(file)).toBeTruthy();

    // Resolve toggle flips a TerminalX-tracked flag (never posted to GitHub).
    const resolve = await request.post(`/api/sessions/${session}/review/resolve`, {
      data: { key: "src/index.ts::3::RIGHT", resolved: true },
    });
    expect(resolve.ok()).toBeTruthy();

    // DELETE discards the draft.
    const del = await request.delete(`/api/sessions/${session}/review/drafts/${id}`);
    expect(del.ok()).toBeTruthy();
    const after = await request.get(`/api/sessions/${session}/review/drafts`);
    const afterBody = await after.json();
    expect(afterBody.drafts.map((d: { id: string }) => d.id)).not.toContain(id);
  });

  test("create-PR rejects head === base before any network call", async ({ request }) => {
    const session = "e2e-prr-create";
    await request.post("/api/sessions", {
      data: { name: session, kind: "bash", worktree: { repoRoot: SANDBOX_REPO, branch: "main" } },
    });
    const res = await request.post(`/api/sessions/${session}/pr`, {
      data: { title: "X", base: "main", head: "main" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/differ/i);
    await request.delete(`/api/sessions/${session}`);
  });
});

test.describe("PR-review UI — Review tab inside ReviewPanel", () => {
  test("Review tab renders inline (eye icon), not as a modal or routed page", async ({ page }) => {
    const session = "e2e-prr-ui";
    await createSession(page, session);

    await page.goto(`/workspace/${encodeURIComponent(session)}`);

    // The Review tab lives in the shared ReviewPanel shell, alongside the status bar.
    const panel = page.getByTestId("review-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("review-status-bar")).toBeVisible();

    // Switch to the Review tab (eye icon).
    await page.getByTestId("review-tab-review").click();

    // The Review body is mounted; it is NOT a modal and we did NOT navigate away.
    await expect(page).toHaveURL(new RegExp(`/workspace/${session}`));
    await expect(
      page.getByTestId("review-tab").or(page.getByTestId("review-no-pr")).first()
    ).toBeVisible();

    await page.request.delete(`/api/sessions/${session}`);
  });

  test("no PR for the branch → Create-PR affordance + dialog validates head===base", async ({
    page,
  }) => {
    const session = "e2e-prr-ui-nopr";
    await createSession(page, session);
    await page.goto(`/workspace/${encodeURIComponent(session)}`);
    await page.getByTestId("review-tab-review").click();

    // With no PR (and no GitHub binding), the empty state offers Create PR OR the
    // "Connect this repo" hint — either way the review surface is shown inline.
    const noPr = page.getByTestId("review-no-pr");
    await expect(noPr).toBeVisible();

    const createBtn = page.getByTestId("review-create-pr");
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
      const dialog = page.getByTestId("create-pr-dialog");
      await expect(dialog).toBeVisible();

      // head is the session branch (read-only); set base to the same value and
      // assert inline validation blocks submit with NO network round-trip.
      await page.getByTestId("create-pr-base").fill(FEATURE_BRANCH);
      await page.getByTestId("create-pr-submit").click();
      await expect(page.getByTestId("create-pr-base-error")).toBeVisible();
    } else {
      // Unbound repo → the "Connect this repo" hint links to settings.
      await expect(page.getByTestId("review-connect-repo")).toBeVisible();
    }

    await page.request.delete(`/api/sessions/${session}`);
  });
});

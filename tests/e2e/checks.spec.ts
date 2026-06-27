import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

/**
 * E2E for Issue #6 — Checks dashboard (the "Checks" tab of the Review panel).
 *
 * GET /api/checks is the single status-aggregation endpoint. Its informational
 * states (no-repo / no-auth / no-pr / none) are returned as 200 envelopes — NEVER
 * a 401 — per the spec's auth model. This spec asserts:
 *  1. API envelope contract for the informational states over a real server;
 *  2. the UI — the Checks tab renders inside the Review panel tab strip and shows
 *     a distinct empty state with stable data-testids.
 *
 * Written against the spec'd UI + API and stable data-testids. The server hop to
 * GitHub is avoided by exercising the no-repo / no-auth paths, which make zero
 * GitHub calls, so this runs fully offline.
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
    /* ignore — idempotent seeding */
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
  git(SANDBOX_REPO, ["add", "."]);
  gitSafe(SANDBOX_REPO, ["commit", "-m", "base"]);
});

test("GET /api/checks 400s when sessionName is missing", async ({ request }) => {
  const res = await request.get("/api/checks");
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.status).toBe("error");
  expect(body.code).toBe("INVALID_REQUEST");
});

test("GET /api/checks returns an informational 200 (never 401) for an unknown session", async ({
  request,
}) => {
  const res = await request.get(`/api/checks?sessionName=does-not-exist-${uniqueSuffix()}`);
  // Informational state — the session has no dir, so it is a no-repo rollup, 200.
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("success");
  expect(body.data.rollup).toBe("no-repo");
  expect(body.data.items).toEqual([]);
});

test("Checks tab renders inside the Review panel with an empty state", async ({
  page,
  request,
}) => {
  const sessionName = `e2e-checks-${uniqueSuffix()}`;
  const branch = `feature/e2e-checks-${uniqueSuffix()}`;

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

  const branchInput = page.getByPlaceholder(/feature\//i);
  await branchInput.fill(branch);

  await page.getByRole("button", { name: /create/i }).click();

  await expect
    .poll(
      async () => {
        const res = await request.get("/api/sessions");
        if (!res.ok()) return "";
        const data = await res.json();
        const sessions: Array<{ name: string }> = data.sessions ?? data;
        return sessions.find((s) => s.name === sessionName)?.name ?? "";
      },
      { timeout: 20_000 }
    )
    .toBe(sessionName);

  await page.goto(`/workspace/${encodeURIComponent(sessionName)}`);

  // The Checks tab is one of the Review-panel tabs (not a sidebar / standalone page).
  const checksTab = page.getByTestId("review-tab-checks");
  await expect(checksTab).toBeVisible();
  await checksTab.click();

  // Tab content mounts; with no GitHub remote/token the sandbox repo yields a
  // distinct empty state (no-repo or error/no-auth) — never a blank tab.
  const tab = page.getByTestId("checks-tab");
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("checks-empty-state")).toBeVisible({ timeout: 15_000 });

  // The per-tab refresh control is present.
  await expect(page.getByTestId("checks-refresh")).toBeVisible();

  await request.delete(`/api/sessions/${encodeURIComponent(sessionName)}`).catch(() => undefined);
});

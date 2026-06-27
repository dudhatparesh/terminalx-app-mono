import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

// DELETE /api/workspaces/[id] cleanup (issue #9): deleting a WORKSPACE removes
// each worktree (removeGitWorktree) AND prunes its recordings under
// data/recordings/. This is the confirmed-delete path — distinct from archiving
// a single worktree (which keeps recordings). The store captures cwd at module
// load, so we chdir into a tmp repo and load fresh modules.

const ADMIN = { "x-username": "admin", "x-user-role": "admin" };

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function mockReq(headers: Record<string, string>) {
  return { headers: { get: (h: string) => headers[h.toLowerCase()] ?? null } } as never;
}

function writeRecording(cwd: string, fileBase: string, sessionId: string): string {
  const dir = path.join(cwd, "data", "recordings");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${fileBase}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({ v: 1, sessionId }) + "\n");
  return file;
}

const describeGit = hasGit() ? describe : describe.skip;

describeGit("DELETE /api/workspaces/[id] prunes recordings (issue #9)", () => {
  let cwd: string;
  let prevCwd: string;
  let repoDir: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tx-wsdel-")));
    process.chdir(cwd);
    process.env.TERMINUS_ROOT = cwd;

    repoDir = path.join(cwd, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    git(cwd, ["init", repoDir]);
    git(repoDir, ["config", "user.email", "terminalx@example.test"]);
    git(repoDir, ["config", "user.name", "TerminalX Test"]);
    fs.writeFileSync(path.join(repoDir, "README.md"), "hi\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "init"]);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(cwd, { recursive: true, force: true });
    delete process.env.TERMINUS_ROOT;
    delete process.env.TERMINALX_WORKTREES_ROOT;
  });

  it("removes the worktree + prunes its recordings, then drops the workspace", async () => {
    vi.resetModules();
    const { createGitWorktreeForSession } = await import("@/lib/git-worktree");
    const created = createGitWorktreeForSession(repoDir, "feature/del");
    const { saveMeta } = await import("@/lib/ai-sessions");
    await saveMeta({
      name: "wt-del",
      kind: "bash",
      createdAt: new Date().toISOString(),
      worktree: {
        repoRoot: created.repoRoot,
        path: created.worktreePath,
        branch: created.branch,
        linkedPaths: created.linkedPaths,
      },
    });
    const { registerWorkspace } = await import("@/lib/workspaces/store");
    const ws = await registerWorkspace({ directory: repoDir });

    // A recording for the worktree session + an unrelated one that must survive.
    const mine = writeRecording(cwd, "wt-del-1700000000000", "wt-del");
    const other = writeRecording(cwd, "keep-1700000000000", "keep");

    vi.resetModules();
    const route = await import("@/app/api/workspaces/[id]/route");
    const res = await route.DELETE(mockReq(ADMIN), {
      params: Promise.resolve({ id: ws.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removedWorktrees).toBe(1);

    // Worktree removed on disk, recording pruned, unrelated recording kept.
    expect(fs.existsSync(created.worktreePath)).toBe(false);
    expect(fs.existsSync(mine)).toBe(false);
    expect(fs.existsSync(other)).toBe(true);

    // Workspace + session metadata dropped.
    const { getWorkspace } = await import("@/lib/workspaces/store");
    expect(getWorkspace(ws.id)).toBeUndefined();
    const { getMeta } = await import("@/lib/ai-sessions");
    expect(getMeta("wt-del")).toBeUndefined();
  });

  it("404s for an unknown workspace id", async () => {
    vi.resetModules();
    const route = await import("@/app/api/workspaces/[id]/route");
    const res = await route.DELETE(mockReq(ADMIN), {
      params: Promise.resolve({ id: "no-such-id" }),
    });
    expect(res.status).toBe(404);
  });
});

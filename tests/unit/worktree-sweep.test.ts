import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// pruneOrphanedWorktrees (issue #9): a best-effort sweep that drops worktree
// dirs under the worktrees root whose owning session no longer exists. Active +
// archived worktrees (still referenced by a session meta) are KEPT. The store
// captures cwd/TERMINUS_ROOT at module load, so we chdir + load fresh modules.

async function freshModules() {
  vi.resetModules();
  const sessions = await import("@/lib/ai-sessions");
  const sweep = await import("@/lib/worktree-sweep");
  return { sessions, sweep };
}

describe("pruneOrphanedWorktrees (issue #9)", () => {
  let cwd: string;
  let prevCwd: string;
  let worktreesRoot: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tx-sweep-")));
    process.chdir(cwd);
    process.env.TERMINUS_ROOT = cwd;
    worktreesRoot = path.join(cwd, "worktrees");
    fs.mkdirSync(worktreesRoot, { recursive: true });
    process.env.TERMINALX_WORKTREES_ROOT = worktreesRoot;
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(cwd, { recursive: true, force: true });
    delete process.env.TERMINUS_ROOT;
    delete process.env.TERMINALX_WORKTREES_ROOT;
  });

  function mkWorktreeDir(name: string): string {
    const p = path.join(worktreesRoot, name);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "file.txt"), "x");
    return p;
  }

  it("removes a worktree dir with no owning session, keeps referenced ones", async () => {
    const { sessions, sweep } = await freshModules();

    const orphan = mkWorktreeDir("repo-aaaa-orphan");
    const active = mkWorktreeDir("repo-aaaa-active");
    const archived = mkWorktreeDir("repo-aaaa-archived");

    await sessions.saveMeta({
      name: "active",
      kind: "bash",
      createdAt: new Date().toISOString(),
      worktree: { repoRoot: path.join(cwd, "repo"), path: active, branch: "feature/active" },
    });
    await sessions.saveMeta({
      name: "archived",
      kind: "bash",
      createdAt: new Date().toISOString(),
      archived: true,
      worktree: { repoRoot: path.join(cwd, "repo"), path: archived, branch: "feature/arch" },
    });

    const { removed } = sweep.pruneOrphanedWorktrees();

    expect(removed).toBe(1);
    expect(fs.existsSync(orphan)).toBe(false);
    // A live session's worktree is kept.
    expect(fs.existsSync(active)).toBe(true);
    // An ARCHIVED worktree's dir is kept too — its meta still references it so a
    // restore can rebuild in place. (Archive itself removes the on-disk dir; this
    // guards the case where the dir lingers and the meta is still archived.)
    expect(fs.existsSync(archived)).toBe(true);
  });

  it("returns {removed:0} when the worktrees root is absent or empty", async () => {
    const { sweep } = await freshModules();
    fs.rmSync(worktreesRoot, { recursive: true, force: true });
    expect(sweep.pruneOrphanedWorktrees().removed).toBe(0);
    fs.mkdirSync(worktreesRoot, { recursive: true });
    expect(sweep.pruneOrphanedWorktrees().removed).toBe(0);
  });

  it("ignores files and never throws on a malformed entry", async () => {
    const { sweep } = await freshModules();
    fs.writeFileSync(path.join(worktreesRoot, "stray-file"), "not a dir");
    expect(() => sweep.pruneOrphanedWorktrees()).not.toThrow();
    // The stray file is left alone (the sweep only prunes orphaned DIRS).
    expect(fs.existsSync(path.join(worktreesRoot, "stray-file"))).toBe(true);
  });
});

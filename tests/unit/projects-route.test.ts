import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function git(repo: string, args: string[]): void {
  execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
}

const ADMIN = { "x-username": "admin", "x-user-role": "admin" };

function mockReq(headers: Record<string, string> = {}, body?: unknown) {
  return {
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as never;
}

// Fresh route modules per test so every store captures the per-test cwd.
async function freshRoutes() {
  vi.resetModules();
  const list = await import("@/app/api/projects/route");
  const byId = await import("@/app/api/projects/[id]/route");
  return { GET: list.GET, POST: list.POST, DELETE: byId.DELETE };
}

function writeSessionsJson(cwd: string, metas: unknown[]) {
  const dir = path.join(cwd, "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ai-sessions.json"), JSON.stringify(metas, null, 2));
}

const describeGit = hasGit() ? describe : describe.skip;

describeGit("/api/projects (issue #12, corrected model)", () => {
  let root: string;
  let cwd: string;
  let repo: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tx-projroute-")));
    process.env.TERMINUS_ROOT = root;
    cwd = path.join(root, "cwd");
    fs.mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    repo = path.join(root, "proj");
    fs.mkdirSync(repo, { recursive: true });
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.test"]);
    git(repo, ["config", "user.name", "T"]);
    fs.writeFileSync(path.join(repo, "README.md"), "base\n");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "base"]);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    delete process.env.TERMINUS_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("403s for an unidentified caller", async () => {
    const { GET } = await freshRoutes();
    const res = await GET(mockReq());
    expect(res.status).toBe(403);
  });

  it("POST registers a repo as a project; GET groups it with no workspaces", async () => {
    const { POST, GET } = await freshRoutes();
    const postRes = await POST(mockReq(ADMIN, { directory: repo }));
    expect(postRes.status).toBe(201);
    const posted = await postRes.json();
    expect(posted.project.repoRoot).toBe(fs.realpathSync(repo));

    const getRes = await GET(mockReq(ADMIN));
    expect(getRes.status).toBe(200);
    const { projects } = await getRes.json();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("proj");
    expect(projects[0].workspaces).toEqual([]);
  });

  it("POST rejects a non-git directory with 400", async () => {
    const plain = path.join(root, "plain");
    fs.mkdirSync(plain);
    const { POST } = await freshRoutes();
    const res = await POST(mockReq(ADMIN, { directory: plain }));
    expect(res.status).toBe(400);
  });

  it("GET derives workspaces from sessions whose worktree.repoRoot matches, with a diff stat", async () => {
    const repoRoot = fs.realpathSync(repo);
    // A real git worktree on a branch with a change, so the numstat is non-zero.
    const wtPath = path.join(root, "wt-feature");
    git(repo, ["worktree", "add", "-b", "feat/sidebar", wtPath]);
    fs.writeFileSync(path.join(wtPath, "added.txt"), "one\ntwo\nthree\n");
    git(wtPath, ["add", "added.txt"]);
    git(wtPath, ["commit", "-m", "add file"]);

    writeSessionsJson(cwd, [
      {
        name: "feat-sidebar",
        kind: "bash",
        createdAt: new Date().toISOString(),
        worktree: { repoRoot, path: wtPath, branch: "feat/sidebar" },
      },
      {
        // Different repo → must NOT be grouped under this project.
        name: "other",
        kind: "bash",
        createdAt: new Date().toISOString(),
        worktree: { repoRoot: "/some/other/repo", path: "/x", branch: "b" },
      },
    ]);

    const { POST, GET } = await freshRoutes();
    await POST(mockReq(ADMIN, { directory: repo }));
    const getRes = await GET(mockReq(ADMIN));
    const { projects } = await getRes.json();
    expect(projects).toHaveLength(1);
    const wss = projects[0].workspaces;
    expect(wss).toHaveLength(1);
    expect(wss[0].sessionName).toBe("feat-sidebar");
    expect(wss[0].branch).toBe("feat/sidebar");
    expect(wss[0].diffStat.additions).toBe(3);
    expect(wss[0].diffStat.deletions).toBe(0);
    // No GitHub binding in the sandbox → falls back to in-progress (branch icon).
    expect(wss[0].status).toBe("in-progress");
  });

  it("DELETE removes the project and tears down its workspaces", async () => {
    const repoRoot = fs.realpathSync(repo);
    const wtPath = path.join(root, "wt-del");
    git(repo, ["worktree", "add", "-b", "feat/del", wtPath]);

    writeSessionsJson(cwd, [
      {
        name: "feat-del",
        kind: "bash",
        createdAt: new Date().toISOString(),
        worktree: { repoRoot, path: wtPath, branch: "feat/del" },
      },
    ]);

    const { POST, DELETE, GET } = await freshRoutes();
    const posted = await (await POST(mockReq(ADMIN, { directory: repo }))).json();
    const id = posted.project.id;

    const delRes = await DELETE(mockReq(ADMIN), { params: Promise.resolve({ id }) });
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.removedWorkspaces).toBe(1);

    // Project registration gone.
    const { projects } = await (await GET(mockReq(ADMIN))).json();
    expect(projects).toEqual([]);
    // Session meta dropped + the git worktree removed from disk.
    const remaining = JSON.parse(
      fs.readFileSync(path.join(cwd, "data", "ai-sessions.json"), "utf-8")
    );
    expect(remaining).toEqual([]);
    expect(fs.existsSync(wtPath)).toBe(false);
  });

  it("DELETE 404s for an unknown project id", async () => {
    const { DELETE } = await freshRoutes();
    const res = await DELETE(mockReq(ADMIN), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });
});

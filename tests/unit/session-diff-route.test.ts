import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function mockGet(
  name: string,
  query: Record<string, string> = {},
  headers: Record<string, string> = {}
) {
  return {
    req: {
      headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
      nextUrl: { searchParams: new URLSearchParams(query) },
    } as never,
    ctx: { params: Promise.resolve({ name }) },
  };
}

async function loadSessionDiffRoute() {
  return await import("@/app/api/sessions/[name]/diff/route");
}

describe("GET /api/sessions/[name]/diff auth gate", () => {
  afterEach(() => {
    delete process.env.TERMINALX_AUTH_MODE;
  });

  it("403s (never 401) for an unidentified caller in multi-user mode", async () => {
    process.env.TERMINALX_AUTH_MODE = "local";
    const { GET } = await loadSessionDiffRoute();
    const { req, ctx } = mockGet("someones-session"); // no identity headers
    const res = await GET(req, ctx);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Access denied");
  });

  it("403s when a non-admin user accesses another user's session", async () => {
    process.env.TERMINALX_AUTH_MODE = "local";
    const { GET } = await loadSessionDiffRoute();
    const { req, ctx } = mockGet(
      "bob-feature",
      {},
      { "x-username": "alice", "x-user-role": "user" }
    );
    const res = await GET(req, ctx);
    expect(res.status).toBe(403);
  });
});

const describeGit = hasGit() ? describe : describe.skip;

describeGit("GET /api/sessions/[name]/diff resolution", () => {
  let root: string;
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tx-sess-diff-")));
    process.env.TERMINUS_ROOT = root;
    process.env.TERMINALX_AUTH_MODE = "none"; // local/admin pass-through

    repoDir = path.join(root, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    git(root, ["init", "-b", "main", repoDir]);
    git(repoDir, ["config", "user.email", "terminalx@example.test"]);
    git(repoDir, ["config", "user.name", "TerminalX Test"]);
    fs.writeFileSync(path.join(repoDir, "a.ts"), "const a = 1;\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "initial"]);
    git(repoDir, ["checkout", "-b", "feature/sample-change"]);
    fs.writeFileSync(path.join(repoDir, "a.ts"), "const a = 2;\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "change"]);

    // Run from the repo dir so getGitDirectoryInfo(process.cwd()) resolves when
    // no worktree is recorded for the session.
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.TERMINUS_ROOT;
    delete process.env.TERMINALX_AUTH_MODE;
  });

  it("falls back to getGitDirectoryInfo(cwd) when the session has no worktree", async () => {
    const { GET } = await loadSessionDiffRoute();
    const { req, ctx } = mockGet("nonexistent-session", {
      base: "main",
      head: "feature/sample-change",
    });
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files.map((f: { path: string }) => f.path)).toContain("a.ts");
    // List view omits hunks (spec §3.1).
    expect(body.files[0].hunks).toBeUndefined();
    expect(body.request.session).toBe("nonexistent-session");
  });
});

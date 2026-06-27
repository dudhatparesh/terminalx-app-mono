import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { isValidRef, sanitizeDiffError } from "@/lib/diff-api";

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

function mockPost(body: unknown, headers: Record<string, string> = {}) {
  return {
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    nextUrl: { searchParams: new URLSearchParams() },
  } as never;
}

async function loadDiffsRoute() {
  return await import("@/app/api/diffs/route");
}

// ---------------------------------------------------------------------------
// diff-api pure helpers.
// ---------------------------------------------------------------------------

describe("isValidRef", () => {
  it("accepts ordinary refs and ranges", () => {
    expect(isValidRef("main")).toBe(true);
    expect(isValidRef("feature/sample-change")).toBe(true);
    expect(isValidRef("HEAD~1")).toBe(true);
    expect(isValidRef("origin/main")).toBe(true);
  });

  it("rejects flag-like refs and empties", () => {
    expect(isValidRef("--output=/etc/passwd")).toBe(false);
    expect(isValidRef("-rf")).toBe(false);
    expect(isValidRef("")).toBe(false);
  });

  it("rejects refs containing shell metacharacters / spaces", () => {
    expect(isValidRef("main; rm -rf /")).toBe(false);
    expect(isValidRef("a b")).toBe(false);
    expect(isValidRef("$(whoami)")).toBe(false);
  });
});

describe("sanitizeDiffError", () => {
  it("maps outside-root to 403 without leaking the path", async () => {
    const res = sanitizeDiffError(new Error("Path is outside the allowed root directory: /secret"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Access denied");
    expect(JSON.stringify(body)).not.toContain("/secret");
  });

  it("maps sensitive paths to 403", async () => {
    const res = sanitizeDiffError(new Error("Access denied to sensitive path"));
    expect(res.status).toBe(403);
  });

  it("maps ENOENT to 404", async () => {
    const res = sanitizeDiffError(new Error("ENOENT: no such file"));
    expect(res.status).toBe(404);
  });

  it("maps timeouts/buffer overflows to a generic 500", async () => {
    const res = sanitizeDiffError(new Error("spawnSync git ETIMEDOUT"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to compute diff");
  });

  it("maps unknown revisions to 400", async () => {
    const res = sanitizeDiffError(new Error("fatal: bad revision 'nope'"));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/diffs handler — real git repo confined to TERMINUS_ROOT.
// ---------------------------------------------------------------------------

const describeGit = hasGit() ? describe : describe.skip;

describeGit("POST /api/diffs", () => {
  let root: string;
  let repoDir: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tx-diffs-route-")));
    process.env.TERMINUS_ROOT = root;
    process.env.TERMINALX_AUTH_MODE = "none";
    repoDir = path.join(root, "repo");
    fs.mkdirSync(path.join(repoDir, "src"), { recursive: true });
    git(root, ["init", "-b", "main", repoDir]);
    git(repoDir, ["config", "user.email", "terminalx@example.test"]);
    git(repoDir, ["config", "user.name", "TerminalX Test"]);
    fs.writeFileSync(path.join(repoDir, "src", "index.ts"), "export const value = 1;\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "initial"]);
    git(repoDir, ["checkout", "-b", "feature/sample-change"]);
    fs.writeFileSync(path.join(repoDir, "src", "index.ts"), "export const value = 2;\n");
    fs.writeFileSync(path.join(repoDir, "added.ts"), "export const added = true;\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "feature change"]);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.TERMINUS_ROOT;
    delete process.env.TERMINALX_AUTH_MODE;
  });

  it("returns the structured diff for two refs", async () => {
    const { POST } = await loadDiffsRoute();
    const res = await POST(
      mockPost({ repoPath: repoDir, base: "main", head: "feature/sample-change" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const paths = body.files.map((f: { path: string }) => f.path).sort();
    expect(paths).toEqual(["added.ts", "src/index.ts"]);
    const modified = body.files.find((f: { path: string }) => f.path === "src/index.ts");
    expect(modified.status).toBe("modified");
    expect(modified.hunks.length).toBeGreaterThanOrEqual(1);
    expect(body.summary.filesChanged).toBe(2);
    expect(body.request.base).toBe("main");
    expect(body.request.head).toBe("feature/sample-change");
  });

  it("400s on a missing repoPath", async () => {
    const { POST } = await loadDiffsRoute();
    const res = await POST(mockPost({ base: "main", head: "feature/sample-change" }));
    expect(res.status).toBe(400);
  });

  it("400s on a flag-like ref", async () => {
    const { POST } = await loadDiffsRoute();
    const res = await POST(mockPost({ repoPath: repoDir, head: "--output=x" }));
    expect(res.status).toBe(400);
  });

  it("403s when repoPath escapes TERMINUS_ROOT", async () => {
    const { POST } = await loadDiffsRoute();
    const outside = fs.realpathSync(os.tmpdir());
    const res = await POST(mockPost({ repoPath: outside, base: "main", head: "HEAD" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Access denied");
  });

  it("resolves the base via merge-base when omitted", async () => {
    const { POST } = await loadDiffsRoute();
    const res = await POST(mockPost({ repoPath: repoDir, head: "feature/sample-change" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.filesChanged).toBe(2);
  });
});

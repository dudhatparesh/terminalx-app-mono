import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Drive the routes' auth gate without touching GitHub. resolveRepoBinding is
// mocked so no git/network runs; getMeta is mocked to control worktree presence.
vi.mock("@/lib/ai-sessions", () => ({
  getMeta: vi.fn(),
}));
vi.mock("@/lib/pr-review/repo-binding", () => ({
  resolveRepoBinding: vi.fn(async () => null),
  getGitHubApiForRepo: vi.fn(),
  // Mirror the real helper: a worktree-backed session yields its repo+branch;
  // a session without a worktree (and no resolvable cwd git repo here) yields null.
  resolveSessionRepo: vi.fn((meta?: { worktree?: { repoRoot: string; branch: string } }) =>
    meta?.worktree ? { repoRoot: meta.worktree.repoRoot, headBranch: meta.worktree.branch } : null
  ),
}));

import { getMeta } from "@/lib/ai-sessions";
import { resolveRepoBinding } from "@/lib/pr-review/repo-binding";

const getMetaMock = getMeta as unknown as ReturnType<typeof vi.fn>;
const bindingMock = resolveRepoBinding as unknown as ReturnType<typeof vi.fn>;

function makeReq(
  headers: Record<string, string> = {},
  jsonBody?: unknown
): { req: unknown; ctx: { params: Promise<{ name: string }> } } {
  return {
    req: {
      headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
      json: async () => jsonBody ?? {},
    } as never,
    ctx: { params: Promise.resolve({ name: "alice-feature" }) },
  };
}

function withWorktree() {
  getMetaMock.mockReturnValue({
    name: "alice-feature",
    kind: "bash",
    createdAt: new Date().toISOString(),
    worktree: { repoRoot: "/tmp/repo", path: "/tmp/wt", branch: "feature/x" },
  });
}

describe("PR-review routes — auth gate (§6 / §9: 403, NEVER 401)", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-pr-routes-"));
    process.chdir(tmpDir);
    process.env.TERMINALX_AUTH_MODE = "local";
    getMetaMock.mockReset();
    bindingMock.mockReset();
    bindingMock.mockResolvedValue(null);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.TERMINALX_AUTH_MODE;
  });

  it("GET /review 403s an unidentified caller in multi-user mode (not 401)", async () => {
    const { GET } = await import("@/app/api/sessions/[name]/review/route");
    const { req, ctx } = makeReq();
    const res = await GET(req as never, ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Access denied");
  });

  it("GET /review 403s a non-admin reaching another user's session", async () => {
    const { GET } = await import("@/app/api/sessions/[name]/review/route");
    const { req, ctx } = makeReq({ "x-username": "bob", "x-user-role": "user" });
    const res = await GET(req as never, ctx);
    expect(res.status).toBe(403);
  });

  it("GET /review/drafts 403s an unidentified caller", async () => {
    const { GET } = await import("@/app/api/sessions/[name]/review/drafts/route");
    const { req, ctx } = makeReq();
    const res = await GET(req as never, ctx);
    expect(res.status).toBe(403);
  });

  it("POST /pr 403s an unidentified caller", async () => {
    const { POST } = await import("@/app/api/sessions/[name]/pr/route");
    const { req, ctx } = makeReq({}, { title: "x", base: "main" });
    const res = await POST(req as never, ctx);
    expect(res.status).toBe(403);
  });

  it("POST /review/submit 403s an unidentified caller", async () => {
    const { POST } = await import("@/app/api/sessions/[name]/review/submit/route");
    const { req, ctx } = makeReq({}, { event: "COMMENT", body: "" });
    const res = await POST(req as never, ctx);
    expect(res.status).toBe(403);
  });

  it("POST /review/resolve 403s an unidentified caller", async () => {
    const { POST } = await import("@/app/api/sessions/[name]/review/resolve/route");
    const { req, ctx } = makeReq({}, { key: "a::1::RIGHT", resolved: true });
    const res = await POST(req as never, ctx);
    expect(res.status).toBe(403);
  });
});

describe("PR-review routes — admin/local pass-through behavior", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-pr-routes-ok-"));
    process.chdir(tmpDir);
    process.env.TERMINALX_AUTH_MODE = "none"; // pass-through
    getMetaMock.mockReset();
    bindingMock.mockReset();
    bindingMock.mockResolvedValue(null);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.TERMINALX_AUTH_MODE;
  });

  it("GET /review 404s a session with no git repository", async () => {
    getMetaMock.mockReturnValue({ name: "alice-feature", kind: "bash", createdAt: "" });
    const { GET } = await import("@/app/api/sessions/[name]/review/route");
    const { req, ctx } = makeReq();
    const res = await GET(req as never, ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Session has no git repository");
  });

  it("GET /review returns the unbound Create-PR payload when the repo isn't bound", async () => {
    withWorktree();
    bindingMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/sessions/[name]/review/route");
    const { req, ctx } = makeReq();
    const res = await GET(req as never, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pr).toBeNull();
    expect(body.unbound).toBe(true);
    expect(body.headBranch).toBe("feature/x");
  });

  it("POST /pr rejects head === base BEFORE any network call", async () => {
    withWorktree();
    const { POST } = await import("@/app/api/sessions/[name]/pr/route");
    const { req, ctx } = makeReq({}, { title: "X", base: "feature/x", head: "feature/x" });
    const res = await POST(req as never, ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/differ/i);
    // resolveRepoBinding must NOT have been consulted — we short-circuit on validation.
    expect(bindingMock).not.toHaveBeenCalled();
  });

  it("POST /pr rejects a missing title", async () => {
    withWorktree();
    const { POST } = await import("@/app/api/sessions/[name]/pr/route");
    const { req, ctx } = makeReq({}, { base: "main" });
    const res = await POST(req as never, ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/title/i);
  });

  it("PUT /review/drafts/[...id] rejects a draft with no body", async () => {
    const { PUT } = await import("@/app/api/sessions/[name]/review/drafts/[...id]/route");
    const req = {
      headers: { get: () => null },
      json: async () => ({ path: "a.ts", line: 3, body: "  " }),
    } as never;
    const ctx = { params: Promise.resolve({ name: "alice-feature", id: ["d1"] }) };
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
  });

  it("PUT /review/drafts/[...id] persists a valid draft", async () => {
    const { PUT } = await import("@/app/api/sessions/[name]/review/drafts/[...id]/route");
    const req = {
      headers: { get: () => null },
      json: async () => ({ path: "a.ts", line: 3, side: "RIGHT", body: "fix this" }),
    } as never;
    const ctx = { params: Promise.resolve({ name: "alice-feature", id: ["d1"] }) };
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("d1");
    expect(body.body).toBe("fix this");
  });

  it("PUT /review/drafts/[...id] reassembles an id containing slashes", async () => {
    const { PUT } = await import("@/app/api/sessions/[name]/review/drafts/[...id]/route");
    const req = {
      headers: { get: () => null },
      json: async () => ({ path: "src/index.ts", line: 3, side: "RIGHT", body: "guard here" }),
    } as never;
    // A real draft id embeds the file path, e.g. draft:<session>:src/index.ts:3:n.
    const ctx = {
      params: Promise.resolve({
        name: "alice-feature",
        id: ["draft:alice-feature:src", "index.ts:3:n"],
      }),
    };
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("draft:alice-feature:src/index.ts:3:n");
  });
});

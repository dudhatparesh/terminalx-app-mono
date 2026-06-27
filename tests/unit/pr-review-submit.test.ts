import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Mock the GitHub-facing seams so submit logic is exercised in isolation:
//  - getMeta gives a worktree session
//  - resolveRepoBinding returns a binding
//  - getGitHubApiForRepo returns a fake API recording the calls
//  - resolvePRForSession returns a live PR
vi.mock("@/lib/ai-sessions", () => ({ getMeta: vi.fn() }));
vi.mock("@/lib/pr-review/repo-binding", () => ({
  resolveRepoBinding: vi.fn(),
  getGitHubApiForRepo: vi.fn(),
}));
vi.mock("@/lib/github/session-link", () => ({ resolvePRForSession: vi.fn() }));

import { getMeta } from "@/lib/ai-sessions";
import { getGitHubApiForRepo, resolveRepoBinding } from "@/lib/pr-review/repo-binding";
import { resolvePRForSession } from "@/lib/github/session-link";
import { upsertDraft } from "@/lib/pr-review/drafts";

const getMetaMock = getMeta as unknown as ReturnType<typeof vi.fn>;
const bindingMock = resolveRepoBinding as unknown as ReturnType<typeof vi.fn>;
const apiMock = getGitHubApiForRepo as unknown as ReturnType<typeof vi.fn>;
const linkMock = resolvePRForSession as unknown as ReturnType<typeof vi.fn>;

function fakeApi() {
  const createReview = vi.fn(async (..._args: unknown[]): Promise<{ id: number }> => ({ id: 1 }));
  const replyToReviewComment = vi.fn(
    async (..._args: unknown[]): Promise<{ id: number }> => ({ id: 2 })
  );
  const getReviewSummary = vi.fn(async (..._args: unknown[]) => ({
    prNumber: 1,
    decision: "approved",
    reviews: [],
    threads: [],
  }));
  return {
    reviews: { createReview, replyToReviewComment },
    reviewAggregate: { getReviewSummary },
    _calls: { createReview, replyToReviewComment, getReviewSummary },
  };
}

function submitReq(body: unknown) {
  return {
    req: { headers: { get: () => null }, json: async () => body } as never,
    ctx: { params: Promise.resolve({ name: "alice-feature" }) },
  };
}

describe("POST /review/submit (§4.4 / §6.4)", () => {
  let tmpDir: string;
  let originalCwd: string;
  let api: ReturnType<typeof fakeApi>;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-pr-submit-"));
    process.chdir(tmpDir);
    process.env.TERMINALX_AUTH_MODE = "none";

    getMetaMock.mockReset();
    bindingMock.mockReset();
    apiMock.mockReset();
    linkMock.mockReset();

    getMetaMock.mockReturnValue({
      name: "alice-feature",
      kind: "bash",
      createdAt: "",
      worktree: { repoRoot: "/tmp/repo", path: "/tmp/wt", branch: "feature/x" },
    });
    bindingMock.mockResolvedValue({
      owner: "acme",
      repo: "widgets",
      integrationId: "int-1",
      defaultBranch: "main",
    });
    linkMock.mockResolvedValue({
      sessionName: "alice-feature",
      branch: "feature/x",
      pr: { number: 1, htmlUrl: "", title: "", status: "open" },
    });
    api = fakeApi();
    apiMock.mockReturnValue(api);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.TERMINALX_AUTH_MODE;
  });

  it("maps APPROVE and batches new-thread drafts into ONE createReview", async () => {
    await upsertDraft("alice-feature", {
      id: "n1",
      sessionName: "alice-feature",
      path: "src/a.ts",
      line: 12,
      side: "RIGHT",
      body: "comment A",
      createdAt: "",
      updatedAt: "",
    });
    const { POST } = await import("@/app/api/sessions/[name]/review/submit/route");
    const { req, ctx } = submitReq({ event: "APPROVE", body: "overall lgtm" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    expect(api._calls.createReview).toHaveBeenCalledTimes(1);
    const arg = api._calls.createReview.mock.calls[0]![3] as {
      event: string;
      body: string;
      comments: unknown[];
    };
    expect(arg.event).toBe("APPROVE");
    expect(arg.body).toBe("overall lgtm");
    expect(arg.comments).toEqual([{ path: "src/a.ts", line: 12, body: "comment A" }]);
    // No replies present.
    expect(api._calls.replyToReviewComment).not.toHaveBeenCalled();
  });

  it("posts reply drafts via replyToReviewComment, not createReview comments", async () => {
    await upsertDraft("alice-feature", {
      id: "r1",
      sessionName: "alice-feature",
      path: "src/a.ts",
      line: 12,
      side: "RIGHT",
      inReplyToId: 901,
      body: "reply body",
      createdAt: "",
      updatedAt: "",
    });
    const { POST } = await import("@/app/api/sessions/[name]/review/submit/route");
    const { req, ctx } = submitReq({ event: "COMMENT", body: "" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    expect(api._calls.replyToReviewComment).toHaveBeenCalledTimes(1);
    const call = api._calls.replyToReviewComment.mock.calls[0]!;
    expect(call[3]).toBe(901); // commentId
    expect(call[4]).toBe("reply body");
  });

  it("clears submitted drafts and refetches the summary on success", async () => {
    await upsertDraft("alice-feature", {
      id: "n1",
      sessionName: "alice-feature",
      path: "a.ts",
      line: 1,
      side: "RIGHT",
      body: "x",
      createdAt: "",
      updatedAt: "",
    });
    const { POST } = await import("@/app/api/sessions/[name]/review/submit/route");
    const { req, ctx } = submitReq({ event: "COMMENT", body: "" });
    const res = await POST(req, ctx);
    const body = await res.json();
    expect(body.submitted).toBe(1);
    expect(api._calls.getReviewSummary).toHaveBeenCalled();
    // The submitted draft is gone from the store.
    const { getSessionDrafts } = await import("@/lib/pr-review/drafts");
    expect(getSessionDrafts("alice-feature")).toHaveLength(0);
  });

  it("404s when the branch has no PR", async () => {
    linkMock.mockResolvedValue({ sessionName: "alice-feature", branch: "feature/x", pr: null });
    const { POST } = await import("@/app/api/sessions/[name]/review/submit/route");
    const { req, ctx } = submitReq({ event: "COMMENT", body: "" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });
});

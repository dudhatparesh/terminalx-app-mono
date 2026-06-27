import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Validate the Create-PR route delegates to the shared GitHubAPI and never
// instantiates a client by hand (§9). validateGitBranchName is the REAL one so we
// also exercise server-side branch validation.
vi.mock("@/lib/ai-sessions", () => ({ getMeta: vi.fn() }));
vi.mock("@/lib/pr-review/repo-binding", () => ({
  resolveRepoBinding: vi.fn(),
  getGitHubApiForRepo: vi.fn(),
  // Mirror the real helper: a worktree-backed session yields its repo+branch.
  resolveSessionRepo: vi.fn((meta?: { worktree?: { repoRoot: string; branch: string } }) =>
    meta?.worktree ? { repoRoot: meta.worktree.repoRoot, headBranch: meta.worktree.branch } : null
  ),
}));

import { getMeta } from "@/lib/ai-sessions";
import { getGitHubApiForRepo, resolveRepoBinding } from "@/lib/pr-review/repo-binding";

const getMetaMock = getMeta as unknown as ReturnType<typeof vi.fn>;
const bindingMock = resolveRepoBinding as unknown as ReturnType<typeof vi.fn>;
const apiMock = getGitHubApiForRepo as unknown as ReturnType<typeof vi.fn>;

function rawPr(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    html_url: "https://github.com/acme/widgets/pull/42",
    title: "Add settings",
    state: "open",
    draft: false,
    merged_at: null,
    head: { ref: "feature/x", sha: "h", repo: null },
    base: { ref: "main", sha: "b", repo: {} },
    changed_files: 1,
    additions: 19,
    deletions: 0,
    ...overrides,
  };
}

function req(body: unknown) {
  return {
    req: { headers: { get: () => null }, json: async () => body } as never,
    ctx: { params: Promise.resolve({ name: "alice-feature" }) },
  };
}

describe("POST /api/sessions/[name]/pr (§5 / §6.3)", () => {
  beforeEach(() => {
    process.env.TERMINALX_AUTH_MODE = "none";
    getMetaMock.mockReset();
    bindingMock.mockReset();
    apiMock.mockReset();
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
  });

  afterEach(() => {
    delete process.env.TERMINALX_AUTH_MODE;
  });

  it("creates the PR via createPullRequest and returns a PullRequestView", async () => {
    const createPullRequest = vi.fn(async (..._a: unknown[]) => rawPr());
    const requestReviewers = vi.fn(async (..._a: unknown[]) => rawPr());
    apiMock.mockReturnValue({
      pulls: { createPullRequest },
      reviews: { requestReviewers },
    });

    const { POST } = await import("@/app/api/sessions/[name]/pr/route");
    const { req: r, ctx } = req({
      title: "Add settings",
      body: "desc",
      base: "main",
      head: "feature/x",
      draft: false,
    });
    const res = await POST(r, ctx);
    expect(res.status).toBe(201);
    const view = await res.json();
    expect(view.number).toBe(42);
    expect(view.status).toBe("open");

    expect(createPullRequest).toHaveBeenCalledTimes(1);
    const [owner, repo, input] = createPullRequest.mock.calls[0]!;
    expect(owner).toBe("acme");
    expect(repo).toBe("widgets");
    expect(input).toMatchObject({ title: "Add settings", head: "feature/x", base: "main" });
    // No reviewers passed → requestReviewers not invoked.
    expect(requestReviewers).not.toHaveBeenCalled();
  });

  it("requests reviewers separately when provided", async () => {
    const createPullRequest = vi.fn(async (..._a: unknown[]) => rawPr());
    const requestReviewers = vi.fn(async (..._a: unknown[]) => rawPr());
    apiMock.mockReturnValue({
      pulls: { createPullRequest },
      reviews: { requestReviewers },
    });

    const { POST } = await import("@/app/api/sessions/[name]/pr/route");
    const { req: r, ctx } = req({
      title: "Add settings",
      base: "main",
      head: "feature/x",
      reviewers: ["octocat", "monalisa"],
    });
    await POST(r, ctx);
    expect(requestReviewers).toHaveBeenCalledTimes(1);
    expect(requestReviewers.mock.calls[0]![3]).toEqual({ reviewers: ["octocat", "monalisa"] });
  });

  it("rejects an invalid branch name without calling GitHub", async () => {
    const createPullRequest = vi.fn();
    apiMock.mockReturnValue({ pulls: { createPullRequest }, reviews: {} });
    const { POST } = await import("@/app/api/sessions/[name]/pr/route");
    const { req: r, ctx } = req({ title: "X", base: "bad branch name!!", head: "feature/x" });
    const res = await POST(r, ctx);
    expect(res.status).toBe(400);
    expect(createPullRequest).not.toHaveBeenCalled();
  });
});

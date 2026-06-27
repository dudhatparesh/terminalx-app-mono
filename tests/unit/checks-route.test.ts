// GET /api/checks route tests (issue #6, §3). Deps are ESM-mocked with vi.mock so
// no real git/GitHub I/O runs. Verifies validation, scoping (403, never 401),
// informational 200 states (no-repo / no-auth), success + caching, and the
// degraded 429/502 + stale-serve paths.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChecksView } from "@/types/checks";
import { GitHubErrorCode } from "@/lib/github/types";

// ── Mocks ────────────────────────────────────────────────────────────────────
const getMeta = vi.fn();
const getGitDirectoryInfo = vi.fn();
const buildChecksView = vi.fn();
const hasGitHubToken = vi.fn();

vi.mock("@/lib/ai-sessions", () => ({
  getMeta: (...a: unknown[]) => getMeta(...a),
}));
vi.mock("@/lib/git-worktree", () => ({
  getGitDirectoryInfo: (...a: unknown[]) => getGitDirectoryInfo(...a),
}));
// Keep the real pure helper `emptyView`; only stub the I/O functions.
vi.mock("@/lib/checks/aggregate", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/checks/aggregate")>("@/lib/checks/aggregate");
  return {
    ...actual,
    buildChecksView: (...a: unknown[]) => buildChecksView(...a),
    hasGitHubToken: (...a: unknown[]) => hasGitHubToken(...a),
  };
});

async function loadRoute() {
  return await import("@/app/api/checks/route");
}

function req(query: Record<string, string>, headers: Record<string, string> = {}) {
  const qs = new URLSearchParams(query).toString();
  return {
    url: `http://localhost/api/checks${qs ? `?${qs}` : ""}`,
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
  } as never;
}

function fullView(over: Partial<ChecksView> = {}): ChecksView {
  return {
    sessionName: "s1",
    repo: { owner: "acme", name: "widgets" },
    branch: "feat",
    headSha: "abc1234",
    pr: null,
    rollup: "success",
    counts: { success: 1, failure: 0, pending: 0, neutral: 0, skipped: 0 },
    items: [],
    fetchedAt: "2026-06-25T14:24:00Z",
    cached: false,
    stale: false,
    cachedUntil: "2026-06-25T14:24:30Z",
    ...over,
  };
}

describe("GET /api/checks", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Default to single-user mode (no scoping) so the happy paths skip the gate;
    // the explicit scoping tests opt into "local" mode themselves.
    process.env.TERMINALX_AUTH_MODE = "none";
    // Reset module-level cache between tests.
    const { checksCache } = await import("@/lib/checks/cache");
    checksCache.clear();
    // Default happy path: a repo session with a token.
    getMeta.mockReturnValue({ name: "s1", cwd: "/repo" });
    getGitDirectoryInfo.mockReturnValue({ isRepo: true, root: "/repo", branch: "feat" });
    hasGitHubToken.mockReturnValue(true);
  });
  afterEach(() => {
    delete process.env.TERMINALX_AUTH_MODE;
  });

  it("400s when sessionName is missing", async () => {
    const { GET } = await loadRoute();
    const res = await GET(req({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ status: "error", code: "INVALID_REQUEST" });
  });

  it("403s (never 401) when a non-admin reads another user's session", async () => {
    process.env.TERMINALX_AUTH_MODE = "local";
    const { GET } = await loadRoute();
    const res = await GET(
      req({ sessionName: "bob-secret" }, { "x-username": "alice", "x-user-role": "user" })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(buildChecksView).not.toHaveBeenCalled();
  });

  it("allows a non-admin to read their own session", async () => {
    process.env.TERMINALX_AUTH_MODE = "local";
    buildChecksView.mockResolvedValue(fullView({ sessionName: "alice-feat" }));
    const { GET } = await loadRoute();
    const res = await GET(
      req({ sessionName: "alice-feat" }, { "x-username": "alice", "x-user-role": "user" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.data.rollup).toBe("success");
  });

  it("returns informational 200 no-repo when the session dir is not a git repo", async () => {
    getGitDirectoryInfo.mockReturnValue({ isRepo: false });
    const { GET } = await loadRoute();
    const res = await GET(req({ sessionName: "s1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.data.rollup).toBe("no-repo");
    expect(buildChecksView).not.toHaveBeenCalled();
  });

  it("returns informational 200 no-repo (zero API calls) when session has no dir at all", async () => {
    getMeta.mockReturnValue({ name: "s1" }); // no cwd, no worktree
    const { GET } = await loadRoute();
    const res = await GET(req({ sessionName: "s1" }));
    expect(res.status).toBe(200);
    expect(getGitDirectoryInfo).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.data.rollup).toBe("no-repo");
  });

  it("returns informational 200 error/no-auth (NOT 401) when no token configured", async () => {
    hasGitHubToken.mockReturnValue(false);
    const { GET } = await loadRoute();
    const res = await GET(req({ sessionName: "s1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.data.rollup).toBe("error");
    expect(body.data.reason).toBe("no-auth");
    expect(buildChecksView).not.toHaveBeenCalled();
  });

  it("returns a success view and caches it", async () => {
    buildChecksView.mockResolvedValue(fullView({ rollup: "pending" }));
    const { GET } = await loadRoute();
    const res = await GET(req({ sessionName: "s1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rollup).toBe("pending");
    expect(buildChecksView).toHaveBeenCalledTimes(1);

    // Second non-forced call hits cache → buildChecksView not called again.
    const res2 = await GET(req({ sessionName: "s1" }));
    const body2 = await res2.json();
    expect(body2.data.cached).toBe(true);
    expect(buildChecksView).toHaveBeenCalledTimes(1);
  });

  it("force=true bypasses the soft cache and refetches", async () => {
    buildChecksView.mockResolvedValue(fullView());
    const { GET } = await loadRoute();
    await GET(req({ sessionName: "s1" })); // populate cache
    expect(buildChecksView).toHaveBeenCalledTimes(1);
    await GET(req({ sessionName: "s1", force: "true" }));
    expect(buildChecksView).toHaveBeenCalledTimes(2);
  });

  it("429 + stale cache on rate-limit after a prior good fetch", async () => {
    const { GET } = await loadRoute();
    buildChecksView.mockResolvedValueOnce(fullView({ rollup: "success" }));
    await GET(req({ sessionName: "s1" })); // seed cache

    buildChecksView.mockRejectedValueOnce({
      code: GitHubErrorCode.RATE_LIMIT_EXCEEDED,
      message: "rate limited",
      statusCode: 403,
      retryAfter: 1800,
    });
    const res = await GET(req({ sessionName: "s1", force: "true" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.retryAfter).toBe(1800);
    expect(body.cached).toBe(true);
    expect(body.data.stale).toBe(true);
    expect(body.data.rollup).toBe("success");
  });

  it("502 + stale cache on upstream/network failure", async () => {
    const { GET } = await loadRoute();
    buildChecksView.mockResolvedValueOnce(fullView({ rollup: "success" }));
    await GET(req({ sessionName: "s1" })); // seed cache

    buildChecksView.mockRejectedValueOnce({
      code: GitHubErrorCode.SERVER_ERROR,
      message: "boom",
      statusCode: 500,
    });
    const res = await GET(req({ sessionName: "s1", force: "true" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("UPSTREAM_ERROR");
    expect(body.cached).toBe(true);
    expect(body.data.stale).toBe(true);
  });

  it("502 with no cached view when the very first fetch fails", async () => {
    const { GET } = await loadRoute();
    buildChecksView.mockRejectedValueOnce(new Error("network down"));
    const res = await GET(req({ sessionName: "s1" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("UPSTREAM_ERROR");
    expect(body.cached).toBe(false);
    expect(body.data).toBeUndefined();
  });
});

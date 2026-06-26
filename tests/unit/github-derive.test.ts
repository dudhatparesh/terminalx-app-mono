import { describe, it, expect } from "vitest";
import {
  buildChecksSummary,
  buildReviewSummary,
  calculateBackoff,
  derivePullRequestStatus,
  deriveReviewDecision,
  DEFAULT_RETRY_POLICY,
  normalizeCheckRunState,
  shouldRetry,
  toPullRequestView,
} from "@/lib/github/derive";
import { resolvePRForSession } from "@/lib/github/session-link";
import {
  CheckConclusion,
  CheckRun,
  CheckStatus,
  CommitStatus,
  GitHubErrorCode,
  PullRequest,
  Review,
} from "@/lib/github/types";
import type { GitHubAPI } from "@/lib/github/api";
import type { SessionMeta } from "@/lib/ai-sessions";

function pr(overrides: Partial<PullRequest>): PullRequest {
  return {
    id: 1,
    number: 7,
    title: "t",
    body: "",
    state: "open",
    draft: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    merged_at: null,
    closed_at: null,
    head: { ref: "feat", sha: "headsha", repo: null },
    base: { ref: "main", sha: "basesha", repo: {} as PullRequest["base"]["repo"] },
    user: { login: "a", id: 1, avatar_url: "", url: "", type: "User" },
    assignees: [],
    requested_reviewers: [],
    labels: [],
    comments: 0,
    review_comments: 0,
    commits: 1,
    additions: 19,
    deletions: 2,
    changed_files: 1,
    html_url: "https://github.com/acme/widgets/pull/7",
    url: "",
    ...overrides,
  };
}

describe("derivePullRequestStatus (§2.3a)", () => {
  it("merged wins over closed", () => {
    expect(
      derivePullRequestStatus(pr({ state: "closed", merged_at: "2026-01-02T00:00:00Z" }))
    ).toBe("merged");
    expect(derivePullRequestStatus(pr({ state: "closed", merged: true }))).toBe("merged");
  });
  it("closed when state closed and not merged", () => {
    expect(derivePullRequestStatus(pr({ state: "closed" }))).toBe("closed");
  });
  it("draft only applies to open PRs", () => {
    expect(derivePullRequestStatus(pr({ draft: true }))).toBe("draft");
    expect(derivePullRequestStatus(pr({ draft: true, state: "closed" }))).toBe("closed");
  });
  it("open otherwise", () => {
    expect(derivePullRequestStatus(pr({}))).toBe("open");
  });
});

describe("toPullRequestView (§2.3)", () => {
  it("projects the UI shape with htmlUrl/status field names", () => {
    const v = toPullRequestView(pr({}));
    expect(v).toMatchObject({
      number: 7,
      htmlUrl: "https://github.com/acme/widgets/pull/7",
      status: "open",
      headBranch: "feat",
      headSha: "headsha",
      baseBranch: "main",
      changedFiles: 1,
      additions: 19,
    });
  });
});

describe("normalizeCheckRunState (§2.4)", () => {
  const run = (status: CheckStatus, conclusion: CheckConclusion | null): CheckRun => ({
    id: 1,
    name: "x",
    head_sha: "s",
    status,
    conclusion,
    started_at: "",
    completed_at: null,
    html_url: "",
  });
  it("non-completed => pending", () => {
    expect(normalizeCheckRunState(run(CheckStatus.IN_PROGRESS, null))).toBe("pending");
  });
  it("cancelled/action_required fold into failure", () => {
    expect(normalizeCheckRunState(run(CheckStatus.COMPLETED, CheckConclusion.CANCELLED))).toBe(
      "failure"
    );
    expect(
      normalizeCheckRunState(run(CheckStatus.COMPLETED, CheckConclusion.ACTION_REQUIRED))
    ).toBe("failure");
  });
  it("skipped is its own row state", () => {
    expect(normalizeCheckRunState(run(CheckStatus.COMPLETED, CheckConclusion.SKIPPED))).toBe(
      "skipped"
    );
  });
});

describe("buildChecksSummary rollup (§2.4)", () => {
  const completedRun = (name: string, conclusion: CheckConclusion): CheckRun => ({
    id: Math.random(),
    name,
    head_sha: "s",
    status: CheckStatus.COMPLETED,
    conclusion,
    started_at: "",
    completed_at: "",
    html_url: "",
  });

  it("none when there are no checks", () => {
    const sum = buildChecksSummary("s", [], []);
    expect(sum.overall).toBe("none");
    expect(sum.total).toBe(0);
  });
  it("failure dominates", () => {
    const sum = buildChecksSummary(
      "s",
      [completedRun("a", CheckConclusion.SUCCESS), completedRun("b", CheckConclusion.FAILURE)],
      []
    );
    expect(sum.overall).toBe("failure");
    expect(sum.failing).toBe(1);
    expect(sum.passing).toBe(1);
  });
  it("a check run wins over a legacy status of the same name", () => {
    const statuses: CommitStatus[] = [
      { state: "failure", description: "", context: "build", created_at: "", url: "" },
    ];
    const sum = buildChecksSummary("s", [completedRun("build", CheckConclusion.SUCCESS)], statuses);
    expect(sum.total).toBe(1);
    expect(sum.overall).toBe("success");
  });
});

describe("deriveReviewDecision (§2.5)", () => {
  const review = (id: number, userId: number, state: Review["state"], at: string): Review => ({
    id,
    user: { login: "u" + userId, id: userId, avatar_url: "", url: "", type: "User" },
    body: "",
    state,
    submitted_at: at,
    commit_id: "c",
    html_url: "",
  });

  it("changes_requested dominates", () => {
    const d = deriveReviewDecision([
      review(1, 1, "APPROVED", "2026-01-01T00:00:00Z"),
      review(2, 2, "CHANGES_REQUESTED", "2026-01-01T00:00:00Z"),
    ]);
    expect(d).toBe("changes_requested");
  });
  it("latest review per user wins", () => {
    const d = deriveReviewDecision([
      review(1, 1, "CHANGES_REQUESTED", "2026-01-01T00:00:00Z"),
      review(2, 1, "APPROVED", "2026-01-02T00:00:00Z"),
    ]);
    expect(d).toBe("approved");
  });
  it("empty => review_required", () => {
    expect(deriveReviewDecision([])).toBe("review_required");
  });
});

describe("buildReviewSummary threads", () => {
  it("groups replies under their root comment", () => {
    const summary = buildReviewSummary(
      7,
      [],
      [
        {
          id: 100,
          pull_request_review_id: 1,
          user: { login: "a", id: 1, avatar_url: "", url: "", type: "User" },
          body: "root",
          path: "src/x.ts",
          line: 10,
          original_line: 10,
          start_line: null,
          side: "RIGHT",
          commit_id: "c",
          diff_hunk: "",
          in_reply_to_id: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "",
          html_url: "",
        },
        {
          id: 101,
          pull_request_review_id: 1,
          user: { login: "b", id: 2, avatar_url: "", url: "", type: "User" },
          body: "reply",
          path: "src/x.ts",
          line: 10,
          original_line: 10,
          start_line: null,
          side: "RIGHT",
          commit_id: "c",
          diff_hunk: "",
          in_reply_to_id: 100,
          created_at: "2026-01-01T01:00:00Z",
          updated_at: "",
          html_url: "",
        },
      ]
    );
    expect(summary.threads).toHaveLength(1);
    expect(summary.threads[0]?.comments.map((c) => c.id)).toEqual([100, 101]);
  });
});

describe("retry strategy (§3.3)", () => {
  it("does not retry non-transient errors", () => {
    expect(shouldRetry({ code: GitHubErrorCode.NOT_FOUND }, 1)).toBe(false);
    expect(shouldRetry({ code: GitHubErrorCode.VALIDATION_ERROR }, 1)).toBe(false);
    expect(shouldRetry({ code: GitHubErrorCode.AUTHENTICATION_FAILED }, 1)).toBe(false);
  });
  it("retries transient errors below the attempt cap", () => {
    expect(shouldRetry({ code: GitHubErrorCode.SERVICE_UNAVAILABLE }, 1)).toBe(true);
    expect(shouldRetry({ code: GitHubErrorCode.RATE_LIMIT_EXCEEDED }, 2)).toBe(true);
    expect(shouldRetry({ code: GitHubErrorCode.TIMEOUT }, 3)).toBe(false); // cap reached
  });
  it("backoff grows but never exceeds maxDelay", () => {
    for (let attempt = 1; attempt <= 8; attempt++) {
      const b = calculateBackoff(attempt, DEFAULT_RETRY_POLICY);
      expect(b).toBeGreaterThanOrEqual(0);
      // max + max*jitterFraction is the absolute ceiling
      expect(b).toBeLessThanOrEqual(
        DEFAULT_RETRY_POLICY.maxDelayMs * (1 + DEFAULT_RETRY_POLICY.jitterFraction)
      );
    }
  });
});

describe("resolvePRForSession (§2.7)", () => {
  const session = (branch?: string): SessionMeta => ({
    name: "alice-feat",
    kind: "claude",
    createdAt: "2026-01-01T00:00:00Z",
    worktree: branch ? { repoRoot: "/r", path: "/r/.wt/feat", branch } : undefined,
  });

  it("returns pr:null when the session has no worktree branch", async () => {
    const api = {
      pulls: { listPullRequests: async () => [] },
    } as unknown as GitHubAPI;
    const link = await resolvePRForSession(api, "acme", "widgets", session());
    expect(link.pr).toBeNull();
    expect(link.branch).toBe("");
  });

  it("queries head=owner:branch and returns the newest matching PR view", async () => {
    let capturedHead = "";
    const api = {
      pulls: {
        listPullRequests: async (_o: string, _r: string, opts?: { head?: string }) => {
          capturedHead = opts?.head ?? "";
          return [
            pr({ number: 5, created_at: "2026-01-01T00:00:00Z" }),
            pr({ number: 9, created_at: "2026-01-05T00:00:00Z" }),
          ];
        },
      },
    } as unknown as GitHubAPI;
    const link = await resolvePRForSession(api, "acme", "widgets", session("feat"));
    expect(capturedHead).toBe("acme:feat");
    expect(link.pr?.number).toBe(9); // newest by created_at
  });
});

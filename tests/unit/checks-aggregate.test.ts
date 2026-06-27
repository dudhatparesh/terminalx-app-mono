// Pure aggregation/normalization + cache + presentation unit tests for the Checks
// tab (issue #6). No I/O — only the pure helpers exported from src/lib/checks and
// src/components/review/checks/presentation.
import { describe, it, expect } from "vitest";
import {
  checkRunState,
  commitStatusState,
  countStates,
  emptyView,
  normalizeItems,
  parseGitHubRemote,
  prToChecksPr,
  rollupFromCounts,
} from "@/lib/checks/aggregate";
import { ChecksCache, cacheKeyFor, HARD_TTL_MS, SOFT_TTL_MS } from "@/lib/checks/cache";
import {
  formatDuration,
  rollupBadgeGlyph,
  shortSha,
  summarizeCounts,
} from "@/components/review/checks/presentation";
import { CheckConclusion, CheckStatus } from "@/lib/github/types";
import type { CheckRun, CommitStatus, PullRequest } from "@/lib/github/types";
import type { ChecksView } from "@/types/checks";

function run(overrides: Partial<CheckRun>): CheckRun {
  return {
    id: 1,
    name: "build",
    head_sha: "sha",
    status: CheckStatus.COMPLETED,
    conclusion: CheckConclusion.SUCCESS,
    started_at: "2026-06-25T14:20:00Z",
    completed_at: "2026-06-25T14:23:10Z",
    html_url: "https://github.com/o/r/runs/1",
    app: { id: 1, name: "GitHub Actions" },
    ...overrides,
  };
}

function status(overrides: Partial<CommitStatus>): CommitStatus {
  return {
    state: "success",
    description: "ok",
    context: "ci/circleci",
    created_at: "2026-06-25T14:20:00Z",
    url: "https://github.com/o/r/status",
    ...overrides,
  };
}

describe("parseGitHubRemote", () => {
  it("parses https github URLs (with and without .git)", () => {
    expect(parseGitHubRemote("https://github.com/acme/widgets.git")).toEqual({
      owner: "acme",
      name: "widgets",
    });
    expect(parseGitHubRemote("https://github.com/acme/widgets")).toEqual({
      owner: "acme",
      name: "widgets",
    });
  });

  it("parses ssh github URLs", () => {
    expect(parseGitHubRemote("git@github.com:acme/widgets.git")).toEqual({
      owner: "acme",
      name: "widgets",
    });
    expect(parseGitHubRemote("ssh://git@github.com/acme/widgets")).toEqual({
      owner: "acme",
      name: "widgets",
    });
  });

  it("returns null for non-GitHub remotes (e.g. self-hosted GitLab)", () => {
    expect(parseGitHubRemote("https://gitlab.com/acme/widgets.git")).toBeNull();
    expect(parseGitHubRemote("git@gitlab.example.com:acme/widgets.git")).toBeNull();
    expect(parseGitHubRemote("")).toBeNull();
  });

  it("parses GitHub Enterprise hostnames", () => {
    expect(parseGitHubRemote("https://github.enterprise.io/acme/widgets")).toEqual({
      owner: "acme",
      name: "widgets",
    });
  });
});

describe("checkRunState (§2.3 conclusion mapping)", () => {
  it("pending while not completed", () => {
    expect(checkRunState(run({ status: CheckStatus.IN_PROGRESS, conclusion: null }))).toBe(
      "pending"
    );
    expect(checkRunState(run({ status: CheckStatus.QUEUED, conclusion: null }))).toBe("pending");
  });
  it("maps conclusions", () => {
    expect(checkRunState(run({ conclusion: CheckConclusion.SUCCESS }))).toBe("success");
    expect(checkRunState(run({ conclusion: CheckConclusion.NEUTRAL }))).toBe("neutral");
    expect(checkRunState(run({ conclusion: CheckConclusion.SKIPPED }))).toBe("skipped");
    expect(checkRunState(run({ conclusion: CheckConclusion.FAILURE }))).toBe("failure");
    expect(checkRunState(run({ conclusion: CheckConclusion.TIMED_OUT }))).toBe("failure");
    expect(checkRunState(run({ conclusion: CheckConclusion.ACTION_REQUIRED }))).toBe("failure");
    expect(checkRunState(run({ conclusion: CheckConclusion.CANCELLED }))).toBe("failure");
  });
});

describe("commitStatusState", () => {
  it("maps legacy states", () => {
    expect(commitStatusState("success")).toBe("success");
    expect(commitStatusState("pending")).toBe("pending");
    expect(commitStatusState("failure")).toBe("failure");
    expect(commitStatusState("error")).toBe("failure");
  });
});

describe("normalizeItems (dedupe, §2.3)", () => {
  it("normalizes check-runs into stable rows with duration", () => {
    const items = normalizeItems([run({ id: 99, name: "build" })], []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "check-run:99",
      kind: "check-run",
      name: "build",
      state: "success",
      source: "GitHub Actions",
      detailsUrl: "https://github.com/o/r/runs/1",
      durationMs: 190000,
    });
  });

  it("includes legacy statuses with no matching check-run", () => {
    const items = normalizeItems([], [status({ context: "ci/circleci" })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "status", name: "ci/circleci", state: "success" });
  });

  it("dedupes by name, preferring the check-run over a same-named status", () => {
    const items = normalizeItems(
      [run({ id: 5, name: "lint", conclusion: CheckConclusion.SUCCESS })],
      [status({ context: "lint", state: "failure" })]
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("check-run");
    expect(items[0]?.state).toBe("success");
  });

  it("leaves durationMs null while a run is pending", () => {
    const items = normalizeItems(
      [run({ status: CheckStatus.IN_PROGRESS, conclusion: null, completed_at: null })],
      []
    );
    expect(items[0]?.durationMs).toBeNull();
  });
});

describe("countStates + rollupFromCounts (precedence)", () => {
  it("counts each state", () => {
    const items = normalizeItems(
      [
        run({ id: 1, name: "a", conclusion: CheckConclusion.SUCCESS }),
        run({ id: 2, name: "b", conclusion: CheckConclusion.FAILURE }),
        run({ id: 3, name: "c", status: CheckStatus.IN_PROGRESS, conclusion: null }),
        run({ id: 4, name: "d", conclusion: CheckConclusion.SKIPPED }),
      ],
      []
    );
    expect(countStates(items)).toEqual({
      success: 1,
      failure: 1,
      pending: 1,
      neutral: 0,
      skipped: 1,
    });
  });

  it("none when empty", () => {
    expect(rollupFromCounts(countStates([]), 0)).toBe("none");
  });
  it("failure dominates pending and success", () => {
    expect(
      rollupFromCounts({ success: 2, failure: 1, pending: 1, neutral: 0, skipped: 0 }, 4)
    ).toBe("failure");
  });
  it("pending beats success", () => {
    expect(
      rollupFromCounts({ success: 2, failure: 0, pending: 1, neutral: 0, skipped: 0 }, 3)
    ).toBe("pending");
  });
  it("success when all settled green/neutral/skipped", () => {
    expect(
      rollupFromCounts({ success: 1, failure: 0, pending: 0, neutral: 1, skipped: 1 }, 3)
    ).toBe("success");
  });
});

describe("prToChecksPr", () => {
  function pr(overrides: Partial<PullRequest>): PullRequest {
    return {
      id: 1,
      number: 6,
      title: "Checks dashboard",
      body: "",
      state: "open",
      draft: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      merged_at: null,
      closed_at: null,
      head: { ref: "feat", sha: "abc1234", repo: null },
      base: { ref: "main", sha: "base", repo: {} as PullRequest["base"]["repo"] },
      user: { login: "a", id: 1, avatar_url: "", url: "", type: "User" },
      assignees: [],
      requested_reviewers: [],
      labels: [],
      comments: 0,
      review_comments: 0,
      commits: 1,
      additions: 1,
      deletions: 0,
      changed_files: 1,
      html_url: "https://github.com/o/r/pull/6",
      url: "",
      ...overrides,
    };
  }

  it("projects open PR", () => {
    expect(prToChecksPr(pr({}))).toEqual({
      number: 6,
      title: "Checks dashboard",
      state: "open",
      isDraft: false,
      merged: false,
      htmlUrl: "https://github.com/o/r/pull/6",
    });
  });

  it("flags merged + draft", () => {
    expect(prToChecksPr(pr({ merged_at: "2026-01-02T00:00:00Z", state: "closed" })).merged).toBe(
      true
    );
    expect(prToChecksPr(pr({ draft: true })).isDraft).toBe(true);
  });
});

describe("emptyView", () => {
  it("produces a fully-populated empty ChecksView", () => {
    const v = emptyView("s1", "no-repo", "No GitHub remote");
    expect(v.rollup).toBe("no-repo");
    expect(v.reason).toBe("No GitHub remote");
    expect(v.items).toEqual([]);
    expect(v.counts).toEqual({ success: 0, failure: 0, pending: 0, neutral: 0, skipped: 0 });
    expect(v.cached).toBe(false);
    expect(typeof v.fetchedAt).toBe("string");
  });

  it("accepts partial overrides", () => {
    const v = emptyView("s1", "error", "no-auth", {
      branch: "feat",
      repo: { owner: "o", name: "r" },
    });
    expect(v.branch).toBe("feat");
    expect(v.repo).toEqual({ owner: "o", name: "r" });
  });
});

describe("ChecksCache (stale-while-revalidate, §4.1)", () => {
  function view(): ChecksView {
    return emptyView("s1", "success");
  }

  it("returns null on miss", () => {
    const c = new ChecksCache();
    expect(c.get("k")).toBeNull();
  });

  it("returns fresh within soft TTL", () => {
    const c = new ChecksCache();
    const t0 = 1_000_000;
    c.set("k", view(), t0);
    const hit = c.get("k", t0 + SOFT_TTL_MS - 1);
    expect(hit).not.toBeNull();
    expect(hit!.cached).toBe(true);
    expect(hit!.stale).toBe(false);
  });

  it("marks stale past soft TTL but before hard TTL", () => {
    const c = new ChecksCache();
    const t0 = 1_000_000;
    c.set("k", view(), t0);
    const hit = c.get("k", t0 + SOFT_TTL_MS + 1);
    expect(hit!.stale).toBe(true);
  });

  it("drops entry past hard TTL", () => {
    const c = new ChecksCache();
    const t0 = 1_000_000;
    c.set("k", view(), t0);
    expect(c.get("k", t0 + HARD_TTL_MS + 1)).toBeNull();
  });

  it("peekStale serves a stale view without dropping it", () => {
    const c = new ChecksCache();
    const t0 = 1_000_000;
    c.set("k", view(), t0);
    const stale = c.peekStale("k");
    expect(stale!.stale).toBe(true);
    expect(stale!.cached).toBe(true);
  });

  it("invalidate removes the entry", () => {
    const c = new ChecksCache();
    c.set("k", view());
    c.invalidate("k");
    expect(c.get("k")).toBeNull();
  });

  it("cacheKeyFor is repo+branch scoped", () => {
    expect(cacheKeyFor("/r", "main")).toBe("checks:/r@main");
    expect(cacheKeyFor("/r", "feat")).not.toBe(cacheKeyFor("/r", "main"));
  });
});

describe("presentation helpers", () => {
  it("formatDuration humanizes ms", () => {
    expect(formatDuration(190000)).toBe("3m 10s");
    expect(formatDuration(42000)).toBe("42s");
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(-5)).toBeNull();
  });

  it("summarizeCounts builds a humanized line", () => {
    expect(summarizeCounts({ success: 3, failure: 0, pending: 1, neutral: 0, skipped: 1 })).toBe(
      "3 passed · 1 running · 1 skipped"
    );
    expect(summarizeCounts({ success: 0, failure: 0, pending: 0, neutral: 0, skipped: 0 })).toBe(
      "No checks"
    );
  });

  it("rollupBadgeGlyph only shows for success/failure/pending", () => {
    expect(rollupBadgeGlyph("success")).toEqual({ glyph: "✓", color: "#00ff88" });
    expect(rollupBadgeGlyph("failure")?.glyph).toBe("✗");
    expect(rollupBadgeGlyph("pending")?.glyph).toBe("⏳");
    expect(rollupBadgeGlyph("none")).toBeNull();
    expect(rollupBadgeGlyph("no-pr")).toBeNull();
    expect(rollupBadgeGlyph("error")).toBeNull();
  });

  it("shortSha truncates to 7", () => {
    expect(shortSha("abc1234def5678")).toBe("abc1234");
    expect(shortSha(null)).toBeNull();
  });
});

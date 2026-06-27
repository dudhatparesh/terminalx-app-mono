import { describe, it, expect } from "vitest";
import { groupByFile, indexComments, mergeIntoModel, mergeThreads } from "@/lib/pr-review/merge";
import { threadKey } from "@/types/pr-review";
import type { ReviewComment, ReviewSummary, ReviewThread } from "@/lib/github/types";
import type { DraftComment } from "@/types/pr-review";

function comment(overrides: Partial<ReviewComment>): ReviewComment {
  return {
    id: 1,
    pull_request_review_id: null,
    user: { login: "alice", id: 1, avatar_url: "", url: "", type: "User" },
    body: "hi",
    path: "src/a.ts",
    line: 12,
    original_line: 12,
    start_line: null,
    side: "RIGHT",
    commit_id: "sha",
    diff_hunk: "@@ -10,3 +10,6 @@",
    in_reply_to_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    html_url: "",
    ...overrides,
  };
}

function thread(overrides: Partial<ReviewThread>): ReviewThread {
  return {
    path: "src/a.ts",
    line: 12,
    side: "RIGHT",
    resolved: false,
    comments: [comment({})],
    ...overrides,
  };
}

function draft(overrides: Partial<DraftComment>): DraftComment {
  return {
    id: "draft:sess:src/a.ts:12:abc",
    sessionName: "sess",
    path: "src/a.ts",
    line: 12,
    side: "RIGHT",
    body: "draft body",
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

describe("mergeThreads (§4.2)", () => {
  it("attaches a reply draft to the matching posted thread by root comment id", () => {
    const threads = [thread({ comments: [comment({ id: 901, line: 12 })] })];
    const drafts = [draft({ inReplyToId: 901, line: 99, path: "ignored.ts" })];
    const merged = mergeThreads(threads, drafts, {}, indexComments(threads));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.draftReplies).toHaveLength(1);
    expect(merged[0]!.draftOnly).toBe(false);
    // Draft re-anchored to the thread's (path,line,side), not its own.
    expect(merged[0]!.key).toBe(threadKey("src/a.ts", 12, "RIGHT"));
  });

  it("creates a draft-only thread for a fresh line with no posted comments", () => {
    const merged = mergeThreads([], [draft({ line: 40 })], {});
    expect(merged).toHaveLength(1);
    expect(merged[0]!.draftOnly).toBe(true);
    expect(merged[0]!.comments).toHaveLength(0);
    expect(merged[0]!.draftReplies).toHaveLength(1);
  });

  it("keeps a draft whose line vanished from the diff under its own anchor (§10)", () => {
    // No posted thread at all; the draft still surfaces (not dropped).
    const merged = mergeThreads([], [draft({ line: 7, path: "gone.ts" })], {});
    expect(merged.map((t) => t.path)).toContain("gone.ts");
  });

  it("applies the TerminalX-tracked resolved flag over GitHub's (always false)", () => {
    const threads = [thread({ resolved: false })];
    const key = threadKey("src/a.ts", 12, "RIGHT");
    const merged = mergeThreads(threads, [], { [key]: true }, indexComments(threads));
    expect(merged[0]!.resolved).toBe(true);
  });
});

describe("groupByFile", () => {
  it("splits filename (emphasized) from directory (muted) and sorts by path", () => {
    const merged = mergeThreads(
      [
        thread({ path: ".terminalx/settings.toml", line: 12 }),
        thread({ path: "src/a.ts", line: 3 }),
      ],
      [],
      {}
    );
    const groups = groupByFile(merged);
    expect(groups.map((g) => g.path)).toEqual([".terminalx/settings.toml", "src/a.ts"]);
    expect(groups[0]!.filename).toBe("settings.toml");
    expect(groups[0]!.dir).toBe(".terminalx/");
  });

  it("sorts threads within a file by line number", () => {
    const merged = mergeThreads(
      [thread({ line: 30 }), thread({ line: 5 }), thread({ line: 18 })],
      [],
      {}
    );
    const groups = groupByFile(merged);
    expect(groups[0]!.threads.map((t) => t.line)).toEqual([5, 18, 30]);
  });
});

describe("mergeIntoModel (§3 / §6.1)", () => {
  const summary = (overrides: Partial<ReviewSummary> = {}): ReviewSummary => ({
    prNumber: 1,
    decision: "changes_requested",
    reviews: [
      {
        id: 55,
        user: { login: "alice", id: 1, avatar_url: "", url: "", type: "User" },
        body: "",
        state: "CHANGES_REQUESTED",
        submitted_at: "2026-01-01T00:00:00Z",
        commit_id: "sha",
        html_url: "",
      },
    ],
    threads: [thread({})],
    ...overrides,
  });

  it("carries decision + reviews and counts drafts", () => {
    const model = mergeIntoModel(null, summary(), [draft({}), draft({ id: "d2" })]);
    expect(model.decision).toBe("changes_requested");
    expect(model.reviews).toHaveLength(1);
    expect(model.draftCount).toBe(2);
  });

  it("returns pending decision and empty groups when there is no summary (no PR)", () => {
    const model = mergeIntoModel(null, null, []);
    expect(model.decision).toBe("pending");
    expect(model.byFile).toEqual([]);
    expect(model.draftCount).toBe(0);
  });
});

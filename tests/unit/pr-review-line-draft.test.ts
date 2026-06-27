import { describe, it, expect } from "vitest";
import {
  buildLineDraftInput,
  groupByFile,
  mergeThreads,
  overlayLiveDrafts,
} from "@/lib/pr-review/merge";
import { threadKey } from "@/types/pr-review";
import type { DraftComment } from "@/types/pr-review";

/**
 * Issue #3 — a human must be able to create a NEW top-level inline comment on a
 * diff line (not just reply to an existing thread). The diff-line composer in
 * LineView builds its draft input via buildLineDraftInput; the resulting draft
 * MUST carry inReplyToId === undefined so the merge layer turns it into a fresh
 * draft-only thread keyed by {path,line,side}.
 */
describe("buildLineDraftInput (#3 new inline line comment)", () => {
  it("builds a NEW top-level draft input (no inReplyToId) keyed by file/line/side", () => {
    const input = buildLineDraftInput({
      path: "src/index.ts",
      line: 12,
      side: "RIGHT",
      body: "  needs a guard here  ",
    });
    expect(input.inReplyToId).toBeUndefined();
    expect(input.path).toBe("src/index.ts");
    expect(input.line).toBe(12);
    expect(input.side).toBe("RIGHT");
    // Body is trimmed so whitespace-only submissions are caught by callers.
    expect(input.body).toBe("needs a guard here");
  });

  it("defaults side to RIGHT (new-file side) when omitted", () => {
    const input = buildLineDraftInput({ path: "a.ts", line: 3, body: "x" });
    expect(input.side).toBe("RIGHT");
  });

  it("the built input becomes a draft-only thread visible in the model", () => {
    const built = buildLineDraftInput({ path: "src/index.ts", line: 40, body: "new note" });
    // Simulate persistence shaping the input into a stored DraftComment.
    const stored: DraftComment = {
      id: "draft:sess:src/index.ts:40:abc",
      sessionName: "sess",
      path: built.path,
      line: built.line,
      side: built.side ?? "RIGHT",
      inReplyToId: built.inReplyToId,
      body: built.body,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const merged = mergeThreads([], [stored], {});
    expect(merged).toHaveLength(1);
    expect(merged[0]!.draftOnly).toBe(true);
    expect(merged[0]!.comments).toHaveLength(0);
    expect(merged[0]!.key).toBe(threadKey("src/index.ts", 40, "RIGHT"));

    const groups = groupByFile(merged);
    expect(groups.map((g) => g.path)).toContain("src/index.ts");
  });
});

describe("overlayLiveDrafts (#3 immediate Review-tab surfacing)", () => {
  function draft(overrides: Partial<DraftComment>): DraftComment {
    return {
      id: "draft:sess:src/index.ts:12:abc",
      sessionName: "sess",
      path: "src/index.ts",
      line: 12,
      side: "RIGHT",
      body: "fresh note",
      createdAt: "2026-01-02T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      ...overrides,
    };
  }

  it("surfaces a NEW top-level live draft as a draft-only thread even with no posted threads (no PR)", () => {
    // Snapshot model has no threads yet (e.g. unbound repo / no PR).
    const groups = overlayLiveDrafts([], [draft({})]);
    expect(groups.map((g) => g.path)).toContain("src/index.ts");
    const thread = groups[0]!.threads[0]!;
    expect(thread.draftOnly).toBe(true);
    expect(thread.draftReplies).toHaveLength(1);
    expect(thread.draftReplies[0]!.body).toBe("fresh note");
  });

  it("preserves posted threads from the snapshot while overlaying live drafts", () => {
    const posted = mergeThreads(
      [
        {
          path: "src/a.ts",
          line: 5,
          side: "RIGHT",
          resolved: false,
          comments: [
            {
              id: 7,
              pull_request_review_id: null,
              user: { login: "alice", id: 1, avatar_url: "", url: "", type: "User" },
              body: "posted",
              path: "src/a.ts",
              line: 5,
              original_line: 5,
              start_line: null,
              side: "RIGHT",
              commit_id: "sha",
              diff_hunk: "@@",
              in_reply_to_id: null,
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
              html_url: "",
            },
          ],
        },
      ],
      [],
      {}
    );
    const snapshot = groupByFile(posted);
    const overlaid = overlayLiveDrafts(snapshot, [draft({ path: "src/index.ts", line: 99 })]);
    const paths = overlaid.map((g) => g.path);
    expect(paths).toContain("src/a.ts"); // posted thread kept
    expect(paths).toContain("src/index.ts"); // new live draft surfaced
  });
});

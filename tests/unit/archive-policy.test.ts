import { describe, expect, it } from "vitest";
import {
  shouldAutoArchiveOnPrStatus,
  evaluateAutoArchive,
  type AutoArchiveCandidate,
} from "@/lib/archive-policy";

// Pure, browser-safe auto-archive policy (issue #9). No I/O — these decide
// WHETHER a worktree should be auto-archived; the trigger point performs the
// actual archive via the API/server lib.

describe("shouldAutoArchiveOnPrStatus", () => {
  it("archives only when the PR is merged", () => {
    expect(shouldAutoArchiveOnPrStatus("merged")).toBe(true);
  });

  it("does NOT archive for open / draft / closed / undefined", () => {
    expect(shouldAutoArchiveOnPrStatus("open")).toBe(false);
    expect(shouldAutoArchiveOnPrStatus("draft")).toBe(false);
    // A closed-but-unmerged PR keeps its branch; not auto-archived.
    expect(shouldAutoArchiveOnPrStatus("closed")).toBe(false);
    expect(shouldAutoArchiveOnPrStatus(undefined)).toBe(false);
  });
});

describe("evaluateAutoArchive", () => {
  const base: AutoArchiveCandidate = {
    name: "feat-x",
    archived: false,
    hasWorktree: true,
    prStatus: "merged",
  };

  it("flags a merged, non-archived worktree", () => {
    expect(evaluateAutoArchive(base)).toBe(true);
  });

  it("skips an already-archived worktree (idempotent)", () => {
    expect(evaluateAutoArchive({ ...base, archived: true })).toBe(false);
  });

  it("skips a session without a worktree", () => {
    expect(evaluateAutoArchive({ ...base, hasWorktree: false })).toBe(false);
  });

  it("skips when the PR is not merged", () => {
    expect(evaluateAutoArchive({ ...base, prStatus: "open" })).toBe(false);
    expect(evaluateAutoArchive({ ...base, prStatus: undefined })).toBe(false);
  });

  it("selectAutoArchivable returns only the merged, unarchived, worktree-backed names", () => {
    const candidates: AutoArchiveCandidate[] = [
      { name: "merged-1", archived: false, hasWorktree: true, prStatus: "merged" },
      { name: "merged-but-archived", archived: true, hasWorktree: true, prStatus: "merged" },
      { name: "open-1", archived: false, hasWorktree: true, prStatus: "open" },
      { name: "no-worktree", archived: false, hasWorktree: false, prStatus: "merged" },
    ];
    const names = candidates.filter(evaluateAutoArchive).map((c) => c.name);
    expect(names).toEqual(["merged-1"]);
  });
});

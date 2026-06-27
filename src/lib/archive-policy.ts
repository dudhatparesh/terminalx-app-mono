// Pure auto-archive policy for worktrees (issue #9).
//
// BROWSER-SAFE: no Node builtins, no server-only imports. These functions decide
// WHETHER a worktree should be auto-archived; the trigger point (a server lib /
// API route) performs the actual archive (removeGitWorktree + flag). Keeping the
// decision pure means the policy is unit-testable without git or GitHub.

import type { PullRequestStatus } from "@/lib/github/types";

/**
 * Auto-archive a worktree when its PR is merged. A closed-but-unmerged PR keeps
 * its branch alive (the user may still want it), so only "merged" qualifies.
 * Age-based sweeps are intentionally NOT part of this default policy (spec: off
 * by default).
 */
export function shouldAutoArchiveOnPrStatus(status: PullRequestStatus | undefined): boolean {
  return status === "merged";
}

/** The minimal worktree fields the auto-archive decision needs. */
export interface AutoArchiveCandidate {
  name: string;
  /** Already archived → never re-archive (idempotent). */
  archived?: boolean;
  /** Only worktree-backed sessions can be archived (archive removes the worktree). */
  hasWorktree: boolean;
  /** Derived PR status for the worktree branch (absent when no PR is linked). */
  prStatus?: PullRequestStatus;
}

/**
 * Decide whether a single candidate worktree should be auto-archived now.
 * True only for a worktree-backed, not-yet-archived session whose PR is merged.
 */
export function evaluateAutoArchive(candidate: AutoArchiveCandidate): boolean {
  if (candidate.archived) return false;
  if (!candidate.hasWorktree) return false;
  return shouldAutoArchiveOnPrStatus(candidate.prStatus);
}

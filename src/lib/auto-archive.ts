// Server-side auto-archive trigger (issue #9).
//
// SERVER-ONLY (git/fs + GitHub layer). When a worktree's PR is MERGED, archive
// it automatically: removeGitWorktree (KEEP the branch for restore) + set
// archived/archivedAt. Best-effort and idempotent — a failed PR lookup or
// removal for one worktree never aborts the rest, and an already-archived
// worktree is skipped. The WHETHER decision is the pure policy in
// archive-policy.ts; this module performs the I/O.
//
// The PR-status lookup is injectable so the trigger is unit-testable without
// GitHub; the default resolves via the #7 GitHub layer (resolveWorktreePR).

import { listMetadata, patchMeta, type SessionMeta } from "./ai-sessions";
import { removeGitWorktree } from "./git-worktree";
import { evaluateAutoArchive } from "./archive-policy";
import { audit } from "./audit-log";
import type { PullRequestStatus } from "./github/types";

export interface AutoArchiveOptions {
  /**
   * Resolve a worktree's PR status. Defaults to the GitHub layer (#7). Injected
   * in tests so the policy can be exercised without a live integration. May
   * throw — the trigger isolates per-worktree failures.
   */
  resolvePrStatus?: (meta: SessionMeta) => Promise<PullRequestStatus | undefined>;
}

async function defaultResolvePrStatus(meta: SessionMeta): Promise<PullRequestStatus | undefined> {
  // Lazy import keeps the (heavier) resolve module off the hot path and avoids a
  // cycle; resolveWorktreePR is itself best-effort and never throws.
  const { resolveWorktreePR } = await import("./workspaces/resolve");
  const { prStatus } = await resolveWorktreePR(meta);
  return prStatus;
}

/**
 * Scan worktree-backed sessions and auto-archive any whose PR is merged.
 * Returns the names archived in this pass. Best-effort throughout.
 */
export async function autoArchiveMergedWorktrees(
  options: AutoArchiveOptions = {}
): Promise<{ archived: string[] }> {
  const resolvePrStatus = options.resolvePrStatus ?? defaultResolvePrStatus;
  const archived: string[] = [];

  for (const meta of listMetadata()) {
    if (!meta.worktree || meta.archived) continue;

    let prStatus: PullRequestStatus | undefined;
    try {
      prStatus = await resolvePrStatus(meta);
    } catch {
      // A failed lookup for one worktree must not block the rest.
      continue;
    }

    const decision = evaluateAutoArchive({
      name: meta.name,
      archived: meta.archived,
      hasWorktree: Boolean(meta.worktree),
      prStatus,
    });
    if (!decision) continue;

    try {
      // Remove the worktree but KEEP the branch (restore needs it).
      removeGitWorktree(meta.worktree.path, meta.worktree.repoRoot, meta.worktree.linkedPaths);
    } catch {
      // Best-effort: still flag archived so the row leaves the active list.
    }
    const updated = await patchMeta(meta.name, {
      archived: true,
      archivedAt: new Date().toISOString(),
    });
    if (updated) {
      archived.push(meta.name);
      audit("session_deleted", { detail: `${meta.name} (auto-archived: PR merged)` });
    }
  }

  return { archived };
}

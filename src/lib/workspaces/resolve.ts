// Server-side resolution of a worktree's diff stat + PR status (issue #12).
//
// SERVER-ONLY: shells out to git (git-diff numstat) and talks to the GitHub
// layer (#7) for PR status. Everything is BEST-EFFORT — a failure to resolve a
// diff or PR never throws; the row just falls back to a zero stat / no PR and
// the sidebar shows "in-progress". The pure grouping/status logic lives in
// derive.ts (browser-safe); this module only gathers the raw inputs.

import { computeDiff, resolveBase } from "@/lib/git-diff";
import { resolvePRForSession } from "@/lib/github/session-link";
import { getGitHubApiForRepo, resolveRepoBinding } from "@/lib/pr-review/repo-binding";
import type { SessionMeta } from "@/lib/ai-sessions";
import type { WorktreeResolved } from "./derive";
import type { DiffStat } from "@/types/workspace";

/**
 * Compute the additions/deletions of a worktree branch vs the workspace base,
 * reusing the same numstat the Changes tab uses so the two agree. Returns a
 * zero stat when the worktree path isn't a usable checkout or the diff fails.
 */
export function computeWorktreeDiffStat(meta: SessionMeta): DiffStat {
  const wt = meta.worktree;
  if (!wt) return { additions: 0, deletions: 0 };
  try {
    const head = "HEAD";
    const base = resolveBase(wt.path, head);
    if (!base) return { additions: 0, deletions: 0 };
    const diff = computeDiff({
      safeRoot: wt.path,
      base,
      head,
      includeHunks: false,
    });
    return { additions: diff.summary.additions, deletions: diff.summary.deletions };
  } catch {
    return { additions: 0, deletions: 0 };
  }
}

/**
 * Best-effort PR status for a worktree branch via the GitHub layer (#7). When
 * the repo isn't bound to an integration, or the lookup fails, returns {} so the
 * row stays "in-progress". Never throws.
 */
export async function resolveWorktreePR(meta: SessionMeta): Promise<{
  prStatus?: WorktreeResolved["prStatus"];
  prNumber?: number;
}> {
  const wt = meta.worktree;
  if (!wt?.branch) return {};
  try {
    const binding = await resolveRepoBinding(wt.repoRoot);
    if (!binding) return {};
    const api = getGitHubApiForRepo(binding);
    const link = await resolvePRForSession(api, binding.owner, binding.repo, meta);
    if (!link.pr) return {};
    return { prStatus: link.pr.status, prNumber: link.pr.number };
  } catch {
    return {};
  }
}

/**
 * Resolve the full per-worktree data (diff stat + PR status) for one session.
 * Synchronous diff + async PR; both best-effort. Used by GET /api/workspaces.
 */
export async function resolveWorktree(meta: SessionMeta): Promise<WorktreeResolved> {
  const diffStat = computeWorktreeDiffStat(meta);
  const { prStatus, prNumber } = await resolveWorktreePR(meta);
  return {
    diffStat,
    ...(prStatus ? { prStatus } : {}),
    ...(prNumber !== undefined ? { prNumber } : {}),
  };
}

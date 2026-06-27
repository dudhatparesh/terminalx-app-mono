// Pure projection helpers for the Workspace → Worktree model (issue #12).
//
// BROWSER-SAFE: no Node builtins, no server-only imports. These functions take
// already-resolved inputs (sessions + diff stats + optional PR status) and
// produce the WorkspaceView shape the sidebar renders. Keeping them pure means
// the grouping/status logic is unit-testable without git or GitHub.

import type { PullRequestStatus } from "@/lib/github/types";
import type {
  DiffStat,
  Workspace,
  WorkspaceView,
  WorktreeStatus,
  WorktreeView,
} from "@/types/workspace";

/** The session fields this projection needs (a structural subset of SessionMeta). */
export interface WorktreeSessionLike {
  name: string;
  worktree?: {
    repoRoot: string;
    path: string;
    branch: string;
  };
  /** Issue #9 flags, carried on the session meta. */
  collapsed?: boolean;
  archived?: boolean;
}

/** Per-session resolved data the server gathers (best-effort, may be partial). */
export interface WorktreeResolved {
  /** Additions/deletions vs the workspace base; undefined while still loading. */
  diffStat?: DiffStat;
  /** Derived PR status when a PR is linked to the branch; absent otherwise. */
  prStatus?: PullRequestStatus;
  prNumber?: number;
  /** Set true when the diff/PR resolution is still in flight. */
  loading?: boolean;
}

/**
 * Derive a worktree's sidebar status from its resolved git/PR state.
 *
 * Order matters:
 * - still loading → "loading" (spinner)
 * - a merged PR  → "merged" (purple)
 * - an open/draft PR → "open"
 * - otherwise (has a branch, no PR yet) → "in-progress" (branch icon)
 *
 * A closed-but-unmerged PR falls back to "in-progress" — the branch still lives.
 */
export function deriveWorktreeStatus(resolved: WorktreeResolved): WorktreeStatus {
  if (resolved.loading || resolved.diffStat === undefined) return "loading";
  switch (resolved.prStatus) {
    case "merged":
      return "merged";
    case "open":
    case "draft":
      return "open";
    default:
      return "in-progress";
  }
}

/** Project one session + its resolved data into a WorktreeView. */
export function toWorktreeView(
  session: WorktreeSessionLike,
  resolved: WorktreeResolved
): WorktreeView {
  return {
    sessionName: session.name,
    branch: session.worktree?.branch ?? session.name,
    path: session.worktree?.path ?? "",
    diffStat: resolved.diffStat ?? { additions: 0, deletions: 0 },
    status: deriveWorktreeStatus(resolved),
    ...(resolved.prNumber !== undefined ? { prNumber: resolved.prNumber } : {}),
    ...(session.collapsed !== undefined ? { collapsed: session.collapsed } : {}),
    ...(session.archived !== undefined ? { archived: session.archived } : {}),
  };
}

/**
 * Group sessions under a workspace by matching SessionMeta.worktree.repoRoot to
 * the workspace's repoRoot. Returns the session subset that belongs to the
 * workspace (order preserved). Pure — the server then resolves diff/PR per row.
 */
export function sessionsForWorkspace<T extends WorktreeSessionLike>(
  workspace: Pick<Workspace, "repoRoot">,
  sessions: T[]
): T[] {
  return sessions.filter((s) => s.worktree?.repoRoot === workspace.repoRoot);
}

/** Assemble a full WorkspaceView from a workspace + its already-projected worktrees. */
export function toWorkspaceView(workspace: Workspace, worktrees: WorktreeView[]): WorkspaceView {
  return { ...workspace, worktrees };
}

/** Default display name for a repo root (its directory basename). */
export function defaultWorkspaceName(repoRoot: string): string {
  const trimmed = repoRoot.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1) || trimmed;
}

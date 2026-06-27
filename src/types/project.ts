// Browser-safe types for the Project → Workspace model (issue #12).
//
// IMPORTANT: this module MUST stay free of Node builtins (fs/path/child_process)
// and server-only imports so it can be imported from "use client" components.
// The corrected model: a Project is a REPO container that groups MANY
// workspaces. A workspace is one task (a git worktree + branch + session).

/** A registered project/repo container. Persisted under data/projects.json. */
export interface Project {
  id: string;
  /** Absolute git repo root this project maps to. Unique key. */
  repoRoot: string;
  /** Display name (defaults to the repo directory basename). */
  name: string;
  createdAt: string;
}

/**
 * Per-workspace derived status. Drives the sidebar status icon:
 * - "loading"     — diff/PR status is still resolving (spinner)
 * - "in-progress" — has a worktree branch, no merged PR yet (branch icon)
 * - "open"        — an open PR exists for the branch (open PR icon)
 * - "merged"      — the PR was merged (purple merged-PR icon)
 */
export type WorkspaceStatus = "loading" | "in-progress" | "open" | "merged";

/** Additions/deletions of a workspace vs the project base branch. */
export interface DiffStat {
  additions: number;
  deletions: number;
}

/**
 * A workspace as projected for the sidebar. Derived from a session that carries
 * SessionMeta.worktree whose repoRoot matches the project.
 */
export interface WorkspaceView {
  /** The owning session name (stable id for the row). */
  sessionName: string;
  /** The worktree branch (the row's display name). */
  branch: string;
  /** Absolute worktree path. */
  path: string;
  diffStat: DiffStat;
  status: WorkspaceStatus;
  /** PR number when a PR is linked, for the merged/open icon link. */
  prNumber?: number;
  /** Collapsed/archived flags carried on the session meta (issue #9). */
  collapsed?: boolean;
  archived?: boolean;
}

/** A project plus its derived workspaces — the GET /api/projects row. */
export interface ProjectView extends Project {
  workspaces: WorkspaceView[];
}

/** Status icon kind, so the client can pick a glyph without server imports. */
export function statusIcon(
  status: WorkspaceStatus
): "spinner" | "branch" | "pr-open" | "pr-merged" {
  switch (status) {
    case "loading":
      return "spinner";
    case "merged":
      return "pr-merged";
    case "open":
      return "pr-open";
    case "in-progress":
    default:
      return "branch";
  }
}

/** Format a diff stat as the sidebar's "+N −N" label (zeros are omitted). */
export function formatDiffStat(stat: DiffStat): string {
  const parts: string[] = [];
  if (stat.additions > 0) parts.push(`+${stat.additions}`);
  if (stat.deletions > 0) parts.push(`−${stat.deletions}`);
  return parts.join(" ");
}

// DELETE /api/projects/[id] (issue #12, corrected model).
//
// Deleting a PROJECT removes the whole container: the registration AND every
// workspace inside it. This is DISTINCT from archiving a single workspace (issue
// #9). For each derived workspace (a session whose worktree.repoRoot matches the
// project) we kill its tmux session, remove the git worktree via the shared
// removeGitWorktree (which never follows shared symlinks into their targets),
// and drop its session metadata — then drop the project record itself.

import { NextRequest, NextResponse } from "next/server";
import { getUserScoping } from "@/lib/session-scope";
import { audit } from "@/lib/audit-log";
import { deleteMeta, listMetadata } from "@/lib/ai-sessions";
import { killSession } from "@/lib/tmux";
import { removeGitWorktree } from "@/lib/git-worktree";
import { deleteRecordingsForSession } from "@/lib/recordings-cleanup";
import { deleteProject, getProject } from "@/lib/projects/store";
import { sessionsForProject } from "@/lib/projects/derive";
import { pruneOrphanedWorktrees } from "@/lib/worktree-sweep";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.TERMINUS_READ_ONLY === "true") {
    return NextResponse.json(
      { error: "Project deletion disabled in read-only mode" },
      { status: 403 }
    );
  }

  const { hasIdentity, username } = getUserScoping(req.headers);
  if (!hasIdentity) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    // Tear down every workspace (session + git worktree) belonging to the project.
    const wsSessions = sessionsForProject(project, listMetadata());
    let removedWorkspaces = 0;
    for (const meta of wsSessions) {
      try {
        killSession(meta.name);
      } catch {
        // Session may already be gone; continue tearing down the worktree.
      }
      if (meta.worktree) {
        try {
          removeGitWorktree(meta.worktree.path, meta.worktree.repoRoot, meta.worktree.linkedPaths);
        } catch {
          // Best-effort: a failed worktree removal must not block the rest.
        }
      }
      // Confirmed delete: prune this workspace's recordings (issue #9). Archiving
      // a workspace keeps recordings; deleting the whole project purges them.
      try {
        deleteRecordingsForSession(meta.name);
      } catch {
        // Best-effort: recording cleanup never blocks the project delete.
      }
      await deleteMeta(meta.name);
      removedWorkspaces++;
    }

    // Best-effort sweep: drop any orphaned worktree dirs whose sessions are gone
    // (e.g. a worktree removed out-of-band) so the worktrees root stays clean.
    try {
      pruneOrphanedWorktrees();
    } catch {
      // Never block the delete on a sweep failure.
    }

    await deleteProject(id);
    audit("project_deleted", {
      username: username || undefined,
      detail: `${project.name} (${project.repoRoot}) — ${removedWorkspaces} workspace(s)`,
    });
    return NextResponse.json({ success: true, removedWorkspaces });
  } catch (err) {
    console.error("[api/projects DELETE]", err);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}

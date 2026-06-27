// DELETE /api/workspaces/[id] (issue #12, corrected model).
//
// Deleting a WORKSPACE removes the whole PROJECT: the registration AND every
// worktree inside it. This is DISTINCT from archiving a single worktree (issue
// #9). For each derived worktree (a session whose worktree.repoRoot matches the
// workspace) we kill its tmux session, remove the git worktree via the shared
// removeGitWorktree (which never follows shared symlinks into their targets),
// and drop its session metadata — then drop the workspace record itself.

import { NextRequest, NextResponse } from "next/server";
import { getUserScoping } from "@/lib/session-scope";
import { audit } from "@/lib/audit-log";
import { deleteMeta, listMetadata } from "@/lib/ai-sessions";
import { killSession } from "@/lib/tmux";
import { removeGitWorktree } from "@/lib/git-worktree";
import { deleteWorkspace, getWorkspace } from "@/lib/workspaces/store";
import { sessionsForWorkspace } from "@/lib/workspaces/derive";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.TERMINUS_READ_ONLY === "true") {
    return NextResponse.json(
      { error: "Workspace deletion disabled in read-only mode" },
      { status: 403 }
    );
  }

  const { hasIdentity, username } = getUserScoping(req.headers);
  if (!hasIdentity) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Missing workspace id" }, { status: 400 });
  }

  const workspace = getWorkspace(id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    // Tear down every worktree (session + git worktree) belonging to the project.
    const wtSessions = sessionsForWorkspace(workspace, listMetadata());
    let removedWorktrees = 0;
    for (const meta of wtSessions) {
      try {
        killSession(meta.name);
      } catch {
        // Session may already be gone; continue tearing down the worktree.
      }
      if (meta.worktree) {
        try {
          removeGitWorktree(
            meta.worktree.path,
            meta.worktree.repoRoot,
            meta.worktree.linkedPaths
          );
        } catch {
          // Best-effort: a failed worktree removal must not block the rest.
        }
      }
      await deleteMeta(meta.name);
      removedWorktrees++;
    }

    await deleteWorkspace(id);
    audit("workspace_deleted", {
      username: username || undefined,
      detail: `${workspace.name} (${workspace.repoRoot}) — ${removedWorktrees} worktree(s)`,
    });
    return NextResponse.json({ success: true, removedWorktrees });
  } catch (err) {
    console.error("[api/workspaces DELETE]", err);
    return NextResponse.json({ error: "Failed to delete workspace" }, { status: 500 });
  }
}

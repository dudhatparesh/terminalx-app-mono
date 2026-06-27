// GET/POST /api/workspaces (issue #12, corrected Workspace → Worktree model).
//
// A Workspace is a PROJECT/REPO container. GET returns every registered
// workspace WITH its worktrees, which are DERIVED from sessions whose
// SessionMeta.worktree.repoRoot matches the workspace's repoRoot — there is no
// separate worktree store. Each worktree row carries a diff stat (git-diff
// numstat, agreeing with the Changes tab) and a status (merged/open/in-progress
// /loading) computed best-effort from the GitHub layer (#7) + local git state.
//
// POST registers a workspace for a selected git-repo directory (confined to
// TERMINUS_ROOT). Worktrees are CREATED via the existing POST /api/sessions
// flow — the sidebar "+" opens the new-session dialog scoped to this repo.

import { NextRequest, NextResponse } from "next/server";
import { getUserScoping } from "@/lib/session-scope";
import { audit } from "@/lib/audit-log";
import { listMetadata, type SessionMeta } from "@/lib/ai-sessions";
import {
  listWorkspaces,
  registerWorkspace,
  WorkspaceError,
} from "@/lib/workspaces/store";
import { resolveWorktree } from "@/lib/workspaces/resolve";
import { sessionsForWorkspace, toWorktreeView, toWorkspaceView } from "@/lib/workspaces/derive";
import type { WorkspaceView } from "@/types/workspace";

export async function GET(req: NextRequest) {
  const { hasIdentity } = getUserScoping(req.headers);
  if (!hasIdentity) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const workspaces = listWorkspaces();
    const sessions = listMetadata();

    const views: WorkspaceView[] = await Promise.all(
      workspaces.map(async (ws) => {
        const wtSessions = sessionsForWorkspace(ws, sessions);
        const worktrees = await Promise.all(
          wtSessions.map(async (meta: SessionMeta) => {
            // Best-effort: resolveWorktree never throws; a failed diff/PR lookup
            // yields a zero stat / no PR so the row degrades to "in-progress".
            const resolved = await resolveWorktree(meta);
            return toWorktreeView(meta, resolved);
          })
        );
        return toWorkspaceView(ws, worktrees);
      })
    );

    return NextResponse.json({ workspaces: views });
  } catch (err) {
    console.error("[api/workspaces GET]", err);
    return NextResponse.json({ error: "Failed to list workspaces" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (process.env.TERMINUS_READ_ONLY === "true") {
    return NextResponse.json(
      { error: "Workspace registration disabled in read-only mode" },
      { status: 403 }
    );
  }

  const { hasIdentity, username } = getUserScoping(req.headers);
  if (!hasIdentity) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let body: { directory?: unknown; name?: unknown };
  try {
    body = (await req.json()) as { directory?: unknown; name?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const directory = typeof body.directory === "string" ? body.directory.trim() : "";
  if (!directory) {
    return NextResponse.json({ error: "A repository directory is required" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name : undefined;

  try {
    const workspace = await registerWorkspace({ directory, name });
    audit("workspace_registered", {
      username: username || undefined,
      detail: `${workspace.name} (${workspace.repoRoot})`,
    });
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (err) {
    if (err instanceof WorkspaceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/workspaces POST]", err);
    return NextResponse.json({ error: "Failed to register workspace" }, { status: 500 });
  }
}

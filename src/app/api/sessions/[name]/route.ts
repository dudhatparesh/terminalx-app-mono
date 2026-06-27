import { NextRequest, NextResponse } from "next/server";
import { killSession } from "@/lib/tmux";
import { getUserScoping, canAccessSession } from "@/lib/session-scope";
import { audit } from "@/lib/audit-log";
import { deleteMeta, ensureManagedSession, getMeta, patchMeta } from "@/lib/ai-sessions";
import { removeGitWorktree } from "@/lib/git-worktree";

interface Ctx {
  params: Promise<{ name: string }>;
}

/**
 * PATCH /api/sessions/[name] — flip a worktree's sidebar flags (feature #12).
 * Accepts { collapsed?: boolean; archived?: boolean }. Archiving here is the
 * MINIMAL hook the sidebar's "⋮ → Archive" calls; the full archive/restore +
 * cleanup system is issue #9. Session-scoped (403, never 401).
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (process.env.TERMINUS_READ_ONLY === "true") {
    return NextResponse.json(
      { error: "Session update disabled in read-only mode" },
      { status: 403 }
    );
  }

  try {
    const { name: rawName } = await ctx.params;
    const name = decodeURIComponent(rawName);
    if (!name || !/^[a-zA-Z0-9_.\-]+$/.test(name)) {
      return NextResponse.json({ error: "invalid session name" }, { status: 400 });
    }

    const { username, role, shouldScope } = getUserScoping(req.headers);
    if (shouldScope && (!username || !canAccessSession(username, role, name))) {
      return NextResponse.json({ error: "cannot update another user's session" }, { status: 403 });
    }

    let body: { collapsed?: unknown; archived?: unknown };
    try {
      body = (await req.json()) as { collapsed?: unknown; archived?: unknown };
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const patch: { collapsed?: boolean; archived?: boolean; archivedAt?: string } = {};
    if (typeof body.collapsed === "boolean") patch.collapsed = body.collapsed;
    if (typeof body.archived === "boolean") {
      patch.archived = body.archived;
      if (body.archived) patch.archivedAt = new Date().toISOString();
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no recognized fields to update" }, { status: 400 });
    }

    const updated = await patchMeta(name, patch);
    if (!updated) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    if (patch.archived === true) {
      audit("session_deleted", {
        username: username || undefined,
        detail: `${name} (archived)`,
      });
    }
    return NextResponse.json({
      success: true,
      collapsed: updated.collapsed ?? false,
      archived: updated.archived ?? false,
    });
  } catch (err) {
    console.error("[api/sessions/:name PATCH]", err);
    return NextResponse.json({ error: "failed to update session" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (process.env.TERMINUS_READ_ONLY === "true") {
    return NextResponse.json(
      { error: "Session deletion disabled in read-only mode" },
      { status: 403 }
    );
  }

  try {
    const { name: rawName } = await ctx.params;
    const name = decodeURIComponent(rawName);

    if (!name || !/^[a-zA-Z0-9_.\-]+$/.test(name)) {
      return NextResponse.json({ error: "invalid session name" }, { status: 400 });
    }

    const { username, role, shouldScope } = getUserScoping(req.headers);
    if (shouldScope && (!username || !canAccessSession(username, role, name))) {
      return NextResponse.json({ error: "cannot delete another user's session" }, { status: 403 });
    }

    if (!ensureManagedSession(name)) {
      return NextResponse.json(
        { error: "refusing to delete a tmux session not managed by TerminalX" },
        { status: 403 }
      );
    }

    const meta = getMeta(name);
    killSession(name);
    if (meta?.worktree) {
      // Removes the worktree and any shared symlinks WITHOUT touching the
      // shared source (rmSync/unlink never follow the link into its target).
      removeGitWorktree(meta.worktree.path, meta.worktree.repoRoot, meta.worktree.linkedPaths);
    }
    await deleteMeta(name);
    audit("session_deleted", { username: username || undefined, detail: name });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/sessions/:name DELETE]", err);
    return NextResponse.json({ error: "failed to delete session" }, { status: 500 });
  }
}

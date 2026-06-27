// POST /api/sessions/[name]/archive — archive a WORKTREE (issue #9).
//
// Archiving a worktree: mark it archived (+ archivedAt), remove the on-disk git
// worktree via removeGitWorktree (which unlinks shared symlinks WITHOUT touching
// the shared source, #10) but KEEP the branch so it can be restored later. The
// worktree meta (repoRoot/path/branch/linkedPaths) is PRESERVED so restore knows
// where to rebuild. Recordings are NOT pruned here — archived worktrees keep
// their recordings until a confirmed delete.
//
// SERVER-ONLY: this route does the git/fs work; "use client" components call it
// through the API. Session-scoped (403, never 401).

import { NextRequest, NextResponse } from "next/server";
import { getMeta, patchMeta } from "@/lib/ai-sessions";
import { removeGitWorktree } from "@/lib/git-worktree";
import { audit } from "@/lib/audit-log";
import { guardSessionRoute } from "@/lib/pr-review/route-guard";

interface Ctx {
  params: Promise<{ name: string }>;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (process.env.TERMINUS_READ_ONLY === "true") {
    return NextResponse.json({ error: "Archive disabled in read-only mode" }, { status: 403 });
  }

  const { name: rawName } = await ctx.params;
  const guard = guardSessionRoute(req.headers, rawName);
  if (!guard.ok) return guard.response;
  const { name, username } = guard;

  // Body is optional; default removeWorktree=true (spec). A future caller may
  // pass { removeWorktree: false } to keep the worktree on disk while archiving.
  let removeWorktree = true;
  try {
    const body = (await req.json()) as { removeWorktree?: unknown };
    if (typeof body?.removeWorktree === "boolean") removeWorktree = body.removeWorktree;
  } catch {
    // No body / invalid JSON → keep the default.
  }

  const meta = getMeta(name);
  if (!meta) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  if (!meta.worktree) {
    // Archive operates on a worktree; a plain session has nothing to archive.
    return NextResponse.json({ error: "session has no worktree to archive" }, { status: 400 });
  }

  if (removeWorktree) {
    try {
      // Removes the worktree + shared symlinks WITHOUT deleting the branch
      // (restore needs it) and WITHOUT following links into the shared source.
      removeGitWorktree(meta.worktree.path, meta.worktree.repoRoot, meta.worktree.linkedPaths);
    } catch (err) {
      console.error("[api/sessions/:name/archive] removeGitWorktree", err);
      // Best-effort: still mark archived so the row leaves the active list.
    }
  }

  const updated = await patchMeta(name, {
    archived: true,
    archivedAt: new Date().toISOString(),
  });
  if (!updated) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  audit("session_deleted", { username: username || undefined, detail: `${name} (archived)` });
  return NextResponse.json({
    success: true,
    archived: true,
    archivedAt: updated.archivedAt,
  });
}

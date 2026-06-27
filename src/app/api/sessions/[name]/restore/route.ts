// POST /api/sessions/[name]/restore — restore an archived WORKTREE (issue #9).
//
// Archive removed the on-disk worktree but kept the branch + the worktree meta.
// Restore recreates the git worktree from the preserved branch
// (`git worktree add <path> <branch>`), re-links the shared paths (#10), and
// clears archived/archivedAt so the row returns to the active sidebar list.
//
// Re-link targets are reconstructed from the persisted linkedPaths (absolute
// paths inside the worktree) as repo-root-relative shares, so the same heavy
// dirs (node_modules, etc.) are shared again on restore.
//
// SERVER-ONLY: git/fs work lives here; clients call it via the API. Session
// scoped (403, never 401).

import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getMeta, patchMeta } from "@/lib/ai-sessions";
import { restoreGitWorktree } from "@/lib/git-worktree";
import { audit } from "@/lib/audit-log";
import { guardSessionRoute } from "@/lib/pr-review/route-guard";

interface Ctx {
  params: Promise<{ name: string }>;
}

/**
 * Reconstruct repo-root-relative share paths from the absolute linkedPaths that
 * were persisted at create time. A linked path is an absolute location INSIDE
 * the worktree (e.g. "<wt>/node_modules"), so its path relative to the worktree
 * root is exactly the share path to re-link.
 */
function relativeSharePaths(worktreePath: string, linkedPaths: string[] | undefined): string[] {
  if (!linkedPaths || linkedPaths.length === 0) return [];
  const out: string[] = [];
  for (const abs of linkedPaths) {
    const rel = path.relative(worktreePath, abs);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    out.push(rel);
  }
  return out;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (process.env.TERMINUS_READ_ONLY === "true") {
    return NextResponse.json({ error: "Restore disabled in read-only mode" }, { status: 403 });
  }

  const { name: rawName } = await ctx.params;
  const guard = guardSessionRoute(req.headers, rawName);
  if (!guard.ok) return guard.response;
  const { name, username } = guard;

  const meta = getMeta(name);
  if (!meta) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  if (!meta.archived) {
    return NextResponse.json({ error: "session is not archived" }, { status: 400 });
  }
  if (!meta.worktree) {
    return NextResponse.json({ error: "session has no worktree to restore" }, { status: 400 });
  }

  const wt = meta.worktree;
  let linkedPaths: string[] = [];
  try {
    const shares = relativeSharePaths(wt.path, wt.linkedPaths);
    const restored = restoreGitWorktree(wt.path, wt.repoRoot, wt.branch, {
      symlinkPaths: shares,
    });
    linkedPaths = restored.linkedPaths;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to restore worktree";
    console.error("[api/sessions/:name/restore]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Clear archived/archivedAt and refresh linkedPaths (re-link may differ).
  const updated = await patchMeta(name, {
    archived: false,
    archivedAt: undefined,
    worktree: { ...wt, linkedPaths },
  });
  if (!updated) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  audit("session_created", { username: username || undefined, detail: `${name} (restored)` });
  return NextResponse.json({
    success: true,
    archived: false,
    worktree: {
      repoRoot: wt.repoRoot,
      path: wt.path,
      branch: wt.branch,
    },
  });
}

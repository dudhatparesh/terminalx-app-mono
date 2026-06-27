import { NextRequest, NextResponse } from "next/server";
import { getMeta } from "@/lib/ai-sessions";
import { getGitDirectoryInfo } from "@/lib/git-worktree";
import { getUserScoping, canAccessSession } from "@/lib/session-scope";
import { computeDiff, resolveBase } from "@/lib/git-diff";
import { isValidRef, safeRepoRoot, sanitizeDiffError } from "@/lib/diff-api";

/**
 * GET /api/sessions/[name]/diff — file list (no hunks by default) for the
 * session's worktree branch vs its merge-base. spec §3.1.
 *
 * Auth follows the established per-session pattern from DELETE /api/sessions/[name]:
 * scope only when multi-user mode requires it; 403 (never 401). Repo path is
 * confined to TERMINUS_ROOT via resolveSafePath; errors are sanitized.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name: rawName } = await ctx.params;
  const name = decodeURIComponent(rawName);

  const { username, role, shouldScope } = getUserScoping(req.headers);
  if (shouldScope && (!username || !canAccessSession(username, role, name))) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const meta = getMeta(name);
    const repoRoot =
      meta?.worktree?.repoRoot ?? getGitDirectoryInfo(meta?.cwd ?? process.cwd()).root;
    if (!repoRoot) {
      return NextResponse.json({ error: "Not a git repository" }, { status: 404 });
    }
    const safeRoot = safeRepoRoot(repoRoot);

    const sp = req.nextUrl.searchParams;
    const head = sp.get("head") ?? meta?.worktree?.branch ?? "HEAD";
    const rawBase = sp.get("base") ?? undefined;
    const maxFiles = Number(sp.get("maxFiles")) || 300;
    // List view omits hunks so the panel paints rows immediately (spec §3.1);
    // pass includeHunks=1 to embed them.
    const includeHunks = sp.get("includeHunks") === "1";

    if (!isValidRef(head) || (rawBase && !isValidRef(rawBase))) {
      return NextResponse.json({ error: "Invalid ref" }, { status: 400 });
    }

    const base = rawBase ?? resolveBase(safeRoot, head);
    if (!base) {
      return NextResponse.json(
        { error: "No base branch — showing last commit", code: "no-base" },
        { status: 409 }
      );
    }

    const response = computeDiff({
      safeRoot,
      base,
      head,
      session: name,
      maxFiles,
      includeHunks,
    });
    return NextResponse.json(response);
  } catch (err) {
    return sanitizeDiffError(err);
  }
}

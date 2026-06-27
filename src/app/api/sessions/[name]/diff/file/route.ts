import { NextRequest, NextResponse } from "next/server";
import { getMeta } from "@/lib/ai-sessions";
import { getGitDirectoryInfo } from "@/lib/git-worktree";
import { getUserScoping, canAccessSession } from "@/lib/session-scope";
import { computeFileDiff, resolveBase } from "@/lib/git-diff";
import { isValidRef, safeRepoRoot, sanitizeDiffError } from "@/lib/diff-api";

/**
 * GET /api/sessions/[name]/diff/file?path=… — single-file hunks (lazy expand).
 * spec §3.3. Returns one FileDiff WITH hunks so a large branch never parses
 * every patch up front. Same per-session auth + sandbox confinement as the list.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name: rawName } = await ctx.params;
  const name = decodeURIComponent(rawName);

  const { username, role, shouldScope } = getUserScoping(req.headers);
  if (shouldScope && (!username || !canAccessSession(username, role, name))) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const filePath = sp.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  // A diff target path must stay repo-relative; reject traversal up front.
  if (filePath.startsWith("/") || filePath.includes("..")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const meta = getMeta(name);
    const repoRoot =
      meta?.worktree?.repoRoot ?? getGitDirectoryInfo(meta?.cwd ?? process.cwd()).root;
    if (!repoRoot) {
      return NextResponse.json({ error: "Not a git repository" }, { status: 404 });
    }
    const safeRoot = safeRepoRoot(repoRoot);

    const head = sp.get("head") ?? meta?.worktree?.branch ?? "HEAD";
    const rawBase = sp.get("base") ?? undefined;
    const context = Number(sp.get("context")) || 3;

    if (!isValidRef(head) || (rawBase && !isValidRef(rawBase))) {
      return NextResponse.json({ error: "Invalid ref" }, { status: 400 });
    }

    const base = rawBase ?? resolveBase(safeRoot, head);
    if (!base) {
      return NextResponse.json({ error: "No base branch", code: "no-base" }, { status: 409 });
    }

    const file = computeFileDiff({ safeRoot, base, head, path: filePath, context });
    if (!file) {
      return NextResponse.json({ error: "File not found in diff" }, { status: 404 });
    }
    return NextResponse.json({ file });
  } catch (err) {
    return sanitizeDiffError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getUserScoping } from "@/lib/session-scope";
import { computeDiff, resolveBase } from "@/lib/git-diff";
import { isValidRef, safeRepoRoot, sanitizeDiffError } from "@/lib/diff-api";

/**
 * POST /api/diffs — structured diff (files + hunks) between two refs of a repo.
 *
 * Body: { repoPath: string, base?: string, head?: string, context?: number,
 *         maxFiles?: number, includeHunks?: boolean, session?: string }
 *
 * Shells out to `git diff` (argument array, no shell) and parses the output
 * into the spec's DiffResponse (src/types/diff.ts). The repoPath is confined to
 * TERMINUS_ROOT and sensitive paths are rejected (sandbox confinement reused
 * from /api/files); errors are sanitized so filesystem paths never leak.
 *
 * Gated like every other session API: an unidentified caller in multi-user mode
 * is denied (403, never 401), matching the established pattern.
 */
export async function POST(req: NextRequest) {
  const { hasIdentity, shouldScope } = getUserScoping(req.headers);
  if (shouldScope && !hasIdentity) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let body: {
    repoPath?: unknown;
    base?: unknown;
    head?: unknown;
    context?: unknown;
    maxFiles?: unknown;
    includeHunks?: unknown;
    session?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const repoPath = typeof body.repoPath === "string" ? body.repoPath.trim() : "";
  if (!repoPath) {
    return NextResponse.json({ error: "repoPath is required" }, { status: 400 });
  }

  const head = typeof body.head === "string" && body.head.trim() ? body.head.trim() : "HEAD";
  const rawBase = typeof body.base === "string" && body.base.trim() ? body.base.trim() : undefined;
  const context =
    typeof body.context === "number" && body.context >= 0 ? Math.floor(body.context) : 3;
  const maxFiles =
    typeof body.maxFiles === "number" && body.maxFiles > 0 ? Math.floor(body.maxFiles) : 300;
  const includeHunks = body.includeHunks !== false;
  const session = typeof body.session === "string" ? body.session : undefined;

  if (!isValidRef(head) || (rawBase && !isValidRef(rawBase))) {
    return NextResponse.json({ error: "Invalid ref" }, { status: 400 });
  }

  try {
    const safeRoot = safeRepoRoot(repoPath);

    const base = rawBase ?? resolveBase(safeRoot, head);
    if (!base) {
      return NextResponse.json(
        { error: "No base branch — could not resolve a ref to diff against" },
        { status: 409 }
      );
    }

    const response = computeDiff({
      safeRoot,
      base,
      head,
      session,
      context,
      maxFiles,
      includeHunks,
    });
    return NextResponse.json(response);
  } catch (err) {
    return sanitizeDiffError(err);
  }
}

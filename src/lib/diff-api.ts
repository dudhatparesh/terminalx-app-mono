/**
 * Shared helpers for the diff API routes. Centralizes sandbox confinement and
 * sanitized error mapping so POST /api/diffs and the session-scoped diff routes
 * agree on behavior. Mirrors the error mapping in src/app/api/files/route.ts so
 * filesystem paths never leak.
 */
import { NextResponse } from "next/server";
import { assertNotSensitivePath, resolveSafePath } from "@/lib/file-service";

/**
 * Confine a requested repo path to the sandbox (TERMINUS_ROOT) and reject
 * sensitive paths (.git/.ssh/.env/...). Throws on violation; the caller maps
 * the throw to a sanitized 403 via sanitizeDiffError.
 */
export function safeRepoRoot(repoPath: string): string {
  const safe = resolveSafePath(repoPath);
  assertNotSensitivePath(safe);
  return safe;
}

/** Reject ref strings that could be interpreted as git options or shell-unsafe. */
export function isValidRef(ref: string): boolean {
  if (!ref || ref.length > 256) return false;
  if (ref.startsWith("-")) return false; // never let a ref masquerade as a git flag
  // Allow the usual ref characters plus range/relative selectors used here.
  return /^[A-Za-z0-9._/~^@{}:!+-]+(\.\.\.?[A-Za-z0-9._/~^@{}:!+-]+)?$/.test(ref);
}

/** Map a thrown error to a sanitized NextResponse, never leaking paths. spec §11. */
export function sanitizeDiffError(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("outside the allowed root") || message.includes("sensitive path")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (message.includes("ENOENT") || message.includes("no such file")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    message.includes("ETIMEDOUT") ||
    message.includes("maxBuffer") ||
    message.includes("timed out")
  ) {
    return NextResponse.json({ error: "Failed to compute diff" }, { status: 500 });
  }
  // git "unknown revision" / "bad revision" etc.
  if (
    message.includes("unknown revision") ||
    message.includes("bad revision") ||
    message.includes("ambiguous argument")
  ) {
    return NextResponse.json({ error: "Invalid ref" }, { status: 400 });
  }
  return NextResponse.json({ error: "Failed to compute diff" }, { status: 500 });
}

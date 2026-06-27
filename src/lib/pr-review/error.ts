// Sanitized error mapping for the PR-review routes (spec §6, §10). Maps a thrown
// GitHubAPIError (issue #7 taxonomy) — or any error — to a user-safe NextResponse
// that never leaks tokens or filesystem paths. Critically, GitHub's own 401
// (token expired/revoked) is surfaced as 403 "Reconnect GitHub in settings",
// because the repo uses 403 throughout and NEVER returns 401 (§9).

import { NextResponse } from "next/server";
import { GitHubErrorCode, type GitHubAPIError } from "../github/types";
import { isGitHubAPIError } from "../github/client";

export function sanitizeGitHubError(err: unknown): NextResponse {
  if (isGitHubAPIError(err)) {
    const e = err as GitHubAPIError;
    switch (e.code) {
      case GitHubErrorCode.AUTHENTICATION_FAILED:
      case GitHubErrorCode.TOKEN_EXPIRED:
      case GitHubErrorCode.TOKEN_REVOKED:
        // NEVER 401 — the repo answers 403 everywhere.
        return NextResponse.json({ error: "Reconnect GitHub in settings" }, { status: 403 });
      case GitHubErrorCode.FORBIDDEN:
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      case GitHubErrorCode.NOT_FOUND:
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      case GitHubErrorCode.VALIDATION_ERROR:
        // Surface GitHub's validation message (branch protection, head==base,
        // etc.) — it's user-facing and carries no secrets.
        return NextResponse.json(
          { error: e.message || "GitHub rejected the request" },
          { status: 422 }
        );
      case GitHubErrorCode.RATE_LIMIT_EXCEEDED:
      case GitHubErrorCode.SECONDARY_RATE_LIMIT:
        return NextResponse.json(
          { error: "GitHub rate limit reached — try again shortly" },
          {
            status: 429,
          }
        );
      default:
        return NextResponse.json({ error: "GitHub request failed" }, { status: 502 });
    }
  }

  // A non-GitHub error (binding/lookup/etc.) — map the few we can, hide paths.
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("invalid session name")) {
    return NextResponse.json({ error: "Invalid session name" }, { status: 400 });
  }
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}

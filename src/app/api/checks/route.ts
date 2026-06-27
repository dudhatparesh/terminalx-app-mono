// GET /api/checks — the single status-aggregation endpoint for the Checks tab
// (checks-dashboard.spec.md §3). Owns short-TTL caching + rate-limit protection so
// the panel can poll cheaply. Informational states (no-repo / no-pr / none / no-auth)
// return 200; genuine request failures return the richer { status, code, ... } envelope.
//
// Auth model: 401 is reserved for unauthenticated TerminalX *sessions*. Data/scoping
// routes use 403 for access denial; "no GitHub token" is a 200 informational state.
import { NextRequest, NextResponse } from "next/server";
import { canAccessSession, getUserScoping } from "@/lib/session-scope";
import { getMeta } from "@/lib/ai-sessions";
import { getGitDirectoryInfo } from "@/lib/git-worktree";
import { buildChecksView, emptyView, hasGitHubToken } from "@/lib/checks/aggregate";
import { cacheKeyFor, checksCache } from "@/lib/checks/cache";
import { categoryForCode, isGitHubAPIError } from "@/lib/github/client";
import { ErrorCategory, GitHubErrorCode } from "@/lib/github/types";

function ok(data: import("@/types/checks").ChecksView) {
  return NextResponse.json({ status: "success", data });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionName = searchParams.get("sessionName")?.trim();
  const force = searchParams.get("force") === "true";

  if (!sessionName) {
    return NextResponse.json(
      { status: "error", code: "INVALID_REQUEST", message: "sessionName is required" },
      { status: 400 }
    );
  }

  const { username, role, shouldScope } = getUserScoping(req.headers);
  if (shouldScope && role !== "admin" && !canAccessSession(username, role, sessionName)) {
    return NextResponse.json(
      { status: "error", code: "FORBIDDEN", message: "Session not accessible" },
      { status: 403 }
    );
  }

  const meta = getMeta(sessionName);
  const dir = meta?.worktree?.path ?? meta?.cwd;
  const gitInfo = dir ? getGitDirectoryInfo(dir) : { isRepo: false as const };

  if (!gitInfo.isRepo || !gitInfo.root) {
    return ok(emptyView(sessionName, "no-repo", "Session directory is not a git repository"));
  }

  // No GitHub token for this repo is an *informational* state (like no-repo/no-pr),
  // not a 401 — TerminalX reserves 401 for unauthenticated sessions, not config gaps.
  if (!hasGitHubToken(gitInfo.root)) {
    return ok(emptyView(sessionName, "error", "no-auth", { branch: gitInfo.branch ?? null }));
  }

  const key = cacheKeyFor(gitInfo.root, gitInfo.branch ?? "HEAD");

  if (!force) {
    const hit = checksCache.get(key);
    if (hit && !hit.stale) return ok(hit);
  }

  try {
    const view = await buildChecksView({ sessionName, gitInfo });
    checksCache.set(key, view);
    // Return the freshly-cached projection so freshness metadata is consistent.
    return ok(checksCache.get(key) ?? view);
  } catch (err) {
    return handleChecksError(err, key);
  }
}

/** Map a GitHub client failure to 429/502 + a stale cached view when present. */
function handleChecksError(err: unknown, key: string): NextResponse {
  const stale = checksCache.peekStale(key);

  if (isGitHubAPIError(err)) {
    const category = categoryForCode(err.code);
    const rateLimited =
      category === ErrorCategory.RATE_LIMITED || err.code === GitHubErrorCode.SECONDARY_RATE_LIMIT;

    if (rateLimited) {
      return NextResponse.json(
        {
          status: "error",
          code: "RATE_LIMITED",
          retryAfter: err.retryAfter ?? 1800,
          cached: Boolean(stale),
          data: stale ?? undefined,
        },
        { status: 429 }
      );
    }
  }

  // Everything else (upstream 5xx, network, timeout, expired/revoked token) →
  // 502 with stale cache if present (§3.1, §7 expired-token row).
  return NextResponse.json(
    {
      status: "error",
      code: "UPSTREAM_ERROR",
      message: err instanceof Error ? err.message : "Upstream GitHub error",
      cached: Boolean(stale),
      data: stale ?? undefined,
    },
    { status: 502 }
  );
}

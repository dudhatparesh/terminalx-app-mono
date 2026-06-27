// GET /api/sessions/[name]/review — the Review-tab payload (spec §6.1).
//
// Resolves the session's PR via resolvePRForSession, composes the GitHub review
// summary with the session's local drafts/resolution state into a ReviewTabModel.
// Session-scoped (403, never 401); delegates ALL GitHub calls to the shared
// GitHubAPI — this route never instantiates a client directly.
import { NextRequest, NextResponse } from "next/server";
import { getMeta } from "@/lib/ai-sessions";
import { resolvePRForSession } from "@/lib/github/session-link";
import { buildModel, getSessionDrafts } from "@/lib/pr-review/drafts";
import {
  getGitHubApiForRepo,
  resolveRepoBinding,
  resolveSessionRepo,
} from "@/lib/pr-review/repo-binding";
import { sanitizeGitHubError } from "@/lib/pr-review/error";
import { guardSessionRoute } from "@/lib/pr-review/route-guard";
import type { ReviewTabModel } from "@/types/pr-review";

const EMPTY = (
  draftCount: number,
  headBranch: string,
  defaultBase: string,
  unbound = false
): ReviewTabModel => ({
  pr: null,
  decision: "pending",
  reviews: [],
  byFile: [],
  draftCount,
  unbound,
  headBranch,
  defaultBase,
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name: rawName } = await ctx.params;
  const guard = guardSessionRoute(req.headers, rawName);
  if (!guard.ok) return guard.response;
  const { name } = guard;

  const meta = getMeta(name);
  // A worktree-backed session carries repo+branch in meta; a session merely
  // rooted at a checkout resolves them from its cwd so the Review tab still
  // renders inline (spec §6.1) instead of 404-ing.
  const repo = resolveSessionRepo(meta);
  if (!meta || !repo) {
    return NextResponse.json({ error: "Session has no git repository" }, { status: 404 });
  }
  const { repoRoot, headBranch } = repo;

  // Repo not bound to a GitHub integration → no PR possible; show "Connect this repo".
  const binding = await resolveRepoBinding(repoRoot);
  if (!binding) {
    return NextResponse.json(EMPTY(getSessionDrafts(name).length, headBranch, "main", true));
  }

  try {
    const api = getGitHubApiForRepo(binding);
    const link = await resolvePRForSession(api, binding.owner, binding.repo, meta);
    if (!link.pr) {
      return NextResponse.json(
        EMPTY(getSessionDrafts(name).length, headBranch, binding.defaultBranch)
      );
    }
    const summary = await api.reviewAggregate.getReviewSummary(
      binding.owner,
      binding.repo,
      link.pr.number
    );
    return NextResponse.json({
      ...buildModel(name, link.pr, summary),
      headBranch,
      defaultBase: binding.defaultBranch,
    });
  } catch (err) {
    return sanitizeGitHubError(err);
  }
}

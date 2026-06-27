// POST /api/sessions/[name]/pr — create a PR for the session's worktree branch
// (spec §5, §6.3). Validates head/base server-side (validateGitBranchName,
// head !== base) BEFORE the network call, then delegates to the shared
// GitHubAPI.createPullRequest — this route never instantiates a client by hand.
// Reviewers are requested separately (createPullRequest doesn't apply them).
// Returns the new PullRequestView. Session-scoped (403, never 401).
import { NextRequest, NextResponse } from "next/server";
import { getMeta } from "@/lib/ai-sessions";
import { validateGitBranchName } from "@/lib/git-worktree";
import { toPullRequestView } from "@/lib/github/derive";
import {
  getGitHubApiForRepo,
  resolveRepoBinding,
  resolveSessionRepo,
} from "@/lib/pr-review/repo-binding";
import { sanitizeGitHubError } from "@/lib/pr-review/error";
import { guardSessionRoute } from "@/lib/pr-review/route-guard";

interface CreatePrBody {
  title?: string;
  body?: string;
  base?: string;
  head?: string;
  draft?: boolean;
  reviewers?: string[];
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name: rawName } = await ctx.params;
  const guard = guardSessionRoute(req.headers, rawName);
  if (!guard.ok) return guard.response;
  const { name } = guard;

  const meta = getMeta(name);
  const repo = resolveSessionRepo(meta);

  let body: CreatePrBody;
  try {
    body = (await req.json()) as CreatePrBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = body.title?.trim() ?? "";
  if (!title) {
    return NextResponse.json({ error: "A title is required" }, { status: 400 });
  }
  if (title.length > 256) {
    return NextResponse.json(
      { error: "Title exceeds GitHub's 256-character limit" },
      { status: 400 }
    );
  }

  // head defaults to (and is fixed to) the session's branch when known.
  const headRaw = body.head?.trim() || repo?.headBranch || "";
  const baseRaw = body.base?.trim() ?? "";
  let head: string;
  let base: string;
  try {
    head = validateGitBranchName(headRaw);
    base = validateGitBranchName(baseRaw);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid branch name" },
      { status: 400 }
    );
  }
  // Reject head === base BEFORE any worktree/binding/network work (spec §5).
  if (head === base) {
    return NextResponse.json({ error: "Head and base branches must differ" }, { status: 400 });
  }

  // The repo binding is only needed for the actual network create hop —
  // validation above runs offline regardless.
  if (!repo) {
    return NextResponse.json({ error: "Session has no git repository" }, { status: 404 });
  }

  const binding = await resolveRepoBinding(repo.repoRoot);
  if (!binding) {
    return NextResponse.json(
      { error: "This repo isn't connected to a GitHub integration" },
      { status: 400 }
    );
  }

  const reviewers = Array.isArray(body.reviewers)
    ? body.reviewers.map((r) => String(r).trim()).filter(Boolean)
    : [];

  try {
    const api = getGitHubApiForRepo(binding);
    const pr = await api.pulls.createPullRequest(binding.owner, binding.repo, {
      title,
      body: body.body ?? "",
      head,
      base,
      draft: Boolean(body.draft),
    });
    // Request reviewers separately — createPullRequest doesn't apply them (§7.2).
    if (reviewers.length > 0) {
      await api.reviews
        .requestReviewers(binding.owner, binding.repo, pr.number, { reviewers })
        .catch(() => {
          // A bad reviewer login shouldn't fail the whole create; the PR exists.
        });
    }
    return NextResponse.json(toPullRequestView(pr), { status: 201 });
  } catch (err) {
    return sanitizeGitHubError(err);
  }
}

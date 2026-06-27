// POST /api/sessions/[name]/review/submit — submit the batched review (spec §6.4).
//
// Reads the session's drafts: posts NEW-thread line comments + the overall review
// via createReview(...), posts REPLY drafts (inReplyToId set) via
// replyToReviewComment(...), clears the successfully-submitted drafts, and returns
// the refreshed ReviewTabModel. On partial failure, rejected drafts are KEPT with
// a per-draft error and the rest cleared (§10). Session-scoped (403, never 401);
// delegates all GitHub calls to the shared GitHubAPI.
import { NextRequest, NextResponse } from "next/server";
import { getMeta } from "@/lib/ai-sessions";
import { resolvePRForSession } from "@/lib/github/session-link";
import { buildModel, clearDrafts, getSessionDrafts } from "@/lib/pr-review/drafts";
import { getGitHubApiForRepo, resolveRepoBinding } from "@/lib/pr-review/repo-binding";
import { sanitizeGitHubError } from "@/lib/pr-review/error";
import { guardSessionRoute } from "@/lib/pr-review/route-guard";

const EVENTS = new Set(["COMMENT", "APPROVE", "REQUEST_CHANGES"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name: rawName } = await ctx.params;
  const guard = guardSessionRoute(req.headers, rawName);
  if (!guard.ok) return guard.response;
  const { name } = guard;

  const meta = getMeta(name);
  if (!meta?.worktree) {
    return NextResponse.json({ error: "Session has no worktree" }, { status: 404 });
  }

  let body: { event?: string; body?: string };
  try {
    body = (await req.json()) as { event?: string; body?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const event = (body.event ?? "COMMENT") as "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  if (!EVENTS.has(event)) {
    return NextResponse.json({ error: "Invalid review event" }, { status: 400 });
  }

  const binding = await resolveRepoBinding(meta.worktree.repoRoot);
  if (!binding) {
    return NextResponse.json(
      { error: "This repo isn't connected to a GitHub integration" },
      { status: 400 }
    );
  }

  try {
    const api = getGitHubApiForRepo(binding);
    const link = await resolvePRForSession(api, binding.owner, binding.repo, meta);
    if (!link.pr) {
      return NextResponse.json({ error: "No pull request for this branch" }, { status: 404 });
    }
    const prNumber = link.pr.number;

    const drafts = getSessionDrafts(name);
    const newThreadDrafts = drafts.filter((d) => d.inReplyToId == null);
    const replyDrafts = drafts.filter((d) => d.inReplyToId != null);

    const submittedIds: string[] = [];
    const rejected: Array<{ id: string; error: string }> = [];

    // 1. Batch new-thread line comments + the overall review into one createReview.
    if (newThreadDrafts.length > 0 || event !== "COMMENT" || (body.body ?? "").trim()) {
      try {
        await api.reviews.createReview(binding.owner, binding.repo, prNumber, {
          body: body.body ?? "",
          event,
          comments: newThreadDrafts.map((d) => ({ path: d.path, line: d.line, body: d.body })),
        });
        for (const d of newThreadDrafts) submittedIds.push(d.id);
      } catch (err) {
        // The whole batch was rejected — keep every new-thread draft with an error.
        const msg = err instanceof Error ? err.message : "rejected";
        for (const d of newThreadDrafts) rejected.push({ id: d.id, error: msg });
      }
    }

    // 2. Reply drafts post one-by-one — a single bad reply mustn't sink the rest.
    for (const d of replyDrafts) {
      try {
        await api.reviews.replyToReviewComment(
          binding.owner,
          binding.repo,
          prNumber,
          d.inReplyToId!,
          d.body
        );
        submittedIds.push(d.id);
      } catch (err) {
        rejected.push({ id: d.id, error: err instanceof Error ? err.message : "rejected" });
      }
    }

    // 3. Clear what posted; rejected drafts are kept for the user to retry.
    if (submittedIds.length > 0) await clearDrafts(name, submittedIds);

    const summary = await api.reviewAggregate.getReviewSummary(
      binding.owner,
      binding.repo,
      prNumber
    );
    return NextResponse.json({
      ...buildModel(name, link.pr, summary),
      submitted: submittedIds.length,
      rejected,
    });
  } catch (err) {
    return sanitizeGitHubError(err);
  }
}

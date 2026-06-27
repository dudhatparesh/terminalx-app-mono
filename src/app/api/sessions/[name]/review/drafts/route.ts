// GET /api/sessions/[name]/review/drafts — the session's local draft comments +
// pending review (spec §6.2). Server-persisted (data/pr-review/<session>.json),
// no GitHub call. Session-scoped (403, never 401).
import { NextRequest, NextResponse } from "next/server";
import { getDraftReview, getSessionDrafts } from "@/lib/pr-review/drafts";
import { guardSessionRoute } from "@/lib/pr-review/route-guard";

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name: rawName } = await ctx.params;
  const guard = guardSessionRoute(req.headers, rawName);
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    drafts: getSessionDrafts(guard.name),
    draftReview: getDraftReview(guard.name),
  });
}

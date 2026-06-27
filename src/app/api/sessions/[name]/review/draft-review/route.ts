// PUT /api/sessions/[name]/review/draft-review — set the pending review
// summary/event (spec §6.2). Server-persisted, no GitHub call. The actual
// submission happens at POST …/review/submit (§6.4). Session-scoped (403, never 401).
import { NextRequest, NextResponse } from "next/server";
import { setDraftReview } from "@/lib/pr-review/drafts";
import { guardSessionRoute } from "@/lib/pr-review/route-guard";

const EVENTS = new Set(["COMMENT", "APPROVE", "REQUEST_CHANGES"]);

export async function PUT(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name: rawName } = await ctx.params;
  const guard = guardSessionRoute(req.headers, rawName);
  if (!guard.ok) return guard.response;

  let body: { body?: string; event?: string };
  try {
    body = (await req.json()) as { body?: string; event?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const event = body.event ?? "COMMENT";
  if (!EVENTS.has(event)) {
    return NextResponse.json({ error: "Invalid review event" }, { status: 400 });
  }
  const saved = await setDraftReview(guard.name, {
    body: typeof body.body === "string" ? body.body : "",
    event: event as "COMMENT" | "APPROVE" | "REQUEST_CHANGES",
  });
  return NextResponse.json(saved);
}

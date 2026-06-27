// POST /api/sessions/[name]/review/resolve — flip a thread's resolved flag
// (spec §4.3). This is TerminalX-tracked ONLY and is NEVER posted to GitHub
// (GitHub's REST API doesn't expose review-thread resolution). Session-scoped
// (403, never 401), server-persisted alongside the session's drafts.
import { NextRequest, NextResponse } from "next/server";
import { setThreadResolved } from "@/lib/pr-review/drafts";
import { guardSessionRoute } from "@/lib/pr-review/route-guard";

export async function POST(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name: rawName } = await ctx.params;
  const guard = guardSessionRoute(req.headers, rawName);
  if (!guard.ok) return guard.response;

  let body: { key?: string; resolved?: boolean };
  try {
    body = (await req.json()) as { key?: string; resolved?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.key !== "string" || !body.key) {
    return NextResponse.json({ error: "A thread key is required" }, { status: 400 });
  }
  const resolved = await setThreadResolved(guard.name, body.key, Boolean(body.resolved));
  return NextResponse.json({ resolved });
}

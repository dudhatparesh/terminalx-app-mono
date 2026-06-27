// PUT  /api/sessions/[name]/review/drafts/[...id] — upsert a draft comment/reply.
// DELETE /api/sessions/[name]/review/drafts/[...id] — discard a draft.
// Server-persisted, no GitHub call (spec §6.2). Session-scoped (403, never 401).
//
// The draft id is itself a `:`-delimited string that embeds the file path
// (e.g. `draft:<session>:src/index.ts:3:<nonce>`), so it can legitimately contain
// `/`. A catch-all (`[...id]`) segment captures those slashes; we re-join + decode
// the parts back into the opaque id the draft store keys on.
import { NextRequest, NextResponse } from "next/server";
import { discardDraft, upsertDraft } from "@/lib/pr-review/drafts";
import { guardSessionRoute } from "@/lib/pr-review/route-guard";
import type { DraftComment } from "@/types/pr-review";

interface Ctx {
  params: Promise<{ name: string; id: string[] }>;
}

/** Rebuild the original draft id from the catch-all segments. */
function joinId(parts: string[]): string {
  return parts.map((p) => decodeURIComponent(p)).join("/");
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { name: rawName, id: idParts } = await ctx.params;
  const guard = guardSessionRoute(req.headers, rawName);
  if (!guard.ok) return guard.response;
  const id = joinId(idParts);

  let body: Partial<DraftComment>;
  try {
    body = (await req.json()) as Partial<DraftComment>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const path = typeof body.path === "string" ? body.path : "";
  const line = Number(body.line);
  const side = body.side === "LEFT" ? "LEFT" : "RIGHT";
  const text = typeof body.body === "string" ? body.body : "";
  if (!path || !Number.isFinite(line) || line < 1 || !text.trim()) {
    return NextResponse.json(
      { error: "A draft needs a path, a line >= 1, and a non-empty body" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const draft: DraftComment = {
    id,
    sessionName: guard.name,
    path,
    line,
    side,
    inReplyToId: typeof body.inReplyToId === "number" ? body.inReplyToId : undefined,
    body: text,
    createdAt: typeof body.createdAt === "string" ? body.createdAt : now,
    updatedAt: now,
  };
  const saved = await upsertDraft(guard.name, draft);
  return NextResponse.json(saved);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { name: rawName, id: idParts } = await ctx.params;
  const guard = guardSessionRoute(req.headers, rawName);
  if (!guard.ok) return guard.response;
  const removed = await discardDraft(guard.name, joinId(idParts));
  return NextResponse.json({ success: true, removed });
}

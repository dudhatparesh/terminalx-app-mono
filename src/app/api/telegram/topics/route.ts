import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/audit-log";
import { canAccessSession, getUserScoping } from "@/lib/session-scope";
import { ensureTopicForSession } from "@/lib/telegram/bot";
import { getEnsureTopic } from "@/lib/telegram/bot-bridge";
import type { BotIdentity } from "@/lib/telegram/auth";
import type { ViewMode } from "@/lib/telegram/state";

function isViewMode(value: unknown): value is ViewMode {
  return value === "chat" || value === "screen" || value === "off";
}

export async function POST(req: NextRequest) {
  let body: { sessionName?: unknown; viewMode?: unknown };
  try {
    body = (await req.json()) as { sessionName?: unknown; viewMode?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sessionName = typeof body.sessionName === "string" ? body.sessionName.trim() : "";
  if (!sessionName || !/^[a-zA-Z0-9_.\-]+$/.test(sessionName)) {
    return NextResponse.json({ error: "invalid session name" }, { status: 400 });
  }
  if (body.viewMode !== undefined && !isViewMode(body.viewMode)) {
    return NextResponse.json({ error: "viewMode must be chat, screen, or off" }, { status: 400 });
  }
  const viewMode = isViewMode(body.viewMode) ? body.viewMode : undefined;

  const { username, role, shouldScope } = getUserScoping(req.headers);
  if (shouldScope && (!username || !canAccessSession(username, role, sessionName))) {
    return NextResponse.json({ error: "access denied" }, { status: 403 });
  }

  const identity: BotIdentity = {
    username: username ?? "web",
    role: role === "user" ? "user" : "admin",
  };

  try {
    // Prefer the bot instance's implementation so the streamer it spawns is
    // owned by the graph that handles Telegram commands; fall back to the local
    // copy when running without the custom server (e.g. `next dev`).
    const ensure = getEnsureTopic() ?? ensureTopicForSession;
    const result = await ensure(identity, sessionName, viewMode);
    audit("telegram_topic_view_updated", {
      username: username ?? undefined,
      detail: `${sessionName}:${result.topic.viewMode}`,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to prepare Telegram topic";
    const status =
      message === "access denied"
        ? 403
        : message.includes("not managed")
          ? 403
          : message.includes("not found")
            ? 404
            : message.includes("not configured") || message.includes("forum chat configured")
              ? 503
              : message.includes("maximum number")
                ? 429
                : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

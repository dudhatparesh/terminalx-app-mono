import { NextRequest, NextResponse } from "next/server";
import { handleTelegramUpdate } from "@/lib/telegram/bot";

/**
 * Telegram webhook endpoint. Telegram POSTs updates here. Each request must
 * include the `X-Telegram-Bot-Api-Secret-Token` header matching the value we
 * passed to `setWebhook`. We verify it before doing anything else so an
 * attacker can't drive the bot via this URL even though the path is public.
 *
 * Telegram retries on responses slower than ~2 s — we ack 200 immediately
 * and process the update without `await`. Updates are best-effort; loss is
 * preferable to delaying the ack and triggering a duplicate retry.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.TERMINALX_TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "bot not configured" }, { status: 503 });
  }
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  if (got !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let update: object;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Process asynchronously so we can ack within Telegram's 2 s window.
  void handleTelegramUpdate(update).catch((err) => {
    console.error("[telegram/webhook] handleUpdate threw", err);
  });

  return NextResponse.json({ ok: true });
}

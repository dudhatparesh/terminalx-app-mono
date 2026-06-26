// §5.2 Webhook receiver. Validates the GitHub HMAC-SHA256 signature with a
// buffer-guarded, constant-time comparison BEFORE parsing the body, then
// dispatches per X-GitHub-Event. A bad/missing signature => 401 (this is the one
// place 401 is correct: it rejects an unauthenticated GitHub delivery, not a
// TerminalX user — user-facing auth failures elsewhere use 403).
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/github/webhook-signature";
import { getRepositoryRecord } from "@/lib/github/store";
import { decryptToken } from "@/lib/github/crypto";
import { GitHubErrorCode } from "@/lib/github/types";

interface Ctx {
  params: Promise<{ repoId: string }>;
}

/**
 * Resolve the plaintext HMAC secret for a repo. The repo record stores it as a
 * base64 GCM blob ("ciphertext.nonce.salt.tag"); fall back to treating it as a raw
 * secret if it isn't in that encrypted shape (e.g. set directly in tests/dev).
 */
function resolveWebhookSecret(repoId: string): string | null {
  const repo = getRepositoryRecord(repoId);
  if (!repo?.webhookSecret) return null;
  const parts = repo.webhookSecret.split(".");
  if (parts.length === 4) {
    const [ciphertext, nonce, salt, tag] = parts as [string, string, string, string];
    try {
      return decryptToken({ ciphertext, nonce, salt, tag });
    } catch {
      return null;
    }
  }
  return repo.webhookSecret;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { repoId } = await ctx.params;

  // Read the RAW body — the exact bytes GitHub signed.
  const payload = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  const secret = resolveWebhookSecret(repoId);
  if (!secret) {
    return NextResponse.json(
      { error: GitHubErrorCode.CONFIGURATION_ERROR, message: "Unknown or unconfigured repository" },
      { status: 404 }
    );
  }

  if (!verifyWebhookSignature(secret, payload, signature)) {
    return NextResponse.json({ error: GitHubErrorCode.WEBHOOK_VALIDATION_FAILED }, { status: 401 });
  }

  const event = req.headers.get("x-github-event") ?? "unknown";
  let body: unknown;
  try {
    body = payload ? JSON.parse(payload) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // Dispatch. Handlers are intentionally lightweight (audit/log) for the data
  // layer; richer side-effects (notifications) are wired by consumers.
  const action =
    typeof body === "object" && body !== null && "action" in body
      ? (body as { action?: string }).action
      : undefined;
  console.log(`[github-webhook] repo=${repoId} event=${event} action=${action ?? "-"}`);

  return NextResponse.json({ success: true, event });
}

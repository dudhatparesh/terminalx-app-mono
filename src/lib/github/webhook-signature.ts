// §5.2 Webhook HMAC verification.
// GitHub sends `X-Hub-Signature-256: sha256=hex(HMAC-SHA256(secret, payload))`.
// We verify with a constant-time comparison and a length-guard so an
// attacker-controlled signature of a different length returns false instead of
// throwing (crypto.timingSafeEqual throws RangeError on length mismatch).
import * as crypto from "crypto";

/** Compute the `sha256=...` signature header value for a payload + secret. */
export function computeWebhookSignature(secret: string, payload: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Validate a GitHub webhook signature.
 * @param secret    the repo's HMAC-SHA256 secret
 * @param payload   the RAW request body (must be the exact bytes GitHub signed)
 * @param signature the `X-Hub-Signature-256` header value (or null)
 */
export function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string | null | undefined
): boolean {
  if (!secret) return false;
  if (!signature || !signature.startsWith("sha256=")) return false;

  const expected = computeWebhookSignature(secret, payload);

  // Constant-time comparison. timingSafeEqual requires equal-length Buffers and
  // throws on strings / length mismatch, so convert + length-guard first.
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

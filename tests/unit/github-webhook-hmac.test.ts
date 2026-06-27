import { describe, it, expect } from "vitest";
import { computeWebhookSignature, verifyWebhookSignature } from "@/lib/github/webhook-signature";

// §5.2 — buffer-guarded HMAC verification via crypto.timingSafeEqual.
describe("github webhook HMAC verification", () => {
  const secret = "s3cr3t-webhook-key";
  const payload = JSON.stringify({ action: "opened", number: 7 });

  it("accepts a correctly-signed payload", () => {
    const sig = computeWebhookSignature(secret, payload);
    expect(sig.startsWith("sha256=")).toBe(true);
    expect(verifyWebhookSignature(secret, payload, sig)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const sig = computeWebhookSignature(secret, payload);
    expect(verifyWebhookSignature(secret, payload + "x", sig)).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const sig = computeWebhookSignature("wrong-secret", payload);
    expect(verifyWebhookSignature(secret, payload, sig)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature(secret, payload, null)).toBe(false);
    expect(verifyWebhookSignature(secret, payload, undefined)).toBe(false);
  });

  it("rejects a malformed (non sha256=) signature", () => {
    expect(verifyWebhookSignature(secret, payload, "deadbeef")).toBe(false);
    expect(verifyWebhookSignature(secret, payload, "sha1=deadbeef")).toBe(false);
  });

  it("does NOT throw on a different-length signature (length-guard before timingSafeEqual)", () => {
    // crypto.timingSafeEqual throws RangeError on mismatched lengths; the guard
    // must return false instead of throwing — the security-critical behavior.
    expect(() => verifyWebhookSignature(secret, payload, "sha256=abc")).not.toThrow();
    expect(verifyWebhookSignature(secret, payload, "sha256=abc")).toBe(false);
  });

  it("rejects when the secret is empty", () => {
    const sig = computeWebhookSignature(secret, payload);
    expect(verifyWebhookSignature("", payload, sig)).toBe(false);
  });
});

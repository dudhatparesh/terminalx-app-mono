import { NextRequest, NextResponse } from "next/server";
import { getUserScoping } from "@/lib/session-scope";
import { createPairingCode } from "@/lib/pairing";
import { audit } from "@/lib/audit-log";

// POST /api/auth/pairing-codes
// Authenticated (via middleware, cookie or Bearer). Returns a short-lived
// single-use code that a mobile client can redeem at POST /api/auth/pair to
// receive a 24h device-scoped JWT.
export async function POST(req: NextRequest) {
  const { hasIdentity, username, role } = getUserScoping(req.headers);
  if (!hasIdentity) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // In "none"/"password" modes, getUserScoping returns username: null. Bind
  // such codes to a sentinel user id so the issued JWT still validates.
  const userId = req.headers.get("x-user-id") || "single-user";
  const issuedUsername = username ?? "admin";
  const issuedRole = role ?? "admin";

  const { code, expiresAt } = await createPairingCode({
    userId,
    username: issuedUsername,
    role: issuedRole,
  });

  audit("pairing_code_created", { username: issuedUsername });
  return NextResponse.json({ code, expiresAt });
}

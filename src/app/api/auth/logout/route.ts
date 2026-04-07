import { NextRequest, NextResponse } from "next/server";
import { revokeToken } from "@/lib/auth";
import { audit } from "@/lib/audit-log";

export async function POST(req: NextRequest) {
  const username = req.headers.get("x-username");

  // Revoke the current session token before clearing the cookie
  const token = req.cookies.get("terminalx-session")?.value;
  if (token) {
    revokeToken(token);
  }

  audit("logout", { username: username || undefined });

  const res = NextResponse.json({ success: true });
  res.headers.set(
    "Set-Cookie",
    "terminalx-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );
  return res;
}

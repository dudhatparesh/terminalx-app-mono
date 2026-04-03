import { NextRequest, NextResponse } from "next/server";
import { revokeToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  // Revoke the current session token before clearing the cookie
  const token = req.cookies.get("terminalx-session")?.value;
  if (token) {
    revokeToken(token);
  }

  const res = NextResponse.json({ success: true });
  res.headers.set(
    "Set-Cookie",
    "terminalx-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );
  return res;
}

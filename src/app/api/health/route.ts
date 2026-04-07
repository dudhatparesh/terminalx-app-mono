import { NextResponse } from "next/server";

// Public health check — minimal info only. No uptime, no active session counts,
// no timestamps (useful for timing attacks against JWT).
export async function GET() {
  return NextResponse.json({ status: "ok" });
}

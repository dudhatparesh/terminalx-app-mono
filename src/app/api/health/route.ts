import { NextResponse } from "next/server";
import { getActivePtyCount } from "@/lib/pty-manager";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    uptime: process.uptime(),
    activePtys: getActivePtyCount(),
    timestamp: new Date().toISOString(),
  });
}

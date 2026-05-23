import * as fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import {
  assertNotSensitivePath,
  getTerminusRoot,
  listDirectory,
  resolveSafePath,
} from "@/lib/file-service";
import { getUserScoping } from "@/lib/session-scope";

export async function GET(req: NextRequest) {
  const { hasIdentity } = getUserScoping(req.headers);
  if (!hasIdentity) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const requestedPath = req.nextUrl.searchParams.get("path") || ".";

  try {
    const safePath = resolveSafePath(requestedPath);
    assertNotSensitivePath(safePath);
    const stats = fs.statSync(safePath);
    if (!stats.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }

    return NextResponse.json({
      path: safePath,
      root: getTerminusRoot(),
      entries: listDirectory(safePath).filter((entry) => entry.type === "directory"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("outside the allowed root") || message.includes("sensitive path")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (message.includes("ENOENT") || message.includes("no such file")) {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }
    if (message.includes("not a directory")) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }
    console.error("[api/directories GET]", err);
    return NextResponse.json({ error: "Failed to list directories" }, { status: 500 });
  }
}

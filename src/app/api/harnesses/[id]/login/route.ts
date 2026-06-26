import { NextRequest, NextResponse } from "next/server";
// Issue #4: POST /api/harnesses/[id]/login — triggers the "Run <cli> /login"
// affordance by creating a managed tmux session that runs the harness's login
// command in the user's scope (reusing the existing session-creation path so
// the device-flow output is visible). Gated by TERMINUS_READ_ONLY like POST
// /api/sessions.
import { createSession, listSessions } from "@/lib/tmux";
import { getUserScoping, scopedSessionName } from "@/lib/session-scope";
import { saveMeta } from "@/lib/ai-sessions";
import { audit } from "@/lib/audit-log";
import { getHarness } from "@/lib/harnesses/registry";
import { probeHarness } from "@/lib/harnesses/status";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.TERMINUS_READ_ONLY === "true") {
    return NextResponse.json({ error: "Login disabled in read-only mode" }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const harness = getHarness(id);
    if (!harness || harness.auth !== "cli") {
      return NextResponse.json({ error: "Harness does not support CLI login" }, { status: 400 });
    }

    const status = probeHarness(id);
    const loginCommand = status.loginCommand;
    if (!loginCommand) {
      return NextResponse.json({ error: "No login command for harness" }, { status: 400 });
    }

    const { username, hasIdentity } = getUserScoping(req.headers);
    if (!hasIdentity) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const baseName = `login-${id}`;
    const finalName = scopedSessionName(baseName, username);
    // Reuse the standard tmux-keep-alive wrapper so the login flow's output
    // stays visible and the session drops to bash when login completes.
    const command = `bash -lc '${loginCommand}; ec=$?; echo; echo "[${id} login exited with code $ec — dropping to bash]"; exec bash -l'`;

    if (listSessions().some((s) => s.name === finalName)) {
      // Login session already open — just point the UI at it.
      return NextResponse.json({ success: true, name: finalName, existed: true });
    }

    createSession(finalName, command);
    await saveMeta({
      name: finalName,
      kind: id,
      createdAt: new Date().toISOString(),
      createdBy: username || undefined,
      managed: true,
    });
    audit("session_created", {
      username: username || undefined,
      detail: `${finalName} (${id} /login)`,
    });
    return NextResponse.json({ success: true, name: finalName }, { status: 201 });
  } catch (err) {
    console.error("[api/harnesses/[id]/login POST]", err);
    return NextResponse.json({ error: "Failed to start login session" }, { status: 500 });
  }
}

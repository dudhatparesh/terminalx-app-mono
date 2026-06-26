import { NextRequest, NextResponse } from "next/server";
import { getUserScoping, canAccessSession } from "@/lib/session-scope";
import { audit } from "@/lib/audit-log";
import { saveMeta } from "@/lib/ai-sessions";
import { resolveSessionWorkspace, buildExecutionEnv } from "@/lib/workspace-resolve";
import { executeRunScript } from "@/lib/workspace-setup";
import { allocateWorkspacePort } from "@/lib/workspace-port";

interface Ctx {
  params: Promise<{ scriptName: string }>;
}

/**
 * POST /api/workspace/scripts/{scriptName}/execute  body { session }
 * Runs the named run script in a transient streamed session.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  if (process.env.TERMINUS_READ_ONLY === "true") {
    return NextResponse.json(
      { error: "Script execution disabled in read-only mode" },
      { status: 403 }
    );
  }
  const { scriptName } = await ctx.params;
  const { hasIdentity, username, role } = getUserScoping(req.headers);
  if (!hasIdentity) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let body: { session?: string };
  try {
    body = (await req.json()) as { session?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const session = body.session;
  if (!session || typeof session !== "string") {
    return NextResponse.json({ error: "session is required" }, { status: 400 });
  }
  if (!canAccessSession(username, role, session)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const workspace = resolveSessionWorkspace(session);
    if (!workspace) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const script = workspace.config.scripts.find((s) => s.name === scriptName);
    if (!script) {
      return NextResponse.json({ error: `Script "${scriptName}" not found` }, { status: 404 });
    }

    // Ensure the workspace has a stable port (allocate + persist if missing).
    let port = workspace.meta.port;
    if (!port) {
      port = await allocateWorkspacePort();
      await saveMeta({ ...workspace.meta, port });
    }

    const env = buildExecutionEnv(workspace.config, port);
    const { runSessionName } = executeRunScript({
      sessionName: session,
      scriptName,
      cwd: workspace.meta.cwd ?? workspace.repoRoot,
      command: script.command,
      env,
    });

    audit("workspace_script_run", {
      username: username || undefined,
      detail: `${session}/${scriptName}`,
    });
    return NextResponse.json({ success: true, runSession: runSessionName, port }, { status: 201 });
  } catch (err) {
    console.error("[api/workspace/scripts POST]", err);
    const message = err instanceof Error ? err.message : "Failed to run script";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

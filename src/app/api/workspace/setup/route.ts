import { NextRequest, NextResponse } from "next/server";
import { getUserScoping, canAccessSession } from "@/lib/session-scope";
import { audit } from "@/lib/audit-log";
import { saveMeta } from "@/lib/ai-sessions";
import { resolveSessionWorkspace, buildExecutionEnv } from "@/lib/workspace-resolve";
import { runSetup } from "@/lib/workspace-setup";
import { allocateWorkspacePort } from "@/lib/workspace-port";

/**
 * POST /api/workspace/setup  body { session }
 * Manually (re)run the configured setup script for a session's workspace.
 */
export async function POST(req: NextRequest) {
  if (process.env.TERMINUS_READ_ONLY === "true") {
    return NextResponse.json({ error: "Setup disabled in read-only mode" }, { status: 403 });
  }
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
    if (!workspace.config.setup) {
      return NextResponse.json({ error: "No setup script configured" }, { status: 404 });
    }

    let port = workspace.meta.port;
    if (!port) {
      port = await allocateWorkspacePort();
      await saveMeta({ ...workspace.meta, port });
    }
    const env = buildExecutionEnv(workspace.config, port);

    audit("workspace_setup_run", {
      username: username || undefined,
      detail: session,
    });

    // Fire the setup run; do not block the response on completion. The client
    // polls SessionMeta.setup.status via GET /api/sessions.
    const setupName = `${session}--setup`;
    void runSetup({
      sessionName: session,
      cwd: workspace.meta.worktree?.path ?? workspace.meta.cwd ?? workspace.repoRoot,
      command: workspace.config.setup.command,
      env,
      timeoutSeconds: workspace.config.setup.timeoutSeconds ?? 1800,
    });

    return NextResponse.json({ success: true, setupSession: setupName, port }, { status: 202 });
  } catch (err) {
    console.error("[api/workspace/setup POST]", err);
    const message = err instanceof Error ? err.message : "Failed to run setup";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

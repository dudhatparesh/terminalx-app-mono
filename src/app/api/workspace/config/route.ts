import { NextRequest, NextResponse } from "next/server";
import { getUserScoping, canAccessSession } from "@/lib/session-scope";
import { assertNotSensitivePath, resolveSafePath } from "@/lib/file-service";
import { resolveWorkspaceConfig } from "@/lib/workspace-config";
import { resolveSessionWorkspace } from "@/lib/workspace-resolve";

/**
 * GET /api/workspace/config?session=<name> | ?repoRoot=<path>
 *
 * Returns the resolved workspace config (default kind, copy files, env keys,
 * setup, run scripts, provenance, warnings). Returns config — never the
 * contents of copied .env files.
 */
export async function GET(req: NextRequest) {
  const { hasIdentity, username, role } = getUserScoping(req.headers);
  if (!hasIdentity) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const session = req.nextUrl.searchParams.get("session");
  const repoRootParam = req.nextUrl.searchParams.get("repoRoot");

  try {
    let config;
    if (session) {
      if (!canAccessSession(username, role, session)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
      const workspace = resolveSessionWorkspace(session);
      if (!workspace) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      config = workspace.config;
    } else if (repoRootParam) {
      const safe = resolveSafePath(repoRootParam);
      assertNotSensitivePath(safe);
      config = resolveWorkspaceConfig(safe);
    } else {
      return NextResponse.json({ error: "session or repoRoot is required" }, { status: 400 });
    }

    return NextResponse.json({
      hasRepoConfig: config.hasRepoConfig,
      configPath: config.configPath,
      defaultKind: config.defaultKind,
      copyFiles: config.copyFiles,
      env: config.env,
      setup: config.setup,
      scripts: config.scripts,
      provenance: config.provenance,
      warnings: config.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("outside the allowed root") || message.includes("sensitive path")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    console.error("[api/workspace/config GET]", err);
    return NextResponse.json({ error: "Failed to resolve workspace config" }, { status: 500 });
  }
}

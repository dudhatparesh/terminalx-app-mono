// GET/POST /api/projects (issue #12, corrected Project → Workspace model).
//
// A Project is a REPO container. GET returns every registered project WITH its
// workspaces, which are DERIVED from sessions whose SessionMeta.worktree.repoRoot
// matches the project's repoRoot — there is no separate workspace store. Each
// workspace row carries a diff stat (git-diff numstat, agreeing with the Changes
// tab) and a status (merged/open/in-progress/loading) computed best-effort from
// the GitHub layer (#7) + local git state.
//
// POST registers a project for a selected git-repo directory (confined to
// TERMINUS_ROOT). Workspaces are CREATED via the existing POST /api/sessions
// flow — the sidebar "+" opens the new-session dialog scoped to this repo.

import { NextRequest, NextResponse } from "next/server";
import { getUserScoping } from "@/lib/session-scope";
import { audit } from "@/lib/audit-log";
import { listMetadata, type SessionMeta } from "@/lib/ai-sessions";
import { listProjects, registerProject, ProjectError } from "@/lib/projects/store";
import { resolveWorkspace } from "@/lib/projects/resolve";
import { sessionsForProject, toWorkspaceView, toProjectView } from "@/lib/projects/derive";
import { autoArchiveMergedWorktrees } from "@/lib/auto-archive";
import type { ProjectView } from "@/types/project";
import type { PullRequestStatus } from "@/lib/github/types";

export async function GET(req: NextRequest) {
  const { hasIdentity } = getUserScoping(req.headers);
  if (!hasIdentity) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const projects = listProjects();
    const sessions = listMetadata();

    // Capture each workspace's resolved PR status so the auto-archive trigger can
    // reuse it (no extra GitHub calls). Keyed by session name.
    const prStatusByName = new Map<string, PullRequestStatus | undefined>();

    const views: ProjectView[] = await Promise.all(
      projects.map(async (proj) => {
        const wsSessions = sessionsForProject(proj, sessions);
        const workspaces = await Promise.all(
          wsSessions.map(async (meta: SessionMeta) => {
            // Best-effort: resolveWorkspace never throws; a failed diff/PR lookup
            // yields a zero stat / no PR so the row degrades to "in-progress".
            const resolved = await resolveWorkspace(meta);
            prStatusByName.set(meta.name, resolved.prStatus);
            return toWorkspaceView(meta, resolved);
          })
        );
        return toProjectView(proj, workspaces);
      })
    );

    // Auto-archive trigger (issue #9): any workspace whose PR is merged is
    // archived best-effort, reusing the PR status already resolved above so this
    // adds no network calls. Fire-and-forget — the next refresh reflects it.
    void autoArchiveMergedWorktrees({
      resolvePrStatus: async (meta) => prStatusByName.get(meta.name),
    }).catch(() => {
      // Never let auto-archive affect the GET response.
    });

    return NextResponse.json({ projects: views });
  } catch (err) {
    console.error("[api/projects GET]", err);
    return NextResponse.json({ error: "Failed to list projects" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (process.env.TERMINUS_READ_ONLY === "true") {
    return NextResponse.json(
      { error: "Project registration disabled in read-only mode" },
      { status: 403 }
    );
  }

  const { hasIdentity, username } = getUserScoping(req.headers);
  if (!hasIdentity) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let body: { directory?: unknown; name?: unknown };
  try {
    body = (await req.json()) as { directory?: unknown; name?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const directory = typeof body.directory === "string" ? body.directory.trim() : "";
  if (!directory) {
    return NextResponse.json({ error: "A repository directory is required" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name : undefined;

  try {
    const project = await registerProject({ directory, name });
    audit("project_registered", {
      username: username || undefined,
      detail: `${project.name} (${project.repoRoot})`,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/projects POST]", err);
    return NextResponse.json({ error: "Failed to register project" }, { status: 500 });
  }
}

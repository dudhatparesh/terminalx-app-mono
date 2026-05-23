import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import { listSessions, createSession, killSession } from "@/lib/tmux";
import { getUserScoping, canAccessSession, scopedSessionName } from "@/lib/session-scope";
import { audit } from "@/lib/audit-log";
import {
  listMetadata,
  saveMeta,
  deleteMeta,
  commandForKind,
  isValidKind,
  ensureManagedSession,
} from "@/lib/ai-sessions";
import { listTopics } from "@/lib/telegram/state";
import { botIsConfigured, type BotIdentity } from "@/lib/telegram/auth";
import { ensureTopicForSession } from "@/lib/telegram/bot";
import { getEnsureTopic } from "@/lib/telegram/bot-bridge";
import { getConfiguredMaxSessions } from "@/lib/security-config";
import { assertNotSensitivePath, resolveSafePath } from "@/lib/file-service";
import { createGitWorktreeForSession, removeGitWorktree } from "@/lib/git-worktree";

function resolveSessionStartDir(requestedCwd: unknown): string {
  const requested =
    typeof requestedCwd === "string" && requestedCwd.trim() ? requestedCwd.trim() : ".";
  const startDir = resolveSafePath(requested);
  assertNotSensitivePath(startDir);
  const stats = fs.statSync(startDir);
  if (!stats.isDirectory()) {
    throw new Error("Path is not a directory");
  }
  return startDir;
}

function directoryErrorResponse(message: string): { error: string; status: number } {
  if (message.includes("outside the allowed root") || message.includes("sensitive path")) {
    return { error: "Access denied", status: 403 };
  }
  if (message.includes("ENOENT") || message.includes("no such file")) {
    return { error: "Directory not found", status: 404 };
  }
  if (message.includes("not a directory")) {
    return { error: "Path is not a directory", status: 400 };
  }
  return { error: "Invalid start directory", status: 400 };
}

export async function GET(req: NextRequest) {
  try {
    const { username, shouldScope } = getUserScoping(req.headers);
    let sessions = listSessions();

    if (shouldScope && !username) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (shouldScope && username) {
      sessions = sessions.filter((s) => canAccessSession(username, "user", s.name));
    }

    const metadata = listMetadata();
    const byName = new Map(metadata.map((m) => [m.name, m]));
    const telegramByName = new Map(listTopics().map((t) => [t.sessionName, t]));
    const annotated = sessions.map((s) => {
      const meta = byName.get(s.name);
      const telegram = telegramByName.get(s.name);
      return {
        ...s,
        kind: meta?.kind ?? "bash",
        cwd: meta?.cwd ?? s.activePath,
        worktree: meta?.worktree,
        managed: ensureManagedSession(s.name),
        telegram: telegram
          ? {
              topicId: telegram.topicId,
              viewMode: telegram.viewMode ?? "chat",
              endedAtMs: telegram.endedAtMs,
            }
          : null,
      };
    });

    return NextResponse.json({ sessions: annotated });
  } catch (err) {
    console.error("[api/sessions GET]", err);
    return NextResponse.json({ error: "Failed to list sessions" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (process.env.TERMINUS_READ_ONLY === "true") {
    return NextResponse.json(
      { error: "Session creation disabled in read-only mode" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { name, kind, dangerouslySkipPermissions, cwd, worktree } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Missing or invalid session name" }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9_.\-]+$/.test(name)) {
      return NextResponse.json(
        { error: "Invalid session name: only alphanumeric, underscore, hyphen, and dot allowed" },
        { status: 400 }
      );
    }

    const sessionKind = kind === undefined ? "bash" : kind;
    if (!isValidKind(sessionKind)) {
      return NextResponse.json(
        { error: "Invalid session kind: expected bash, claude, or codex" },
        { status: 400 }
      );
    }

    const { username, role, hasIdentity } = getUserScoping(req.headers);
    if (!hasIdentity) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const finalName = scopedSessionName(name, username);
    const maxSessions = getConfiguredMaxSessions();
    if (listSessions().filter((s) => ensureManagedSession(s.name)).length >= maxSessions) {
      return NextResponse.json(
        { error: `Maximum number of sessions reached (${maxSessions})` },
        { status: 429 }
      );
    }

    const command = commandForKind(sessionKind, {
      dangerouslySkipPermissions: Boolean(dangerouslySkipPermissions),
    });

    let startDir: string;
    let createdWorktree:
      | {
          repoRoot: string;
          worktreePath: string;
          startDir: string;
          branch: string;
        }
      | undefined;
    try {
      startDir = resolveSessionStartDir(cwd);
      if (worktree?.create === true) {
        createdWorktree = createGitWorktreeForSession(startDir, worktree.branch);
        startDir = createdWorktree.startDir;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const { error, status } = directoryErrorResponse(message);
      return NextResponse.json({ error: worktree?.create === true ? message : error }, { status });
    }

    try {
      createSession(finalName, command ?? undefined, startDir);
    } catch (err) {
      if (createdWorktree) {
        removeGitWorktree(createdWorktree.worktreePath, createdWorktree.repoRoot);
      }
      throw err;
    }

    await saveMeta({
      name: finalName,
      kind: sessionKind,
      createdAt: new Date().toISOString(),
      createdBy: username || undefined,
      managed: true,
      cwd: startDir,
      worktree: createdWorktree
        ? {
            repoRoot: createdWorktree.repoRoot,
            path: createdWorktree.worktreePath,
            branch: createdWorktree.branch,
          }
        : undefined,
    });
    let telegramTopic: {
      topicId: number;
      sessionName: string;
      viewMode: string;
      url: string;
      created: boolean;
    } | null = null;
    if (botIsConfigured()) {
      const identity: BotIdentity = {
        username: username ?? "web",
        role: role === "user" ? "user" : "admin",
      };
      try {
        // Attach in the bot-owning graph so its streamer has a single owner.
        const ensure = getEnsureTopic() ?? ensureTopicForSession;
        const result = await ensure(identity, finalName, "off");
        telegramTopic = result.topic;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[telegram] failed to bind web-created session ${finalName}: ${message}`);
      }
    }
    audit("session_created", {
      username: username || undefined,
      detail: `${finalName} (${sessionKind})`,
    });
    return NextResponse.json(
      {
        success: true,
        name: finalName,
        kind: sessionKind,
        cwd: startDir,
        worktree: createdWorktree
          ? {
              repoRoot: createdWorktree.repoRoot,
              path: createdWorktree.worktreePath,
              branch: createdWorktree.branch,
            }
          : undefined,
        telegram: telegramTopic,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[api/sessions POST]", err);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (process.env.TERMINUS_READ_ONLY === "true") {
    return NextResponse.json(
      { error: "Session deletion disabled in read-only mode" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { name } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Missing or invalid session name" }, { status: 400 });
    }

    const { username, role, shouldScope } = getUserScoping(req.headers);

    if (shouldScope && (!username || !canAccessSession(username, role, name))) {
      return NextResponse.json({ error: "Cannot delete another user's session" }, { status: 403 });
    }

    if (!ensureManagedSession(name)) {
      return NextResponse.json(
        { error: "Refusing to delete a tmux session not managed by TerminalX" },
        { status: 403 }
      );
    }

    killSession(name);
    await deleteMeta(name);
    audit("session_deleted", { username: username || undefined, detail: name });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/sessions DELETE]", err);
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}

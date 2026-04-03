import { NextRequest, NextResponse } from "next/server";
import {
  listSessions,
  createSession,
  killSession,
} from "@/lib/tmux";
import { getAuthMode } from "@/lib/auth-config";

function getUserScoping(req: NextRequest): {
  username: string | null;
  role: string | null;
  shouldScope: boolean;
} {
  const authMode = getAuthMode();
  if (authMode === "none" || authMode === "password") {
    return { username: null, role: "admin", shouldScope: false };
  }

  const username = req.headers.get("x-username");
  const role = req.headers.get("x-user-role");
  return {
    username,
    role,
    shouldScope: role === "user",
  };
}

function prefixSessionName(name: string, username: string | null): string {
  if (!username) return name;
  return `${username}-${name}`;
}

export async function GET(req: NextRequest) {
  try {
    const { username, shouldScope } = getUserScoping(req);
    let sessions = listSessions();

    if (shouldScope && username) {
      // Non-admin users only see their own sessions (prefixed with username-)
      const prefix = `${username}-`;
      sessions = sessions.filter((s: any) => {
        const name = typeof s === "string" ? s : s.name;
        return name.startsWith(prefix);
      });
    }

    return NextResponse.json({ sessions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid session name" },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9_.\-]+$/.test(name)) {
      return NextResponse.json(
        { error: "Invalid session name: only alphanumeric, underscore, hyphen, and dot allowed" },
        { status: 400 }
      );
    }

    const { username, shouldScope } = getUserScoping(req);
    const authMode = getAuthMode();

    // In local/oauth mode, prefix session names with username
    let finalName = name;
    if ((authMode === "local" || authMode === "oauth") && username) {
      finalName = prefixSessionName(name, username);
    }

    createSession(finalName);
    return NextResponse.json({ success: true, name: finalName }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { name } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid session name" },
        { status: 400 }
      );
    }

    const { username, role, shouldScope } = getUserScoping(req);

    // Non-admin users can only delete their own sessions
    if (shouldScope && username) {
      const prefix = `${username}-`;
      if (!name.startsWith(prefix)) {
        return NextResponse.json(
          { error: "Cannot delete another user's session" },
          { status: 403 }
        );
      }
    }

    killSession(name);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

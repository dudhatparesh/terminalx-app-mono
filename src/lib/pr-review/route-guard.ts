// Shared session-scope guard for the PR-review routes (spec §6). Mirrors the
// verified DELETE /api/sessions/[name] pattern exactly: scope only when
// multi-user mode requires it, answer 403 (NEVER 401), validate the session name.
// SERVER-ONLY (pulls session-scope which is browser-unsafe by convention).

import { NextResponse } from "next/server";
import { canAccessSession, getUserScoping } from "../session-scope";

const SESSION_NAME_RE = /^[a-zA-Z0-9_.-]+$/;

export interface GuardOk {
  ok: true;
  name: string;
  username: string | null;
  role: string | null;
}
export interface GuardFail {
  ok: false;
  response: NextResponse;
}

/**
 * Validate + authorize a session-scoped request. On success returns the decoded
 * name and the caller's identity; on failure returns the NextResponse to send.
 */
export function guardSessionRoute(
  headers: { get(name: string): string | null },
  rawName: string
): GuardOk | GuardFail {
  const name = decodeURIComponent(rawName);
  if (!name || !SESSION_NAME_RE.test(name)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid session name" }, { status: 400 }),
    };
  }
  const { username, role, shouldScope } = getUserScoping(headers);
  if (shouldScope && (!username || !canAccessSession(username, role, name))) {
    return { ok: false, response: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }
  return { ok: true, name, username, role };
}

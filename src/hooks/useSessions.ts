"use client";

import { useCallback, useEffect, useState } from "react";

// Issue #4: SessionKind is now the open harness-registry id set, sourced from a
// single shared (client-safe) place instead of being redeclared here. Both the
// server (ai-sessions.ts) and this client hook route through the registry so
// the type can never drift.
export type SessionKind = string;
export type TelegramViewMode = "chat" | "screen" | "off";

export interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
  created: string;
  lastActivity?: string;
  activePath?: string;
  cwd?: string;
  worktree?: {
    repoRoot: string;
    path: string;
    branch: string;
  };
  kind?: SessionKind;
  managed?: boolean;
  telegram?: {
    topicId: number;
    viewMode: TelegramViewMode;
    endedAtMs?: number;
  } | null;
}

export interface CreateSessionOptions {
  dangerouslySkipPermissions?: boolean;
  cwd?: string;
  worktree?: {
    create: boolean;
    branch?: string;
    /** Repo-root-relative paths to symlink into the new worktree (heavy dirs). */
    symlinkPaths?: string[];
  };
  /** Workspace config (feature #5): skip auto-running the setup script on create. */
  skipSetup?: boolean;
}

interface UseSessionsReturn {
  sessions: TmuxSession[];
  isLoading: boolean;
  error: string | null;
  createSession: (
    name?: string,
    kind?: SessionKind,
    options?: CreateSessionOptions
  ) => Promise<TmuxSession | null>;
  killSession: (name: string) => Promise<boolean>;
  setTelegramViewMode: (sessionName: string, viewMode: TelegramViewMode) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useSessions(): UseSessionsReturn {
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
      const data = await res.json();
      setSessions(data.sessions ?? data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch sessions");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createSession = useCallback(
    async (
      name?: string,
      kind: SessionKind = "bash",
      options: CreateSessionOptions = {}
    ): Promise<TmuxSession | null> => {
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            kind,
            dangerouslySkipPermissions: options.dangerouslySkipPermissions,
            cwd: options.cwd,
            worktree: options.worktree,
            skipSetup: options.skipSetup,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error ?? `Failed to create session: ${res.status}`);
        }
        const session = await res.json();
        await refresh();
        return session;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create session");
        return null;
      }
    },
    [refresh]
  );

  const killSession = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(name)}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`Failed to kill session: ${res.status}`);
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to kill session");
        return false;
      }
    },
    [refresh]
  );

  const setTelegramViewMode = useCallback(
    async (sessionName: string, viewMode: TelegramViewMode): Promise<boolean> => {
      try {
        const res = await fetch("/api/telegram/topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionName, viewMode }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error ?? `Failed to update Telegram topic: ${res.status}`);
        }
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update Telegram topic");
        return false;
      }
    },
    [refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh when a terminal reports its session ended from the inside
  // (user typed `exit`, killed the tmux session, etc.). The terminal
  // view dispatches this event after the server closes the PTY.
  useEffect(() => {
    const handler = () => {
      refresh();
    };
    window.addEventListener("terminalx:session-ended", handler);
    return () => window.removeEventListener("terminalx:session-ended", handler);
  }, [refresh]);

  return { sessions, isLoading, error, createSession, killSession, setTelegramViewMode, refresh };
}

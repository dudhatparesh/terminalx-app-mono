"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionKind } from "./useSessions";

export type ConfigScope = "repo" | "user" | "default";

export interface WorkspaceRunScript {
  name: string;
  description?: string;
  command: string;
}

export interface WorkspaceConfig {
  hasRepoConfig: boolean;
  configPath: string;
  defaultKind: SessionKind;
  copyFiles: string[];
  env: Record<string, string>;
  setup: { command: string; timeoutSeconds?: number } | null;
  scripts: WorkspaceRunScript[];
  provenance: {
    defaultKind: ConfigScope;
    copyFiles: ConfigScope;
    env: ConfigScope;
    setup: ConfigScope;
    scripts: ConfigScope;
  };
  warnings: string[];
}

interface UseWorkspaceConfigReturn {
  config: WorkspaceConfig | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Resolve the workspace config for the active session (or an explicit repoRoot).
 * Used by the command palette (run scripts) and the dashboard new-session dialog.
 */
export function useWorkspaceConfig(
  params: { session?: string | null; repoRoot?: string | null } | string | null
): UseWorkspaceConfigReturn {
  const session = typeof params === "string" ? params : (params?.session ?? null);
  const repoRoot = typeof params === "string" ? null : (params?.repoRoot ?? null);

  const [config, setConfig] = useState<WorkspaceConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session && !repoRoot) {
      setConfig(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const qs = session
        ? `session=${encodeURIComponent(session)}`
        : `repoRoot=${encodeURIComponent(repoRoot!)}`;
      const res = await fetch(`/api/workspace/config?${qs}`);
      if (!res.ok) {
        setConfig(null);
        setError(`config unavailable (${res.status})`);
        return;
      }
      const data = (await res.json()) as WorkspaceConfig;
      setConfig(data);
    } catch (err) {
      setConfig(null);
      setError(err instanceof Error ? err.message : "failed to load workspace config");
    } finally {
      setIsLoading(false);
    }
  }, [session, repoRoot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { config, isLoading, error, refresh };
}

/** Trigger a run script in a transient streamed session. */
export async function executeRunScript(session: string, scriptName: string): Promise<boolean> {
  const res = await fetch(`/api/workspace/scripts/${encodeURIComponent(scriptName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session }),
  });
  return res.ok;
}

/** Trigger (or retry) the setup script for a session's workspace. */
export async function runWorkspaceSetup(session: string): Promise<boolean> {
  const res = await fetch(`/api/workspace/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session }),
  });
  return res.ok;
}

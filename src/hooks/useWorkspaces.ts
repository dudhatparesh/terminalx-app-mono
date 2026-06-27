"use client";

import { useCallback, useEffect, useState } from "react";
// BROWSER-SAFE import only: types + pure formatters, no Node/server modules.
import type { WorkspaceView } from "@/types/workspace";

interface UseWorkspacesReturn {
  workspaces: WorkspaceView[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Delete a whole project (workspace + all its worktrees). */
  deleteWorkspace: (id: string) => Promise<boolean>;
  /** Collapse/expand a single worktree row. */
  setWorktreeCollapsed: (sessionName: string, collapsed: boolean) => Promise<boolean>;
  /** Archive a single worktree (minimal hook; #9 completes restore/cleanup). */
  archiveWorktree: (sessionName: string) => Promise<boolean>;
}

export function useWorkspaces(): UseWorkspacesReturn {
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/workspaces");
      if (!res.ok) throw new Error(`Failed to fetch workspaces: ${res.status}`);
      const data = await res.json();
      setWorkspaces(data.workspaces ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch workspaces");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteWorkspace = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Failed to delete workspace: ${res.status}`);
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete workspace");
        return false;
      }
    },
    [refresh]
  );

  const patchSession = useCallback(
    async (sessionName: string, patch: { collapsed?: boolean; archived?: boolean }) => {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionName)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Failed to update worktree: ${res.status}`);
    },
    []
  );

  const setWorktreeCollapsed = useCallback(
    async (sessionName: string, collapsed: boolean): Promise<boolean> => {
      try {
        await patchSession(sessionName, { collapsed });
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to collapse worktree");
        return false;
      }
    },
    [patchSession, refresh]
  );

  const archiveWorktree = useCallback(
    async (sessionName: string): Promise<boolean> => {
      try {
        await patchSession(sessionName, { archived: true });
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to archive worktree");
        return false;
      }
    },
    [patchSession, refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    workspaces,
    isLoading,
    error,
    refresh,
    deleteWorkspace,
    setWorktreeCollapsed,
    archiveWorktree,
  };
}

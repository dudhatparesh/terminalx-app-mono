"use client";

import { useCallback, useEffect, useState } from "react";
// BROWSER-SAFE import only: types + pure formatters, no Node/server modules.
import type { ProjectView } from "@/types/project";

interface UseProjectsReturn {
  projects: ProjectView[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Delete a whole project (project + all its workspaces). */
  deleteProject: (id: string) => Promise<boolean>;
  /** Collapse/expand a single workspace row. */
  setWorkspaceCollapsed: (sessionName: string, collapsed: boolean) => Promise<boolean>;
  /** Archive a single workspace: removes the git worktree, keeps the branch (#9). */
  archiveWorkspace: (sessionName: string) => Promise<boolean>;
  /** Restore an archived workspace: recreates the git worktree from its branch (#9). */
  restoreWorkspace: (sessionName: string) => Promise<boolean>;
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error(`Failed to fetch projects: ${res.status}`);
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch projects");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteProject = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Failed to delete project: ${res.status}`);
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete project");
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
      if (!res.ok) throw new Error(`Failed to update workspace: ${res.status}`);
    },
    []
  );

  const setWorkspaceCollapsed = useCallback(
    async (sessionName: string, collapsed: boolean): Promise<boolean> => {
      try {
        await patchSession(sessionName, { collapsed });
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to collapse workspace");
        return false;
      }
    },
    [patchSession, refresh]
  );

  // Archive/restore go through dedicated server routes (not the PATCH flag hook)
  // so the workspace's git/fs lifecycle (remove-on-archive, recreate-on-restore)
  // runs server-side. The client just calls the API and refreshes.
  const archiveWorkspace = useCallback(
    async (sessionName: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionName)}/archive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`Failed to archive workspace: ${res.status}`);
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to archive workspace");
        return false;
      }
    },
    [refresh]
  );

  const restoreWorkspace = useCallback(
    async (sessionName: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionName)}/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`Failed to restore workspace: ${res.status}`);
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to restore workspace");
        return false;
      }
    },
    [refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    projects,
    isLoading,
    error,
    refresh,
    deleteProject,
    setWorkspaceCollapsed,
    archiveWorkspace,
    restoreWorkspace,
  };
}

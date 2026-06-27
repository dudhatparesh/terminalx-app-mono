"use client";

import { useCallback, useEffect, useState } from "react";
import type { DiffResponse, FileDiff } from "@/types/diff";

interface UseSessionDiffReturn {
  data: DiffResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Lazily fetch hunks for a single file (spec §3.3). */
  loadFile: (path: string) => Promise<FileDiff | null>;
}

/**
 * Fetches the Changes file list for a session's worktree branch vs its
 * merge-base. spec §9.2. Refetches on explicit refresh and on the existing
 * terminalx:session-ended event.
 */
export function useSessionDiff(session: string | null): UseSessionDiffReturn {
  const [data, setData] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!session) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/sessions/${encodeURIComponent(session)}/diff`)
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (!r.ok) throw new Error(json?.error ?? `Request failed (${r.status})`);
        return json as DiffResponse;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, nonce]);

  // Refetch when the session ends/changes (events already dispatched elsewhere).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => refresh();
    window.addEventListener("terminalx:session-ended", onChange);
    return () => window.removeEventListener("terminalx:session-ended", onChange);
  }, [refresh]);

  const loadFile = useCallback(
    async (path: string): Promise<FileDiff | null> => {
      if (!session) return null;
      try {
        const r = await fetch(
          `/api/sessions/${encodeURIComponent(session)}/diff/file?path=${encodeURIComponent(path)}`
        );
        const json = await r.json().catch(() => null);
        if (!r.ok) throw new Error(json?.error ?? `Request failed (${r.status})`);
        return (json?.file as FileDiff) ?? null;
      } catch {
        return null;
      }
    },
    [session]
  );

  return { data, loading, error, refresh, loadFile };
}

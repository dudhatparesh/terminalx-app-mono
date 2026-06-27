"use client";

// Client data hook for the Checks tab (checks-dashboard.spec.md §5.5). Browser-safe:
// only React + fetch + the ChecksView TYPE. Never imports server/Node modules.
//
// - GET /api/checks?sessionName=... (force=true on manual refresh)
// - adaptive polling per §4.2, keyed off view.rollup
// - pauses polling when document.hidden (Page Visibility API)
// - cancels in-flight requests on sessionName change
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChecksEnvelope, ChecksRollup, ChecksView } from "@/types/checks";

export interface UseChecksReturn {
  view: ChecksView | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void; // force=true
}

/** Client poll cadence by rollup (§4.2). null => do not poll. */
export function pollIntervalMs(rollup: ChecksRollup | undefined): number | null {
  switch (rollup) {
    case "pending":
      return 15_000;
    case "success":
    case "failure":
    case "none":
      return 60_000;
    case "error":
      return 30_000; // first backoff step; client stops after manual attempts
    case "no-repo":
    case "no-pr":
    default:
      return null; // static until session/branch changes
  }
}

export function useChecks(sessionName: string | null): UseChecksReturn {
  const [view, setView] = useState<ChecksView | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rollupRef = useRef<ChecksRollup | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchOnce = useCallback(
    async (force: boolean) => {
      if (!sessionName) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsLoading(true);
      try {
        const qs = new URLSearchParams({ sessionName });
        if (force) qs.set("force", "true");
        const res = await fetch(`/api/checks?${qs.toString()}`, { signal: controller.signal });
        const body = (await res.json().catch(() => null)) as ChecksEnvelope | null;
        if (controller.signal.aborted) return;

        if (body?.status === "success") {
          setView(body.data);
          rollupRef.current = body.data.rollup;
          setError(null);
        } else if (body?.data) {
          // Degraded path (429/502): keep showing the stale cached view.
          setView(body.data);
          rollupRef.current = body.data.rollup;
          setError(body.code === "RATE_LIMITED" ? "rate-limited" : "couldn't refresh");
        } else {
          setError(body?.message ?? `Request failed (${res.status})`);
        }
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    },
    [sessionName]
  );

  const scheduleNext = useCallback(() => {
    clearTimer();
    if (typeof document !== "undefined" && document.hidden) return; // paused; visibility handler resumes
    const interval = pollIntervalMs(rollupRef.current);
    if (interval == null) return;
    timerRef.current = setTimeout(async () => {
      await fetchOnce(false);
      scheduleNext();
    }, interval);
  }, [clearTimer, fetchOnce]);

  const refresh = useCallback(() => {
    void (async () => {
      await fetchOnce(true);
      scheduleNext();
    })();
  }, [fetchOnce, scheduleNext]);

  // Initial fetch + schedule on sessionName change; cancel in-flight on cleanup.
  useEffect(() => {
    setView(null);
    setError(null);
    rollupRef.current = undefined;
    clearTimer();
    if (!sessionName) {
      setIsLoading(false);
      return;
    }
    void (async () => {
      await fetchOnce(false);
      scheduleNext();
    })();
    return () => {
      abortRef.current?.abort();
      clearTimer();
    };
  }, [sessionName, fetchOnce, scheduleNext, clearTimer]);

  // Pause polling when the tab/document is hidden; on focus, refetch if needed.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.hidden) {
        clearTimer();
      } else if (sessionName) {
        void (async () => {
          await fetchOnce(false);
          scheduleNext();
        })();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [sessionName, fetchOnce, scheduleNext, clearTimer]);

  return { view, isLoading, error, refresh };
}

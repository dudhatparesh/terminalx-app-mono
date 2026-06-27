"use client";

// Fetches the Review-tab model (spec §6.1) for a session and exposes the actions
// the tab needs (create PR, submit review, resolve toggle, refetch). Browser-safe:
// only fetches the session-scoped API routes; never imports a server module.
import { useCallback, useEffect, useState } from "react";
import type { CreatePrForm, ReviewTabModel } from "@/types/pr-review";

interface SubmitResult extends ReviewTabModel {
  submitted: number;
  rejected: Array<{ id: string; error: string }>;
}

export interface UsePrReview {
  model: ReviewTabModel | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createPr: (form: CreatePrForm) => Promise<{ ok: boolean; error?: string }>;
  submitReview: (
    event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES",
    body: string
  ) => Promise<{ ok: boolean; error?: string; result?: SubmitResult }>;
  setResolved: (key: string, resolved: boolean) => Promise<void>;
}

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    return j.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export function usePrReview(session: string | null): UsePrReview {
  const [model, setModel] = useState<ReviewTabModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = session ? `/api/sessions/${encodeURIComponent(session)}` : null;

  const refetch = useCallback(async () => {
    if (!base) {
      setModel(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${base}/review`);
      if (!res.ok) {
        setError(await readError(res));
        setModel(null);
        return;
      }
      setModel((await res.json()) as ReviewTabModel);
    } catch {
      setError("Could not load review");
      setModel(null);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const createPr = useCallback<UsePrReview["createPr"]>(
    async (form) => {
      if (!base) return { ok: false, error: "No session" };
      try {
        const res = await fetch(`${base}/pr`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(form),
        });
        if (!res.ok) return { ok: false, error: await readError(res) };
        await refetch();
        return { ok: true };
      } catch {
        return { ok: false, error: "Could not create pull request" };
      }
    },
    [base, refetch]
  );

  const submitReview = useCallback<UsePrReview["submitReview"]>(
    async (event, body) => {
      if (!base) return { ok: false, error: "No session" };
      try {
        const res = await fetch(`${base}/review/submit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ event, body }),
        });
        if (!res.ok) return { ok: false, error: await readError(res) };
        const result = (await res.json()) as SubmitResult;
        setModel(result);
        return { ok: true, result };
      } catch {
        return { ok: false, error: "Could not submit review" };
      }
    },
    [base]
  );

  const setResolved = useCallback<UsePrReview["setResolved"]>(
    async (key, resolved) => {
      if (!base) return;
      // Optimistic: flip the flag locally, then persist.
      setModel((m) =>
        m
          ? {
              ...m,
              byFile: m.byFile.map((g) => ({
                ...g,
                threads: g.threads.map((t) => (t.key === key ? { ...t, resolved } : t)),
              })),
            }
          : m
      );
      try {
        await fetch(`${base}/review/resolve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, resolved }),
        });
      } catch {
        void refetch();
      }
    },
    [base, refetch]
  );

  return { model, loading, error, refetch, createPr, submitReview, setResolved };
}

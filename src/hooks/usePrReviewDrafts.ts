"use client";

// Client cache over the server-persisted draft list (spec §4.2). Drafts render
// immediately (optimistic) and survive a panel remount/reload because the source
// of truth is data/pr-review/<session>.json — NOT IndexedDB. Browser-safe: only
// fetches the session-scoped API routes.
import { useCallback, useEffect, useState } from "react";
import type { CommentSide, DraftComment, DraftReview } from "@/types/pr-review";

export interface UsePrReviewDrafts {
  drafts: DraftComment[];
  draftReview: DraftReview | null;
  count: number;
  loading: boolean;
  error: string | null;
  upsert: (input: {
    id?: string;
    path: string;
    line: number;
    side?: CommentSide;
    body: string;
    inReplyToId?: number;
  }) => Promise<DraftComment | null>;
  discard: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

function makeId(session: string, path: string, line: number): string {
  const nonce = Math.random().toString(36).slice(2, 8);
  return `draft:${session}:${path}:${line}:${nonce}`;
}

export function usePrReviewDrafts(session: string | null): UsePrReviewDrafts {
  const [drafts, setDrafts] = useState<DraftComment[]>([]);
  const [draftReview, setDraftReview] = useState<DraftReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = session ? `/api/sessions/${encodeURIComponent(session)}/review` : null;

  const refetch = useCallback(async () => {
    if (!base) {
      setDrafts([]);
      setDraftReview(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${base}/drafts`);
      if (!res.ok) {
        setError(`Could not load drafts (${res.status})`);
        return;
      }
      const j = (await res.json()) as { drafts: DraftComment[]; draftReview: DraftReview | null };
      setDrafts(j.drafts ?? []);
      setDraftReview(j.draftReview ?? null);
    } catch {
      setError("Could not load drafts");
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const upsert = useCallback<UsePrReviewDrafts["upsert"]>(
    async (input) => {
      if (!base || !session) return null;
      const id = input.id ?? makeId(session, input.path, input.line);
      const now = new Date().toISOString();
      const draft: DraftComment = {
        id,
        sessionName: session,
        path: input.path,
        line: input.line,
        side: input.side ?? "RIGHT",
        inReplyToId: input.inReplyToId,
        body: input.body,
        createdAt: now,
        updatedAt: now,
      };
      // Optimistic insert/update.
      setDrafts((prev) => {
        const idx = prev.findIndex((d) => d.id === id);
        if (idx === -1) return [...prev, draft];
        const next = [...prev];
        next[idx] = { ...next[idx], ...draft, createdAt: next[idx]!.createdAt };
        return next;
      });
      try {
        const res = await fetch(`${base}/drafts/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        });
        if (!res.ok) {
          void refetch();
          return null;
        }
        return (await res.json()) as DraftComment;
      } catch {
        void refetch();
        return null;
      }
    },
    [base, session, refetch]
  );

  const discard = useCallback<UsePrReviewDrafts["discard"]>(
    async (id) => {
      if (!base) return;
      setDrafts((prev) => prev.filter((d) => d.id !== id));
      try {
        await fetch(`${base}/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch {
        void refetch();
      }
    },
    [base, refetch]
  );

  return {
    drafts,
    draftReview,
    count: drafts.length,
    loading,
    error,
    upsert,
    discard,
    refetch,
  };
}

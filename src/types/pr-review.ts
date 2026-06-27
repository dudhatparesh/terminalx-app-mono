// PR-review local draft layer + Review-tab view model (spec §3).
//
// Browser-SAFE: types only, no Node imports. Both the client components and the
// server routes import these. The GitHub-owned contracts (Review, ReviewComment,
// ReviewThread, ReviewSummary, ReviewDecision, PullRequestView) live in
// @/lib/github/types — this module re-exports the few the UI needs as TYPES so a
// "use client" file never has to reach into a server module for a shape.

import type { PullRequestView, Review, ReviewComment, ReviewDecision } from "@/lib/github/types";

export type { PullRequestView, Review, ReviewComment, ReviewDecision };

export type CommentSide = "LEFT" | "RIGHT";

/** A comment the user is composing/has saved but not yet posted to GitHub (§3). */
export interface DraftComment {
  /** Stable local id: `draft:${sessionName}:${path}:${line}:${nonce}`. */
  id: string;
  sessionName: string;
  path: string; // repo-relative file path (matches FileDiff.path)
  line: number; // new-side line number being annotated
  side: CommentSide;
  /** When set, this draft is a reply to an existing GitHub review-comment thread. */
  inReplyToId?: number; // ReviewComment.id of the thread root
  body: string; // markdown, unposted
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** A draft top-level review not yet submitted (batches drafts into one GitHub review). */
export interface DraftReview {
  sessionName: string;
  body: string;
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
}

/** Merge of GitHub-posted threads + local drafts, for a single (path,line) anchor. */
export interface MergedThread {
  path: string;
  line: number;
  side: CommentSide;
  resolved: boolean; // TerminalX-tracked (§4.3)
  comments: ReviewComment[]; // posted comments (root first)
  draftReplies: DraftComment[]; // local draft replies for this thread
  /** Stable key `path::line::side` so the UI can address the thread for resolve/reply. */
  key: string;
  /** True when there are no posted comments — a brand-new draft-only thread. */
  draftOnly: boolean;
}

export interface ReviewFileGroup {
  path: string;
  filename: string;
  dir: string;
  threads: MergedThread[];
}

/** The full payload the Review tab renders (§3). */
export interface ReviewTabModel {
  pr: PullRequestView | null; // null => Create-PR empty state (§2.2)
  decision: ReviewDecision;
  reviews: Review[];
  byFile: ReviewFileGroup[];
  draftCount: number;
  /** True when the repo has no GitHub binding (drives the "Connect this repo" hint, §10). */
  unbound?: boolean;
  /** The session's worktree branch — head for Create-PR even when pr === null. */
  headBranch?: string;
  /** Repo default base branch for Create-PR (settings.toml / git default). */
  defaultBase?: string;
}

/** Create-PR form state (§3.1). */
export interface CreatePrForm {
  base: string;
  head: string; // read-only — the session's worktree branch
  title: string;
  body: string;
  draft: boolean;
  reviewers: string[];
}

/** Thread resolution key: `path::line::side`. */
export function threadKey(path: string, line: number | null, side: CommentSide): string {
  return `${path}::${line ?? "null"}::${side}`;
}

/** Split a repo-relative path into its emphasized filename and muted directory. */
export function splitFilePath(p: string): { filename: string; dir: string } {
  const idx = p.lastIndexOf("/");
  if (idx === -1) return { filename: p, dir: "" };
  return { filename: p.slice(idx + 1), dir: p.slice(0, idx + 1) };
}

// Pure merge of GitHub-posted threads + local drafts into the Review-tab view
// model (spec §3, §4.2). NO Node imports — browser-safe so the client tab can
// re-merge optimistically and the server route can compose the same shape.

import type {
  PullRequestView,
  ReviewComment,
  ReviewDecision,
  ReviewSummary,
  ReviewThread,
} from "@/lib/github/types";
import type {
  DraftComment,
  MergedThread,
  ReviewFileGroup,
  ReviewTabModel,
} from "@/types/pr-review";
import { splitFilePath, threadKey } from "@/types/pr-review";

/** Resolution map shape persisted alongside the session's drafts (§4.3). */
export type ResolvedMap = Record<string, boolean>; // threadKey -> resolved

/**
 * Merge posted review threads + local draft comments into per-file thread groups.
 * Drafts that reply to an existing thread (inReplyToId) attach to that thread by
 * its (path,line,side) anchor; fresh line drafts become draft-only threads.
 */
export function mergeThreads(
  threads: ReviewThread[],
  drafts: DraftComment[],
  resolved: ResolvedMap,
  rootCommentById?: Map<number, ReviewComment>
): MergedThread[] {
  const byKey = new Map<string, MergedThread>();

  // 1. Seed from posted threads.
  for (const t of threads) {
    const key = threadKey(t.path, t.line, t.side);
    byKey.set(key, {
      path: t.path,
      line: t.line ?? 0,
      side: t.side,
      resolved: resolved[key] ?? t.resolved ?? false,
      comments: t.comments,
      draftReplies: [],
      key,
      draftOnly: false,
    });
  }

  // 2. Fold drafts in. A reply targets the thread whose root comment id matches;
  //    a fresh draft is keyed by its own (path,line,side).
  for (const d of drafts) {
    let key: string | undefined;
    if (d.inReplyToId != null && rootCommentById?.has(d.inReplyToId)) {
      const root = rootCommentById.get(d.inReplyToId)!;
      key = threadKey(root.path, root.line, root.side);
    }
    if (!key || !byKey.has(key)) {
      key = threadKey(d.path, d.line, d.side);
    }
    const existing = byKey.get(key);
    if (existing) {
      existing.draftReplies.push(d);
    } else {
      byKey.set(key, {
        path: d.path,
        line: d.line,
        side: d.side,
        resolved: resolved[key] ?? false,
        comments: [],
        draftReplies: [d],
        key,
        draftOnly: true,
      });
    }
  }

  return [...byKey.values()];
}

/** Index posted comments by id so draft replies can find their thread root. */
export function indexComments(threads: ReviewThread[]): Map<number, ReviewComment> {
  const m = new Map<number, ReviewComment>();
  for (const t of threads) {
    for (const c of t.comments) m.set(c.id, c);
  }
  return m;
}

/** Group merged threads by file, sorted by path; filename emphasized, dir muted. */
export function groupByFile(threads: MergedThread[]): ReviewFileGroup[] {
  const byPath = new Map<string, MergedThread[]>();
  for (const t of threads) {
    const arr = byPath.get(t.path) ?? [];
    arr.push(t);
    byPath.set(t.path, arr);
  }
  const groups: ReviewFileGroup[] = [];
  for (const [path, ts] of byPath) {
    const { filename, dir } = splitFilePath(path);
    groups.push({
      path,
      filename,
      dir,
      threads: ts.sort((a, b) => a.line - b.line),
    });
  }
  return groups.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Compose a PullRequestView + ReviewSummary + the session's drafts/resolution
 * into the full ReviewTabModel the tab renders (spec §3, §6.1).
 */
export function mergeIntoModel(
  pr: PullRequestView | null,
  summary: ReviewSummary | null,
  drafts: DraftComment[],
  resolved: ResolvedMap = {}
): ReviewTabModel {
  const decision: ReviewDecision = summary?.decision ?? "pending";
  const threads = summary?.threads ?? [];
  const rootIndex = indexComments(threads);
  const merged = mergeThreads(threads, drafts, resolved, rootIndex);
  return {
    pr,
    decision,
    reviews: summary?.reviews ?? [],
    byFile: groupByFile(merged),
    draftCount: drafts.length,
  };
}

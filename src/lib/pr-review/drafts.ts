// Server-persisted PR-review draft store (spec §6.2). Drafts + the pending
// review summary + thread-resolution flags are stored per session in
// data/pr-review/<session>.json — NOT IndexedDB. Mirrors the load-all / mutate /
// atomicWrite-under-withLock convention of src/lib/ai-sessions.ts and
// src/lib/github/store.ts. SERVER-ONLY (uses fs/path).

import * as fs from "fs";
import * as path from "path";
import { ensureSecureDir } from "../secure-dir";
import { mergeIntoModel, type ResolvedMap } from "./merge";
import type { PullRequestView, ReviewSummary } from "../github/types";
import type { DraftComment, DraftReview, ReviewTabModel } from "@/types/pr-review";

/** On-disk shape for a session's review draft state. */
interface SessionDraftState {
  sessionName: string;
  drafts: DraftComment[];
  draftReview: DraftReview | null;
  /** threadKey (`path::line::side`) -> resolved flag (§4.3). */
  resolved: ResolvedMap;
  updatedAt: string;
}

function dataDir(): string {
  return path.join(process.cwd(), "data", "pr-review");
}

function ensureDir(): void {
  ensureSecureDir(dataDir());
}

// Session names are validated by callers ([a-zA-Z0-9_.-]); still guard here so a
// stray name can never escape the data/pr-review directory.
function safeSessionFile(session: string): string {
  if (!/^[a-zA-Z0-9_.-]+$/.test(session)) {
    throw new Error("invalid session name");
  }
  return path.join(dataDir(), `${session}.json`);
}

function emptyState(session: string): SessionDraftState {
  return {
    sessionName: session,
    drafts: [],
    draftReview: null,
    resolved: {},
    updatedAt: new Date().toISOString(),
  };
}

// ── In-process write lock (shared across all session files) ───────────────────

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.then(
    () => {},
    () => {}
  );
  return next;
}

function readState(session: string): SessionDraftState {
  ensureDir();
  const file = safeSessionFile(session);
  if (!fs.existsSync(file)) return emptyState(session);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<SessionDraftState>;
    return {
      sessionName: session,
      drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
      draftReview: parsed.draftReview ?? null,
      resolved: parsed.resolved ?? {},
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return emptyState(session);
  }
}

function atomicWrite(session: string, state: SessionDraftState): void {
  ensureDir();
  const file = safeSessionFile(session);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmp, file);
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export function getSessionDrafts(session: string): DraftComment[] {
  return readState(session).drafts;
}

export function getDraftReview(session: string): DraftReview | null {
  return readState(session).draftReview;
}

export function getResolvedMap(session: string): ResolvedMap {
  return readState(session).resolved;
}

export function getSessionDraftState(session: string): SessionDraftState {
  return readState(session);
}

// ── Mutations (all under the shared lock) ─────────────────────────────────────

/** Upsert a draft comment/reply by id. */
export async function upsertDraft(session: string, draft: DraftComment): Promise<DraftComment> {
  return withLock(async () => {
    const state = readState(session);
    const now = new Date().toISOString();
    const idx = state.drafts.findIndex((d) => d.id === draft.id);
    const normalized: DraftComment = {
      ...draft,
      sessionName: session,
      createdAt: idx === -1 ? draft.createdAt || now : state.drafts[idx]!.createdAt,
      updatedAt: now,
    };
    if (idx === -1) state.drafts.push(normalized);
    else state.drafts[idx] = normalized;
    state.updatedAt = now;
    atomicWrite(session, state);
    return normalized;
  });
}

/** Discard a single draft by id. Returns true when something was removed. */
export async function discardDraft(session: string, id: string): Promise<boolean> {
  return withLock(async () => {
    const state = readState(session);
    const before = state.drafts.length;
    state.drafts = state.drafts.filter((d) => d.id !== id);
    const removed = state.drafts.length !== before;
    if (removed) {
      state.updatedAt = new Date().toISOString();
      atomicWrite(session, state);
    }
    return removed;
  });
}

/** Set (or clear) the pending review summary/event (§6.2). */
export async function setDraftReview(
  session: string,
  input: { body: string; event: DraftReview["event"] } | null
): Promise<DraftReview | null> {
  return withLock(async () => {
    const state = readState(session);
    state.draftReview = input
      ? { sessionName: session, body: input.body, event: input.event }
      : null;
    state.updatedAt = new Date().toISOString();
    atomicWrite(session, state);
    return state.draftReview;
  });
}

/** Flip a thread's TerminalX-tracked resolution flag (§4.3 — never posted to GitHub). */
export async function setThreadResolved(
  session: string,
  key: string,
  resolved: boolean
): Promise<ResolvedMap> {
  return withLock(async () => {
    const state = readState(session);
    if (resolved) state.resolved[key] = true;
    else delete state.resolved[key];
    state.updatedAt = new Date().toISOString();
    atomicWrite(session, state);
    return state.resolved;
  });
}

/** Remove a set of submitted drafts (used after a successful Submit, §6.4). */
export async function clearDrafts(session: string, ids: string[]): Promise<void> {
  return withLock(async () => {
    const state = readState(session);
    const drop = new Set(ids);
    state.drafts = state.drafts.filter((d) => !drop.has(d.id));
    state.draftReview = null;
    state.updatedAt = new Date().toISOString();
    atomicWrite(session, state);
  });
}

/** Compose the full ReviewTabModel from a PR + summary + this session's drafts. */
export function buildModel(
  session: string,
  pr: PullRequestView | null,
  summary: ReviewSummary | null
): ReviewTabModel {
  const state = readState(session);
  return mergeIntoModel(pr, summary, state.drafts, state.resolved);
}

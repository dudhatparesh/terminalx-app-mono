import * as fs from "fs";
import * as path from "path";
import { ensureSecureDir } from "./secure-dir";
import { getSessionCreatedMs, isTerminalXMarkedSession, markTerminalXSession } from "./tmux";

// Issue #4: SessionKind is now the OPEN id set sourced from the harness registry
// (was the closed "bash" | "claude" | "codex" union). Existing ai-sessions.json
// records stay valid since the legacy ids remain registry ids.
export type SessionKind = string;

export interface SessionMeta {
  name: string;
  kind: SessionKind;
  createdAt: string;
  createdBy?: string;
  managed?: boolean;
  cwd?: string;
  worktree?: {
    repoRoot: string;
    path: string;
    branch: string;
    /** Absolute paths inside the worktree linked/copied from the shared source. */
    linkedPaths?: string[];
  };

  // --- Models settings (feature #11) — all optional → backward compatible.
  // Resolved Models defaults seed the new-session dialog and are stored on the
  // session so command generation can thread them once #4/#8 land. When the
  // model registry is absent these are accepted + stored but only claude/codex
  // invocations are emitted (graceful degradation, spec §5.2).
  /** Provider-qualified model id, e.g. "claude:opus-4-8-1m". */
  modelId?: string;
  /** Reasoning/effort level for this session. */
  effort?: string;
  /** Codex personality preset (only meaningful for Codex models). */
  personality?: string;
  /** Started in plan mode. */
  planMode?: boolean;
  /** Started in fast mode. */
  fastMode?: boolean;

  // --- Workspace config (feature #5) — all optional → backward compatible.
  // Old data/ai-sessions.json records without these fields remain valid.
  /** Per-workspace injected port. Conductor analog: CONDUCTOR_PORT. */
  port?: number;
  /** Setup run lifecycle for this workspace. */
  setup?: {
    status: "pending" | "running" | "succeeded" | "failed" | "skipped";
    startedAt?: string;
    finishedAt?: string;
    exitCode?: number;
  };

  // --- Worktree sidebar flags (feature #12, completed by #9) — optional.
  // A worktree row can be collapsed (hidden from its workspace group) or
  // archived. #12 wires the UI + a minimal archive endpoint; #9 builds the full
  // archive/restore + cleanup system. Old records without these stay valid.
  /** Worktree row is collapsed in the sidebar group. */
  collapsed?: boolean;
  /** Worktree has been archived (issue #9 completes restore/cleanup). */
  archived?: boolean;
  /** When the worktree was archived (ISO timestamp). */
  archivedAt?: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "ai-sessions.json");

function ensureDir() {
  ensureSecureDir(DATA_DIR);
}

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.then(
    () => {},
    () => {}
  );
  return next;
}

export function listMetadata(): SessionMeta[] {
  ensureDir();
  if (!fs.existsSync(FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf-8")) as SessionMeta[];
  } catch {
    return [];
  }
}

function atomicWrite(list: SessionMeta[]) {
  ensureDir();
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  fs.renameSync(tmp, FILE);
}

export async function saveMeta(meta: SessionMeta): Promise<void> {
  return withLock(async () => {
    const list = listMetadata();
    const idx = list.findIndex((m) => m.name === meta.name);
    if (idx !== -1) {
      list[idx] = meta;
    } else {
      list.push(meta);
    }
    atomicWrite(list);
  });
}

/**
 * Shallow-merge a partial patch into an existing session's metadata (serialized,
 * atomic). Returns the updated record, or undefined when no such session exists.
 * Used by the worktree sidebar (feature #12) to flip collapsed/archived flags
 * without rewriting the whole record. `name` is never patched.
 */
export async function patchMeta(
  name: string,
  patch: Partial<Omit<SessionMeta, "name">>
): Promise<SessionMeta | undefined> {
  return withLock(async () => {
    const list = listMetadata();
    const idx = list.findIndex((m) => m.name === name);
    if (idx === -1) return undefined;
    const updated = { ...list[idx], ...patch, name } as SessionMeta;
    list[idx] = updated;
    atomicWrite(list);
    return updated;
  });
}

export async function deleteMeta(name: string): Promise<void> {
  return withLock(async () => {
    const list = listMetadata();
    const idx = list.findIndex((m) => m.name === name);
    if (idx === -1) return;
    list.splice(idx, 1);
    atomicWrite(list);
  });
}

export function getMeta(name: string): SessionMeta | undefined {
  return listMetadata().find((m) => m.name === name);
}

export function isManagedSession(name: string): boolean {
  return Boolean(getMeta(name)) && isTerminalXMarkedSession(name);
}

export function canAdoptManagedSession(name: string): boolean {
  const meta = getMeta(name);
  if (!meta) return false;
  const metaCreatedMs = Date.parse(meta.createdAt);
  const tmuxCreatedMs = getSessionCreatedMs(name);
  if (!Number.isFinite(metaCreatedMs) || !tmuxCreatedMs) return false;
  return Math.abs(tmuxCreatedMs - metaCreatedMs) <= 60_000;
}

export function ensureManagedSession(name: string): boolean {
  if (isManagedSession(name)) return true;
  if (!canAdoptManagedSession(name)) return false;
  try {
    markTerminalXSession(name);
    return isTerminalXMarkedSession(name);
  } catch {
    return false;
  }
}

// Issue #4: CLI_BINS / commandForKind / isValidKind moved into the harness
// registry (src/lib/harnesses/*). These re-export shims keep every existing
// import (the sessions API, etc.) working unchanged; commandForKind emits the
// SAME bash -lc wrapper as before and isValidKind now accepts any registry id.
export type { CommandOptions } from "./harnesses/types";
export { isValidHarnessId as isValidKind } from "./harnesses/registry";
export { commandForHarness as commandForKind } from "./harnesses/command";

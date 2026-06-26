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

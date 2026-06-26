import * as fs from "fs";
import * as path from "path";
import { ensureSecureDir } from "./secure-dir";
import { getSessionCreatedMs, isTerminalXMarkedSession, markTerminalXSession } from "./tmux";

export type SessionKind = "bash" | "claude" | "codex";

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

const CLI_BINS: Record<SessionKind, string | null> = {
  bash: null,
  claude: "claude",
  codex: "codex",
};

export interface CommandOptions {
  dangerouslySkipPermissions?: boolean;
}

/**
 * Wrap the CLI invocation so tmux's session stays alive even if the CLI
 * exits (e.g., not installed, signed out, crashed). On exit we drop to an
 * interactive bash so the user can inspect the error and retry.
 *
 * `dangerouslySkipPermissions` only applies to `claude` and appends
 * --dangerously-skip-permissions so the CLI doesn't prompt for approvals.
 */
export function commandForKind(kind: SessionKind, opts: CommandOptions = {}): string | null {
  const bin = CLI_BINS[kind];
  if (!bin) return null;
  const args: string[] = [];
  if (kind === "claude" && opts.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  const invocation = [bin, ...args].join(" ");
  return `bash -lc '${invocation}; ec=$?; echo; echo "[${bin} exited with code $ec — dropping to bash]"; exec bash -l'`;
}

export function isValidKind(kind: unknown): kind is SessionKind {
  return kind === "bash" || kind === "claude" || kind === "codex";
}

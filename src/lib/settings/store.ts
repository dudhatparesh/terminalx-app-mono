// Settings persistence store (issue #11, §3).
//
// SERVER-ONLY (fs/path). User scope → data/settings/user.json (mode 0600);
// repo scope → <repoRoot>/.terminalx/settings.toml (committed). Atomic writes
// (tmp + rename) and serialized via a withLock chain mirror ai-sessions.ts;
// repo paths are guarded by resolveSafePath + assertNotSensitivePath before any
// FS access. Reads degrade to empty defaults on any error.

import * as fs from "fs";
import * as path from "path";
import { ensureSecureDir } from "@/lib/secure-dir";
import { resolveSafePath, assertNotSensitivePath } from "@/lib/file-service";
import { readScopedToml, writeScopedToml } from "./models-toml";
import type { ModelSettings, ScopedSettings } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "settings");
const USER_FILE = path.join(DATA_DIR, "user.json");
const REPO_REL = path.join(".terminalx", "settings.toml");

const EMPTY: ScopedSettings = { version: 1 };

// ---- serialized writes (mirrors ai-sessions.ts withLock) -------------------

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.then(
    () => {},
    () => {}
  );
  return next;
}

function atomicWriteFile(file: string, contents: string, mode: number) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, contents, { encoding: "utf-8", mode });
  fs.renameSync(tmp, file);
}

// ---- deep merge of a models patch ------------------------------------------

/**
 * Deep-merge a `models` patch into an existing models object. A field set to
 * `null` CLEARS it (re-enables inheritance); ModelChoice sub-fields merge
 * independently so a patch can change only the effort.
 */
export function mergeModels(
  base: Partial<ModelSettings> | undefined,
  patch: Partial<ModelSettings>
): Partial<ModelSettings> {
  const out: Partial<ModelSettings> = { ...(base ?? {}) };
  for (const key of Object.keys(patch) as (keyof ModelSettings)[]) {
    const value = patch[key];
    if (value === null) {
      delete out[key];
      continue;
    }
    if (value === undefined) continue;
    if (key === "defaultModel" || key === "reviewModel") {
      const prev = (out[key] ?? { modelId: null, effort: null }) as ModelSettings[typeof key];
      out[key] = { ...prev, ...(value as object) } as ModelSettings[typeof key];
    } else {
      // scalar fields (personality / toggles)
      out[key] = value as never;
    }
  }
  // Drop choices that became fully empty so resolution treats them as unset.
  for (const key of ["defaultModel", "reviewModel"] as const) {
    const c = out[key];
    if (c && c.modelId == null && c.effort == null) delete out[key];
  }
  return out;
}

// ---- user scope (JSON) -----------------------------------------------------

export function readUserSettings(): ScopedSettings {
  try {
    ensureSecureDir(DATA_DIR);
    if (!fs.existsSync(USER_FILE)) return { ...EMPTY };
    const parsed = JSON.parse(fs.readFileSync(USER_FILE, "utf-8")) as ScopedSettings;
    return { ...parsed, version: 1 };
  } catch {
    return { ...EMPTY };
  }
}

export async function writeUserSettings(next: ScopedSettings): Promise<void> {
  return withLock(async () => {
    ensureSecureDir(DATA_DIR);
    atomicWriteFile(USER_FILE, JSON.stringify({ ...next, version: 1 }, null, 2), 0o600);
  });
}

// ---- repo scope (TOML) -----------------------------------------------------

/** Resolve <repoRoot>/.terminalx/settings.toml, guarded against traversal. */
export function repoSettingsPath(repoRoot: string): string {
  const p = resolveSafePath(path.join(repoRoot, REPO_REL));
  assertNotSensitivePath(p);
  return p;
}

export interface RepoReadResult {
  settings: ScopedSettings;
  /** raw file text, kept so a later write preserves sibling tables */
  raw: string;
  exists: boolean;
  parseError: boolean;
}

export function readRepoSettings(repoRoot: string): RepoReadResult {
  const file = repoSettingsPath(repoRoot);
  if (!fs.existsSync(file)) {
    return { settings: { ...EMPTY }, raw: "", exists: false, parseError: false };
  }
  try {
    const text = fs.readFileSync(file, "utf-8");
    const { settings, parseError } = readScopedToml(text);
    return { settings, raw: text, exists: true, parseError };
  } catch {
    return { settings: { ...EMPTY }, raw: "", exists: true, parseError: true };
  }
}

export async function writeRepoSettings(repoRoot: string, next: ScopedSettings): Promise<void> {
  const file = repoSettingsPath(repoRoot);
  return withLock(async () => {
    // Preserve sibling tables: re-read the prior text inside the lock.
    let prior = "";
    try {
      if (fs.existsSync(file)) prior = fs.readFileSync(file, "utf-8");
    } catch {
      prior = "";
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    atomicWriteFile(file, writeScopedToml(next, prior), 0o644);
  });
}

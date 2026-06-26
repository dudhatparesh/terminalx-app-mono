/**
 * Workspace configuration — TerminalX analog of Conductor's committed repo
 * config (`.conductor/settings.toml`). Parses a committed `.terminalx/settings.toml`
 * (or a user-scope `data/workspace-config.json` overlay), layering
 *   built-in defaults < user-scope JSON < repo TOML  (last wins per field),
 * and resolves a setup script, named run scripts, env vars, copy-files list and
 * default session kind.
 *
 * Per the feature mandate we avoid a heavy new TOML dependency and ship a tiny,
 * purpose-built TOML reader (`parseToml`) covering exactly the subset the schema
 * uses: top-level scalars, [tables], [dotted.sub.tables], string/int/bool
 * scalars and string arrays. Anything richer throws (callers treat a throw as a
 * malformed file → defaults + warning, never a crash).
 */
import * as fs from "fs";
import * as path from "path";
import { isValidKind, type SessionKind } from "./ai-sessions";
import { assertNotSensitivePath, resolveSafePath } from "./file-service";

/** Where a resolved config value came from (for the "Edit" affordance + UI). */
export type ConfigScope = "repo" | "user" | "default";

export interface RunScript {
  /** Stable key, e.g. "dev". Used in the palette id and execute route. */
  name: string;
  /** Human description shown in the palette and settings UI. */
  description?: string;
  /** Shell command, pre-interpolation. */
  command: string;
}

export interface SetupScript {
  command: string;
  /** Seconds before the setup run is force-killed. Default 1800 (30m). */
  timeoutSeconds?: number;
}

/** Raw, per-scope config as parsed from a single source (TOML or user JSON). */
export interface WorkspaceConfigSource {
  version: number;
  defaultKind?: SessionKind;
  copyFiles?: string[];
  env?: Record<string, string>;
  setup?: SetupScript;
  scripts?: Record<string, Omit<RunScript, "name">>;
}

/** Fully resolved config after layering default < user < repo. */
export interface ResolvedWorkspaceConfig {
  /** Absolute repo root the config was resolved for. */
  repoRoot: string;
  /** Absolute path to the committed file (may not exist). */
  configPath: string;
  /** True if .terminalx/settings.toml exists and parsed cleanly. */
  hasRepoConfig: boolean;
  defaultKind: SessionKind;
  copyFiles: string[];
  env: Record<string, string>;
  setup: SetupScript | null;
  scripts: RunScript[];
  /** Per-field provenance, so the UI can label "from repo" vs "from user". */
  provenance: {
    defaultKind: ConfigScope;
    copyFiles: ConfigScope;
    env: ConfigScope;
    setup: ConfigScope;
    scripts: ConfigScope;
  };
  /** Non-fatal parse/validation warnings to surface in the UI. */
  warnings: string[];
}

const DEFAULT_SETUP_TIMEOUT_SECONDS = 1800;
const DEFAULT_COPY_FILES = [".env", ".env.local"];

// Reserved env keys config must never override (would break the shell / port).
const RESERVED_ENV_KEYS = new Set(["PATH", "HOME", "SHELL", "TERM", "TERMINALX_PORT"]);
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const BUILTIN = {
  defaultKind: "bash" as SessionKind,
  copyFiles: DEFAULT_COPY_FILES,
  env: {} as Record<string, string>,
  setup: null as SetupScript | null,
  scripts: [] as RunScript[],
};

export function repoConfigPath(repoRoot: string): string {
  return path.join(repoRoot, ".terminalx", "settings.toml");
}

// ---------------------------------------------------------------------------
// Minimal TOML reader
// ---------------------------------------------------------------------------

type TomlValue = string | number | boolean | TomlValue[];
type TomlTable = { [key: string]: TomlValue | TomlTable };

function parseTomlScalar(raw: string): TomlValue {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  // Double-quoted string with basic escapes.
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    return v
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }
  // Single-quoted (literal) string — no escapes.
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    return v.slice(1, -1);
  }
  // Array of values (we only need flat arrays of strings).
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevelCommas(inner).map((part) => parseTomlScalar(part));
  }
  // Integer.
  if (/^[+-]?\d+$/.test(v)) {
    const n = Number(v);
    if (!Number.isSafeInteger(n)) throw new Error(`TOML: unsafe integer "${v}"`);
    return n;
  }
  throw new Error(`TOML: unrecognized value "${raw}"`);
}

/** Split on commas that are not inside quotes or nested brackets. */
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === quote && s[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "[") depth++;
    if (c === "]") depth--;
    if (c === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Strip a `#` comment that is not inside a quoted string. */
function stripComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote && line[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

/**
 * Parse the small TOML subset the workspace schema uses. Throws on anything it
 * cannot understand so callers can fall back to defaults + a warning.
 */
export function parseToml(text: string): TomlTable {
  const root: TomlTable = {};
  let current: TomlTable = root;

  const rawLines = text.split(/\r?\n/);
  for (const rawLine of rawLines) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    // Table header: [a] or [a.b.c]
    if (line.startsWith("[")) {
      if (!line.endsWith("]")) throw new Error(`TOML: malformed table header "${line}"`);
      const inner = line.slice(1, -1).trim();
      if (line.startsWith("[[")) throw new Error("TOML: array-of-tables not supported");
      if (!inner) throw new Error("TOML: empty table header");
      const segments = inner.split(".").map((s) => s.trim());
      if (segments.some((s) => !s || !/^[A-Za-z0-9_-]+$/.test(s))) {
        throw new Error(`TOML: invalid table path "${inner}"`);
      }
      current = root;
      for (const seg of segments) {
        const existing = current[seg];
        if (existing === undefined) {
          const t: TomlTable = {};
          current[seg] = t;
          current = t;
        } else if (typeof existing === "object" && !Array.isArray(existing)) {
          current = existing as TomlTable;
        } else {
          throw new Error(`TOML: "${seg}" redefined as a table`);
        }
      }
      continue;
    }

    // key = value
    const eq = line.indexOf("=");
    if (eq === -1) throw new Error(`TOML: expected key = value, got "${line}"`);
    const key = line.slice(0, eq).trim();
    const valueRaw = line.slice(eq + 1).trim();
    if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) throw new Error(`TOML: invalid key "${key}"`);
    if (!valueRaw) throw new Error(`TOML: missing value for "${key}"`);
    current[key] = parseTomlScalar(valueRaw);
  }

  return root;
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

/**
 * Expand `${VAR}` references against a known scope (single-pass — injected
 * values are never re-expanded, so there are no infinite loops). Unknown vars
 * fall back to process.env then to the empty string.
 */
export function interpolate(value: string, scope: Record<string, string>): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_, name: string) => scope[name] ?? process.env[name] ?? ""
  );
}

// ---------------------------------------------------------------------------
// Source readers
// ---------------------------------------------------------------------------

function tomlTableToSource(table: TomlTable): Partial<WorkspaceConfigSource> {
  const src: Partial<WorkspaceConfigSource> = {};
  if (typeof table.version === "number") src.version = table.version;

  const workspace = table.workspace as TomlTable | undefined;
  if (workspace && typeof workspace === "object") {
    if (typeof workspace.defaultKind === "string") {
      src.defaultKind = workspace.defaultKind as SessionKind;
    }
    if (Array.isArray(workspace.copyFiles)) {
      src.copyFiles = workspace.copyFiles.filter((v): v is string => typeof v === "string");
    }
  }
  // Allow copyFiles at the top level too (matches the spec example block).
  if (Array.isArray(table.copyFiles)) {
    src.copyFiles = (table.copyFiles as TomlValue[]).filter(
      (v): v is string => typeof v === "string"
    );
  }
  if (typeof table.defaultKind === "string") src.defaultKind = table.defaultKind as SessionKind;

  const env = table.env as TomlTable | undefined;
  if (env && typeof env === "object") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === "string") out[k] = v;
    }
    src.env = out;
  }

  const setup = table.setup as TomlTable | undefined;
  if (setup && typeof setup === "object" && typeof setup.command === "string") {
    src.setup = {
      command: setup.command,
      timeoutSeconds: typeof setup.timeoutSeconds === "number" ? setup.timeoutSeconds : undefined,
    };
  }

  const scripts = table.scripts as TomlTable | undefined;
  if (scripts && typeof scripts === "object") {
    const out: Record<string, Omit<RunScript, "name">> = {};
    for (const [name, s] of Object.entries(scripts)) {
      if (s && typeof s === "object" && !Array.isArray(s)) {
        const tbl = s as TomlTable;
        if (typeof tbl.command === "string") {
          out[name] = {
            command: tbl.command,
            description: typeof tbl.description === "string" ? tbl.description : undefined,
          };
        }
      }
    }
    src.scripts = out;
  }

  return src;
}

function readRepoConfig(
  repoRoot: string,
  warnings: string[]
): Partial<WorkspaceConfigSource> | null {
  const file = repoConfigPath(repoRoot);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    warnings.push(`Could not read ${file}: ${(err as Error).message}`);
    return null;
  }
  try {
    const table = parseToml(text);
    return tomlTableToSource(table);
  } catch (err) {
    warnings.push(`Failed to parse ${file}: ${(err as Error).message}. Using defaults.`);
    return null;
  }
}

function userScopeConfigPath(): string {
  return path.join(process.cwd(), "data", "workspace-config.json");
}

function readUserScopeConfig(warnings: string[]): Partial<WorkspaceConfigSource> | null {
  const file = userScopeConfigPath();
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
  try {
    return JSON.parse(text) as Partial<WorkspaceConfigSource>;
  } catch (err) {
    warnings.push(`Failed to parse user-scope workspace config: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validKind(k: unknown, scope: string, warnings: string[]): SessionKind | undefined {
  if (k === undefined) return undefined;
  if (isValidKind(k)) return k;
  warnings.push(`${scope}: defaultKind "${String(k)}" is invalid; ignored.`);
  return undefined;
}

function sanitizeEnv(
  env: Record<string, string> | undefined,
  scope: string,
  warnings: string[]
): Record<string, string> | undefined {
  if (!env) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_KEY_RE.test(k)) {
      warnings.push(`${scope}: env key "${k}" is not a valid identifier; ignored.`);
      continue;
    }
    if (RESERVED_ENV_KEYS.has(k) || k.startsWith("TERMINALX_")) {
      warnings.push(`${scope}: env key "${k}" is reserved and cannot be overridden; ignored.`);
      continue;
    }
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function normalizeSetup(
  setup: SetupScript | undefined,
  scope: string,
  warnings: string[]
): SetupScript | undefined {
  if (!setup) return undefined;
  if (typeof setup.command !== "string" || !setup.command.trim()) {
    warnings.push(`${scope}: setup.command is empty; ignored.`);
    return undefined;
  }
  return {
    command: setup.command,
    timeoutSeconds:
      typeof setup.timeoutSeconds === "number" && setup.timeoutSeconds > 0
        ? setup.timeoutSeconds
        : DEFAULT_SETUP_TIMEOUT_SECONDS,
  };
}

function normalizeScripts(
  scripts: Record<string, Omit<RunScript, "name">> | undefined,
  scope: string,
  warnings: string[]
): Record<string, Omit<RunScript, "name">> | undefined {
  if (!scripts) return undefined;
  const out: Record<string, Omit<RunScript, "name">> = {};
  for (const [name, s] of Object.entries(scripts)) {
    if (!s || typeof s.command !== "string" || !s.command.trim()) {
      warnings.push(`${scope}: script "${name}" has no command; ignored.`);
      continue;
    }
    out[name] = { command: s.command, description: s.description };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolveOptions {
  /** When known (at create time), the per-workspace port to interpolate into env. */
  port?: number;
}

export function resolveWorkspaceConfig(
  repoRoot: string,
  opts: ResolveOptions = {}
): ResolvedWorkspaceConfig {
  const safeRoot = resolveSafePath(repoRoot);
  assertNotSensitivePath(safeRoot);

  const warnings: string[] = [];
  const userSource = readUserScopeConfig(warnings);
  const repoSource = readRepoConfig(safeRoot, warnings);

  if (repoSource?.version !== undefined && repoSource.version !== 1) {
    warnings.push(`settings.toml version ${repoSource.version} is unknown; parsing best-effort.`);
  }

  const pick = <T>(repoV: T | undefined, userV: T | undefined, def: T): [T, ConfigScope] => {
    if (repoV !== undefined) return [repoV, "repo"];
    if (userV !== undefined) return [userV, "user"];
    return [def, "default"];
  };

  const [defaultKind, kindScope] = pick(
    validKind(repoSource?.defaultKind, "repo", warnings),
    validKind(userSource?.defaultKind, "user", warnings),
    BUILTIN.defaultKind
  );
  const [copyFiles, copyScope] = pick(
    repoSource?.copyFiles,
    userSource?.copyFiles,
    BUILTIN.copyFiles
  );
  const [rawEnv, envScope] = pick(
    sanitizeEnv(repoSource?.env, "repo", warnings),
    sanitizeEnv(userSource?.env, "user", warnings),
    BUILTIN.env
  );
  const [setup, setupScope] = pick(
    normalizeSetup(repoSource?.setup, "repo", warnings),
    normalizeSetup(userSource?.setup, "user", warnings),
    BUILTIN.setup
  );
  const [scriptsRecord, scriptsScope] = pick(
    normalizeScripts(repoSource?.scripts, "repo", warnings),
    normalizeScripts(userSource?.scripts, "user", warnings),
    undefined
  );

  // Interpolate env values against the resolved port (the only var known at
  // resolve time). Commands keep their ${...} tokens until execute time.
  const portScope: Record<string, string> =
    opts.port !== undefined ? { TERMINALX_PORT: String(opts.port) } : {};
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawEnv)) {
    env[k] = interpolate(v, portScope);
  }

  const scripts: RunScript[] = scriptsRecord
    ? Object.entries(scriptsRecord).map(([name, s]) => ({ name, ...s }))
    : BUILTIN.scripts;

  return {
    repoRoot: safeRoot,
    configPath: repoConfigPath(safeRoot),
    hasRepoConfig: repoSource !== null,
    defaultKind,
    copyFiles,
    env,
    setup,
    scripts,
    provenance: {
      defaultKind: kindScope,
      copyFiles: copyScope,
      env: envScope,
      setup: setupScope,
      scripts: scriptsScope,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// File copy (deliberately bypasses assertNotSensitivePath — see spec §4.5)
// ---------------------------------------------------------------------------

/**
 * Copy repo-root-relative files from a source checkout into a fresh worktree.
 * Confines source within `sourceRoot` and dest within `destRoot`; never touches
 * the global sensitive-path guard (which would reject `.env` by design). Missing
 * sources are skipped silently (Conductor's ".env if you have one"). Returns
 * non-fatal warnings for rejected/failed entries.
 */
export function copyConfiguredFiles(
  sourceRoot: string,
  destRoot: string,
  files: string[]
): { copied: string[]; warnings: string[] } {
  const copied: string[] = [];
  const warnings: string[] = [];
  const srcRootAbs = path.resolve(sourceRoot);
  const destRootAbs = path.resolve(destRoot);

  const within = (root: string, p: string) => p === root || p.startsWith(root + path.sep);

  for (const rel of files) {
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
      warnings.push(`copyFiles: "${rel}" is not a repo-root-relative path; skipped`);
      continue;
    }
    const srcAbs = path.resolve(srcRootAbs, rel);
    const destAbs = path.resolve(destRootAbs, rel);
    if (!within(srcRootAbs, srcAbs) || !within(destRootAbs, destAbs)) {
      warnings.push(`copyFiles: "${rel}" escapes the repo/worktree root; skipped`);
      continue;
    }
    try {
      const stat = fs.statSync(srcAbs);
      if (!stat.isFile()) {
        warnings.push(`copyFiles: "${rel}" is not a regular file; skipped`);
        continue;
      }
      if (fs.existsSync(destAbs)) {
        warnings.push(`copyFiles: "${rel}" already exists in the worktree; skipped`);
        continue;
      }
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.copyFileSync(srcAbs, destAbs);
      copied.push(rel);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") continue; // optional source: ".env if you have one"
      warnings.push(`copyFiles: failed to copy "${rel}": ${e.message}`);
    }
  }
  return { copied, warnings };
}

// ---------------------------------------------------------------------------
// Template seed for "Create settings.toml"
// ---------------------------------------------------------------------------

export function settingsTomlTemplate(): string {
  return `# .terminalx/settings.toml — committed repo workspace config
# Conductor analog: .conductor/settings.toml

version = 1

[workspace]
# Default session kind for new workspaces: "bash" | "claude" | "codex".
defaultKind = "bash"
# Files copied into a freshly created worktree (".env if you have one").
copyFiles = [".env", ".env.local"]

[env]
# Static env exported into every session for this repo. NO secrets here.
# NODE_ENV = "development"
# NEXT_PUBLIC_API_BASE = "http://localhost:\${TERMINALX_PORT}"

# Setup script: runs once when a workspace is first created.
# [setup]
# command = "npm ci && npm run build"
# timeoutSeconds = 1800

# Named run scripts surface in the command palette as "run · <name>".
# [scripts.dev]
# description = "Start the dev server"
# command = "npm run dev -- --port \${TERMINALX_PORT}"
`;
}

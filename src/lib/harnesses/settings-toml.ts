// Repo/User-scoped harness config (issue #4, §6.3).
//
// Conductor commits repo config to `.conductor/settings.toml`; TerminalX's
// analog is `.terminalx/settings.toml` (repo) and `~/.terminalx/settings.toml`
// (user). Precedence per spec §6.3: env > repo TOML > user TOML > built-ins.
// Missing/invalid TOML degrades silently to defaults.
//
// Server-only. We hand-parse the tiny subset of TOML we need (string scalars +
// string arrays under [table] / [a.b] headers) rather than adding a TOML dep,
// keeping package.json merge-clean.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface HarnessSettings {
  /** Default harness id for new sessions in this scope ([defaults] harness). */
  defaultHarness?: string;
  /** Per-harness auth choice ([harness.<id>] auth = "cli" | "api-key"). */
  auth: Record<string, string>;
  /** OpenCode executable override ([harness.opencode] bin). */
  opencodeBin?: string;
  /** Configured OpenCode providers ([harness.opencode] providers). */
  opencodeProviders: string[];
  /** Selected OpenCode models ([harness.opencode] models). */
  opencodeModels: string[];
}

const EMPTY: HarnessSettings = {
  auth: {},
  opencodeProviders: [],
  opencodeModels: [],
};

/** Strip a trailing `# comment` that's outside a quoted string (best-effort). */
function stripComment(line: string): string {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inStr = !inStr;
    else if (c === "#" && !inStr) return line.slice(0, i);
  }
  return line;
}

function parseValue(raw: string): string | string[] {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return v.replace(/^["']|["']$/g, "");
}

/** Parse the minimal TOML subset into a flat { "table.key": value } map. */
function parseToml(text: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let table = "";
  for (const rawLine of text.split("\n")) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      table = (header[1] ?? "").trim();
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = parseValue(line.slice(eq + 1));
    out[table ? `${table}.${key}` : key] = value;
  }
  return out;
}

function asString(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function asArray(v: string | string[] | undefined): string[] {
  return Array.isArray(v) ? v : [];
}

export function parseHarnessSettings(text: string): HarnessSettings {
  let flat: Record<string, string | string[]>;
  try {
    flat = parseToml(text);
  } catch {
    return { ...EMPTY };
  }
  const auth: Record<string, string> = {};
  for (const k of Object.keys(flat)) {
    const m = k.match(/^harness\.([^.]+)\.auth$/);
    const harnessId = m?.[1];
    if (harnessId) {
      const val = asString(flat[k]);
      if (val) auth[harnessId] = val;
    }
  }
  return {
    defaultHarness: asString(flat["defaults.harness"]),
    auth,
    opencodeBin: asString(flat["harness.opencode.bin"]) || undefined,
    opencodeProviders: asArray(flat["harness.opencode.providers"]),
    opencodeModels: asArray(flat["harness.opencode.models"]),
  };
}

/** Load + parse a settings.toml file, returning empty on any error. */
export function loadHarnessSettingsFile(file: string): HarnessSettings {
  try {
    if (!fs.existsSync(file)) return { ...EMPTY };
    return parseHarnessSettings(fs.readFileSync(file, "utf-8"));
  } catch {
    return { ...EMPTY };
  }
}

export function repoSettingsPath(repoRoot: string): string {
  return path.join(repoRoot, ".terminalx", "settings.toml");
}

export function userSettingsPath(): string {
  return path.join(os.homedir(), ".terminalx", "settings.toml");
}

/**
 * Merge user + repo settings with repo taking precedence (repo overrides user;
 * both optional, degrade to built-in defaults). Env-layer overrides are applied
 * by callers (e.g. TERMINALX_OPENCODE_BIN in command.ts).
 */
export function resolveHarnessSettings(repoRoot?: string): HarnessSettings {
  const user = loadHarnessSettingsFile(userSettingsPath());
  const repo = repoRoot ? loadHarnessSettingsFile(repoSettingsPath(repoRoot)) : { ...EMPTY };
  return {
    defaultHarness: repo.defaultHarness ?? user.defaultHarness,
    auth: { ...user.auth, ...repo.auth },
    opencodeBin: repo.opencodeBin ?? user.opencodeBin,
    opencodeProviders: repo.opencodeProviders.length
      ? repo.opencodeProviders
      : user.opencodeProviders,
    opencodeModels: repo.opencodeModels.length ? repo.opencodeModels : user.opencodeModels,
  };
}

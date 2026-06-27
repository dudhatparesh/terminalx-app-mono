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
import { ensureSecureDir } from "../secure-dir";
import type { ConfiguredOpenCodeProvider } from "./opencode-providers";

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
  /**
   * Per-provider gateway endpoint base URLs, keyed by provider id. Persisted as
   * [harness.opencode.providers.<id>] endpoint = "..." (issue #8) so a Vercel AI
   * Gateway / OpenRouter provider keeps its base URL across save/reload.
   */
  opencodeProviderEndpoints: Record<string, string>;
}

const EMPTY: HarnessSettings = {
  auth: {},
  opencodeProviders: [],
  opencodeModels: [],
  opencodeProviderEndpoints: {},
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
  const opencodeProviderEndpoints: Record<string, string> = {};
  for (const k of Object.keys(flat)) {
    const m = k.match(/^harness\.([^.]+)\.auth$/);
    const harnessId = m?.[1];
    if (harnessId) {
      const val = asString(flat[k]);
      if (val) auth[harnessId] = val;
    }
    // [harness.opencode.providers.<id>] endpoint = "..." → per-provider base URL.
    const ep = k.match(/^harness\.opencode\.providers\.([^.]+)\.endpoint$/);
    const providerId = ep?.[1];
    if (providerId) {
      const val = asString(flat[k]);
      if (val) opencodeProviderEndpoints[providerId] = val;
    }
  }
  return {
    defaultHarness: asString(flat["defaults.harness"]),
    auth,
    opencodeBin: asString(flat["harness.opencode.bin"]) || undefined,
    opencodeProviders: asArray(flat["harness.opencode.providers"]),
    opencodeModels: asArray(flat["harness.opencode.models"]),
    opencodeProviderEndpoints,
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
    opencodeProviderEndpoints: {
      ...user.opencodeProviderEndpoints,
      ...repo.opencodeProviderEndpoints,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #8: write/read the OpenCode provider config (the [harness.opencode]
// providers/models keys §6.3). NON-SECRET keys ONLY — TerminalX never persists
// a provider secret here (spec §6, AC-7/AC-10). The picker's "Add provider"
// flow upserts the provider id (+ enabled models, + gateway endpoint) into the
// scoped settings.toml; "Remove" deletes it.
// ─────────────────────────────────────────────────────────────────────────────

/** Keys this module is allowed to write under [harness.opencode]. NO secret keys. */
type OpenCodeBlock = {
  bin?: string;
  providers: string[];
  models: string[];
  /** Per-provider gateway endpoint base URLs (issue #8). NON-SECRET. */
  providerEndpoints: Record<string, string>;
};

function quote(s: string): string {
  // Minimal TOML string escaping for the constrained values we write
  // (provider ids, model ids, endpoint URLs). Escape backslash + double-quote.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function arr(values: string[]): string {
  return `[${values.map(quote).join(", ")}]`;
}

/** Render the canonical [harness.opencode] block (sorted-stable, dedup'd). */
function renderOpenCodeBlock(block: OpenCodeBlock): string {
  const lines = ["[harness.opencode]"];
  if (block.bin !== undefined) lines.push(`bin = ${quote(block.bin)}`);
  lines.push(`providers = ${arr(block.providers)}`);
  lines.push(`models = ${arr(block.models)}`);
  // Per-provider endpoint sub-tables (issue #8). Emitted in provider order, and
  // only for providers that still carry an endpoint, so non-gateway providers
  // produce no endpoint key at all.
  for (const id of block.providers) {
    const endpoint = block.providerEndpoints[id];
    if (!endpoint) continue;
    lines.push("", `[harness.opencode.providers.${id}]`, `endpoint = ${quote(endpoint)}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Replace (or insert) the [harness.opencode] table in `text` with `block`,
 * preserving every other table verbatim. We slice out the existing block by
 * locating its header and the next top-level [header], then splice the rendered
 * block in its place (or append it when absent).
 */
function spliceOpenCodeBlock(text: string, block: OpenCodeBlock): string {
  const lines = text.split("\n");
  const headerRe = /^\s*\[([^\]]+)\]\s*$/;
  // The block owns [harness.opencode] AND its nested [harness.opencode.<...>]
  // sub-tables (e.g. providers.<id>.endpoint, issue #8): they must be spliced as
  // a unit so re-rendering replaces stale endpoint sub-tables instead of
  // leaving duplicates.
  const ownsTable = (t: string) => t === "harness.opencode" || t.startsWith("harness.opencode.");
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]?.match(headerRe);
    if (!m) continue;
    const table = (m[1] ?? "").trim();
    if (start === -1) {
      if (ownsTable(table)) start = i;
    } else if (!ownsTable(table)) {
      // first header outside the block we're replacing
      end = i;
      break;
    }
  }

  const rendered = renderOpenCodeBlock(block).replace(/\n$/, "");

  if (start === -1) {
    // No existing block — append (with a separating blank line if needed).
    const base = text.replace(/\s*$/, "");
    return (base ? base + "\n\n" : "") + rendered + "\n";
  }

  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const merged = [...before, ...rendered.split("\n"), ...after].join("\n");
  // Collapse 3+ blank lines that splicing may introduce.
  return merged.replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "") + "\n";
}

/**
 * Upsert a configured OpenCode provider into raw settings.toml content. Adds the
 * provider id (dedup'd, order-preserving) and unions its `models` into the
 * block's models. Returns the new TOML string. Pure (no fs).
 */
export function upsertOpenCodeProviderToml(
  text: string,
  provider: ConfiguredOpenCodeProvider
): string {
  const current = parseHarnessSettings(text);
  const providers = current.opencodeProviders.slice();
  if (!providers.includes(provider.providerId)) providers.push(provider.providerId);

  const models = current.opencodeModels.slice();
  for (const m of provider.models ?? []) {
    if (m && !models.includes(m)) models.push(m);
  }

  // Persist this provider's gateway endpoint (issue #8) without disturbing
  // other providers' endpoints. A blank/absent endpoint clears any prior value.
  const providerEndpoints = { ...current.opencodeProviderEndpoints };
  const endpoint = provider.endpoint?.trim();
  if (endpoint) providerEndpoints[provider.providerId] = endpoint;
  else delete providerEndpoints[provider.providerId];

  return spliceOpenCodeBlock(text, {
    bin: current.opencodeBin,
    providers,
    models,
    providerEndpoints,
  });
}

/** Remove a configured OpenCode provider id from raw settings.toml content. Pure. */
export function removeOpenCodeProviderToml(text: string, providerId: string): string {
  const current = parseHarnessSettings(text);
  const providers = current.opencodeProviders.filter((p) => p !== providerId);
  const providerEndpoints = { ...current.opencodeProviderEndpoints };
  delete providerEndpoints[providerId];
  return spliceOpenCodeBlock(text, {
    bin: current.opencodeBin,
    providers,
    models: current.opencodeModels,
    providerEndpoints,
  });
}

/** Resolve the settings.toml path for a scope. */
function scopedSettingsPath(scope: "user" | "repo", repoRoot?: string): string {
  if (scope === "repo") {
    if (!repoRoot) throw new Error("repoRoot is required for repo scope");
    return repoSettingsPath(repoRoot);
  }
  return userSettingsPath();
}

function readFileOrEmpty(file: string): string {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return "";
  }
}

/** The non-secret OpenCode config surfaced to the UI counts. */
export interface OpenCodeProviderConfig {
  providers: string[];
  models: string[];
  bin?: string;
  /** Per-provider gateway endpoints, keyed by provider id (issue #8). */
  endpoints: Record<string, string>;
}

/** Read the [harness.opencode] providers/models for a scope (degrades to empty). */
export function readOpenCodeProviderConfig(
  repoRoot?: string,
  scope: "user" | "repo" = "repo"
): OpenCodeProviderConfig {
  const s = loadHarnessSettingsFile(scopedSettingsPath(scope, repoRoot));
  return {
    providers: s.opencodeProviders,
    models: s.opencodeModels,
    bin: s.opencodeBin,
    endpoints: s.opencodeProviderEndpoints,
  };
}

/**
 * Persist a configured provider to the scoped settings.toml (creating the
 * .terminalx dir as needed). Writes ONLY non-secret keys. The committed repo
 * file is mode 0644 (it is checked in); the user file is 0600 in a 0700 dir.
 */
export function writeOpenCodeProviderConfig(
  provider: ConfiguredOpenCodeProvider,
  repoRoot?: string
): void {
  const file = scopedSettingsPath(provider.scope, repoRoot);
  const next = upsertOpenCodeProviderToml(readFileOrEmpty(file), provider);
  ensureSecureDir(path.dirname(file));
  const mode = provider.scope === "repo" ? 0o644 : 0o600;
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, next, { encoding: "utf-8", mode });
  fs.renameSync(tmp, file);
}

/** Remove a configured provider from the scoped settings.toml. */
export function removeOpenCodeProviderConfig(
  providerId: string,
  repoRoot?: string,
  scope: "user" | "repo" = "repo"
): void {
  const file = scopedSettingsPath(scope, repoRoot);
  const existing = readFileOrEmpty(file);
  if (!existing) return; // nothing to remove
  const next = removeOpenCodeProviderToml(existing, providerId);
  ensureSecureDir(path.dirname(file));
  const mode = scope === "repo" ? 0o644 : 0o600;
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, next, { encoding: "utf-8", mode });
  fs.renameSync(tmp, file);
}

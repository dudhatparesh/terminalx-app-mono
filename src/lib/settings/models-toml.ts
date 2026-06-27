// Round-trip-safe TOML <-> ScopedSettings for `.terminalx/settings.toml`
// (issue #11, §1.4 + §3.2).
//
// The spec suggests adding `@iarna/toml`, but TerminalX keeps package.json
// merge-clean (no new runtime deps — see harnesses/settings-toml.ts). Instead we
// parse/serialize just the [models.*] tables we own and PRESERVE every other
// line byte-for-byte, so sibling specs' tables (harness, environment, …) survive
// a round trip untouched. Pure string ops only — client-safe, but lives under
// settings/ and is only imported by the server store.

import {
  isCodexPersonality,
  isEffortLevel,
  type ModelChoice,
  type ModelSettings,
  type ScopedSettings,
} from "./types";

// ---- value scalars ---------------------------------------------------------

function tomlString(s: string): string {
  // Minimal escaping for the small id/effort/personality value space.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseScalar(raw: string): string | boolean | null {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  if (v === "") return null;
  return v;
}

function stripComment(line: string): string {
  let inStr = false;
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === quote) inStr = false;
    } else if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
    } else if (c === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

// ---- parse -----------------------------------------------------------------

/**
 * Parse the [models] / [models.defaultModel] / [models.reviewModel] tables out
 * of a settings.toml document. Returns the Partial<ModelSettings> plus a flag of
 * whether parsing hit a structural problem (caller surfaces a non-blocking
 * warning rather than clobbering the file).
 */
export function parseModelsToml(text: string): {
  models: Partial<ModelSettings>;
  parseError: boolean;
} {
  const models: Partial<ModelSettings> = {};
  let table = "";
  let parseError = false;

  const setChoice = (key: "defaultModel" | "reviewModel", field: string, value: unknown) => {
    const existing = (models[key] ?? { modelId: null, effort: null }) as ModelChoice;
    if (field === "modelId" && (typeof value === "string" || value === null)) {
      existing.modelId = (value as string) || null;
    } else if (field === "effort") {
      existing.effort = isEffortLevel(value) ? value : null;
    }
    models[key] = existing;
  };

  try {
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
      const value = parseScalar(line.slice(eq + 1));

      if (table === "models.defaultModel") setChoice("defaultModel", key, value);
      else if (table === "models.reviewModel") setChoice("reviewModel", key, value);
      else if (table === "models") {
        if (key === "codexPersonality") {
          models.codexPersonality = isCodexPersonality(value) ? value : null;
        } else if (key === "defaultToPlanMode" && typeof value === "boolean") {
          models.defaultToPlanMode = value;
        } else if (key === "defaultToFastMode" && typeof value === "boolean") {
          models.defaultToFastMode = value;
        } else if (key === "useClaudeCodeWithChrome" && typeof value === "boolean") {
          models.useClaudeCodeWithChrome = value;
        }
      }
    }
  } catch {
    parseError = true;
  }

  return { models, parseError };
}

/**
 * Parse a full settings.toml into a ScopedSettings, preserving the raw text so a
 * later write can keep non-models tables byte-for-byte. `version` defaults to 1.
 */
export function readScopedToml(text: string): {
  settings: ScopedSettings;
  raw: string;
  parseError: boolean;
} {
  const { models, parseError } = parseModelsToml(text);
  // best-effort version read
  const m = text.match(/^\s*version\s*=\s*(\d+)/m);
  const version = (m ? Number(m[1]) : 1) as 1;
  return {
    settings: { version, models: Object.keys(models).length ? models : undefined },
    raw: text,
    parseError,
  };
}

// ---- serialize -------------------------------------------------------------

function serializeModelsBlock(models: Partial<ModelSettings>): string {
  const lines: string[] = [];

  const choice = (header: string, c?: ModelChoice) => {
    if (!c) return;
    const body: string[] = [];
    if (c.modelId != null) body.push(`modelId = ${tomlString(c.modelId)}`);
    if (c.effort != null) body.push(`effort = ${tomlString(c.effort)}`);
    if (body.length) {
      lines.push(`[${header}]`, ...body, "");
    }
  };

  choice("models.defaultModel", models.defaultModel);
  choice("models.reviewModel", models.reviewModel);

  const scalar: string[] = [];
  if (models.codexPersonality != null) {
    scalar.push(`codexPersonality = ${tomlString(models.codexPersonality)}`);
  }
  if (models.defaultToPlanMode != null) {
    scalar.push(`defaultToPlanMode = ${models.defaultToPlanMode}`);
  }
  if (models.defaultToFastMode != null) {
    scalar.push(`defaultToFastMode = ${models.defaultToFastMode}`);
  }
  if (models.useClaudeCodeWithChrome != null) {
    scalar.push(`useClaudeCodeWithChrome = ${models.useClaudeCodeWithChrome}`);
  }
  if (scalar.length) lines.push("[models]", ...scalar, "");

  return lines.join("\n");
}

/**
 * Split a document into the [models.*] region and everything else. Any line
 * belonging to a `models` / `models.defaultModel` / `models.reviewModel` table
 * (and that table's header) is dropped; all other lines are preserved verbatim
 * so sibling tables round-trip untouched.
 */
function stripModelsTables(text: string): string {
  const out: string[] = [];
  let inModels = false;
  for (const rawLine of text.split("\n")) {
    const header = stripComment(rawLine)
      .trim()
      .match(/^\[([^\]]+)\]$/);
    if (header) {
      const t = (header[1] ?? "").trim();
      inModels = t === "models" || t === "models.defaultModel" || t === "models.reviewModel";
      if (inModels) continue;
    }
    if (!inModels) out.push(rawLine);
  }
  return out.join("\n");
}

/**
 * Serialize a ScopedSettings to TOML, preserving any non-models content present
 * in `priorText` (round-trip-safe per §3.2). `version` is emitted once at the
 * top if not already present in the preserved content.
 */
export function writeScopedToml(next: ScopedSettings, priorText = ""): string {
  const preserved = stripModelsTables(priorText)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const hasVersion = /^\s*version\s*=/m.test(preserved);

  const parts: string[] = [];
  parts.push(
    `# .terminalx/settings.toml — committed; analog of Conductor's .conductor/settings.toml`
  );
  if (!hasVersion) parts.push(`version = ${next.version ?? 1}`, "");
  if (preserved) parts.push(preserved, "");

  if (next.models && Object.keys(next.models).length) {
    parts.push(serializeModelsBlock(next.models));
  }

  return (
    parts
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

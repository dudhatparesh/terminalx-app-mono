// Models & harness settings types (issue #11).
//
// Client-safe: this module declares ONLY types + tiny pure const tables, no Node
// built-ins, so both the API routes (server) and ModelsSettingsPage ("use
// client") can import it directly.

/** Effort levels offered in the "Effort" dropdowns. Conductor shows e.g. "Effort high". */
export type EffortLevel = "low" | "medium" | "high" | "max";

/** The closed set of effort levels, in display order. */
export const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "max"];

export function isEffortLevel(v: unknown): v is EffortLevel {
  return typeof v === "string" && (EFFORT_LEVELS as string[]).includes(v);
}

/** A model+effort pairing, used by both Default model and Review model rows. */
export interface ModelChoice {
  /**
   * Provider-qualified model id from the registry.
   * Examples: "claude:opus-4-8-1m", "codex:gpt-5-codex".
   * `null` means "inherit" (repo scope falls back to user scope; user scope
   * falls back to the registry default).
   */
  modelId: string | null;

  /** Reasoning/effort level. `null` means inherit. */
  effort: EffortLevel | null;
}

/** Codex personality presets. "pragmatic" is the default (label "Pragmatic (default)"). */
export type CodexPersonality = "pragmatic" | "concise" | "thorough" | "friendly";

export const CODEX_PERSONALITIES: Array<{ id: CodexPersonality; label: string }> = [
  { id: "pragmatic", label: "Pragmatic (default)" },
  { id: "concise", label: "Concise" },
  { id: "thorough", label: "Thorough" },
  { id: "friendly", label: "Friendly" },
];

export function isCodexPersonality(v: unknown): v is CodexPersonality {
  return typeof v === "string" && CODEX_PERSONALITIES.some((p) => p.id === (v as CodexPersonality));
}

/**
 * The Models settings page payload. Every field is optional/nullable so that an
 * unset field at one scope transparently inherits from the lower-precedence scope.
 */
export interface ModelSettings {
  /** "Default model" row — model for new chats. */
  defaultModel: ModelChoice;

  /**
   * "Review model" row — model for code reviews. SEPARATE from defaultModel.
   * Consumed by the PR-review surface, never by session authoring.
   */
  reviewModel: ModelChoice;

  /** "Codex personality for new chats". `null` inherits. */
  codexPersonality: CodexPersonality | null;

  /** "Default to plan mode" — start new chats in plan mode. `null` inherits. */
  defaultToPlanMode: boolean | null;

  /** "Default to fast mode" — start new chats in fast mode. `null` inherits. */
  defaultToFastMode: boolean | null;

  /** "Use Claude Code with Chrome". `null` inherits. */
  useClaudeCodeWithChrome: boolean | null;
}

/** The keys of ModelSettings, used for per-field provenance. */
export type ModelSettingsField = keyof ModelSettings;

export type SettingsScope = "user" | "repo";

/**
 * The full settings document for one scope. Models is the only section this spec
 * owns; sibling sections (harnesses, environment, git, appearance) are typed
 * here as opaque pass-through so a single file/route serves all settings pages.
 */
export interface ScopedSettings {
  /** Schema version for migrations. */
  version: 1;
  models?: Partial<ModelSettings>;
  // Reserved for sibling specs; preserved verbatim on read/write:
  harnesses?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  git?: Record<string, unknown>;
  appearance?: Record<string, unknown>;
}

/**
 * The resolved, fully-defaulted Models settings the UI and command generation
 * use. Produced by merging registry defaults < user scope < repo scope.
 */
export interface ResolvedModelSettings {
  defaultModel: { modelId: string; effort: EffortLevel };
  reviewModel: { modelId: string; effort: EffortLevel };
  codexPersonality: CodexPersonality;
  defaultToPlanMode: boolean;
  defaultToFastMode: boolean;
  useClaudeCodeWithChrome: boolean;
  /** Per-field provenance so the UI can render "inherited from User" hints. */
  source: Record<ModelSettingsField, SettingsScope | "default">;
}

/** A model option exposed by GET /api/settings/models/options. */
export interface ModelOption {
  id: string;
  label: string;
  /** groups options by harness sub-tab */
  harness: string;
  /** CLI installed + configured */
  available: boolean;
  /** tooltip shown when `available` is false */
  unavailableReason?: string;
  supportedEfforts: EffortLevel[];
}

export interface ModelOptionsPayload {
  models: ModelOption[];
  efforts: EffortLevel[];
  codexPersonalities: Array<{ id: CodexPersonality; label: string }>;
}

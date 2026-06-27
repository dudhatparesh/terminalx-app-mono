// Resolution: registry defaults < user scope < repo scope (issue #11, §3.3).
//
// Pure / client-safe (no Node built-ins). Each field is resolved independently:
// a null/absent field at a higher-precedence scope falls through to the next
// lower scope, and `source[field]` records where the winning value came from.

import { registryDefaultModel } from "./model-catalog";
import type {
  CodexPersonality,
  EffortLevel,
  ModelChoice,
  ModelSettings,
  ModelSettingsField,
  ResolvedModelSettings,
  ScopedSettings,
  SettingsScope,
} from "./types";

/** Hard fallback if the catalog is somehow empty (keeps the UI renderable). */
const FALLBACK_MODEL: { modelId: string; effort: EffortLevel } = {
  modelId: "claude:opus-4-8-1m",
  effort: "high",
};

type Provenance = SettingsScope | "default";

/** Pick the first scope (repo > user) that sets `field`, else "default". */
function pick<T>(
  field: ModelSettingsField,
  repo: Partial<ModelSettings> | undefined,
  user: Partial<ModelSettings> | undefined,
  read: (m: Partial<ModelSettings>) => T | null | undefined
): { value: T | null; source: Provenance } {
  if (repo) {
    const v = read(repo);
    if (v !== null && v !== undefined) return { value: v, source: "repo" };
  }
  if (user) {
    const v = read(user);
    if (v !== null && v !== undefined) return { value: v, source: "user" };
  }
  return { value: null, source: "default" };
}

/**
 * Resolve a ModelChoice field. A choice is "set" at a scope if EITHER its
 * modelId or effort is non-null there; modelId and effort each resolve
 * independently so a repo can override only the effort.
 */
function resolveChoice(
  field: ModelSettingsField,
  repo: Partial<ModelSettings> | undefined,
  user: Partial<ModelSettings> | undefined,
  registryDefault: { modelId: string; effort: EffortLevel }
): { value: { modelId: string; effort: EffortLevel }; source: Provenance } {
  const read = (m: Partial<ModelSettings>) => m[field] as ModelChoice | undefined;

  const modelId = pick(field, repo, user, (m) => read(m)?.modelId ?? null);
  const effort = pick(field, repo, user, (m) => read(m)?.effort ?? null);

  // Provenance for the row = the highest scope that contributed any part.
  const order: Provenance[] = ["repo", "user", "default"];
  const source = order.find((s) => modelId.source === s || effort.source === s) ?? "default";

  return {
    value: {
      modelId: modelId.value ?? registryDefault.modelId,
      effort: (effort.value as EffortLevel | null) ?? registryDefault.effort,
    },
    source,
  };
}

/**
 * Merge registry defaults < user < repo into a fully-defaulted
 * ResolvedModelSettings with per-field provenance.
 */
export function resolveModelSettings(
  user: Partial<ModelSettings> | undefined,
  repo: Partial<ModelSettings> | undefined
): ResolvedModelSettings {
  const registryDefault = registryDefaultModel() ?? FALLBACK_MODEL;

  const defaultModel = resolveChoice("defaultModel", repo, user, registryDefault);
  // Review model defaults to the same registry model/effort, but is stored and
  // resolved as a DISTINCT field (changing Default later never moves Review).
  const reviewModel = resolveChoice("reviewModel", repo, user, registryDefault);

  const codexPersonality = pick("codexPersonality", repo, user, (m) => m.codexPersonality ?? null);
  const planMode = pick("defaultToPlanMode", repo, user, (m) => m.defaultToPlanMode ?? null);
  const fastMode = pick("defaultToFastMode", repo, user, (m) => m.defaultToFastMode ?? null);
  const chrome = pick(
    "useClaudeCodeWithChrome",
    repo,
    user,
    (m) => m.useClaudeCodeWithChrome ?? null
  );

  return {
    defaultModel: defaultModel.value,
    reviewModel: reviewModel.value,
    codexPersonality: (codexPersonality.value as CodexPersonality | null) ?? "pragmatic",
    defaultToPlanMode: planMode.value ?? false,
    defaultToFastMode: fastMode.value ?? false,
    useClaudeCodeWithChrome: chrome.value ?? false,
    source: {
      defaultModel: defaultModel.source,
      reviewModel: reviewModel.source,
      codexPersonality: codexPersonality.source,
      defaultToPlanMode: planMode.source,
      defaultToFastMode: fastMode.source,
      useClaudeCodeWithChrome: chrome.source,
    },
  };
}

/** Convenience: resolve directly from two ScopedSettings documents. */
export function resolveFromScopes(
  user: ScopedSettings | undefined,
  repo: ScopedSettings | undefined
): ResolvedModelSettings {
  return resolveModelSettings(user?.models, repo?.models);
}

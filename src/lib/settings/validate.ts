// Validation for a PUT /api/settings models patch (issue #11, §2.2 + Edge Cases).
//
// Pure / client-safe. Rejects unknown modelIds, invalid efforts, and efforts not
// supported by the selected model. Returns either a sanitized patch or an error
// string the route turns into a 400.

import { buildModelOptions, knownModelIds } from "./model-catalog";
import { isCodexPersonality, isEffortLevel, type ModelChoice, type ModelSettings } from "./types";

export type ValidateResult =
  | { ok: true; patch: Partial<ModelSettings> }
  | { ok: false; error: string };

function validateChoice(
  field: "defaultModel" | "reviewModel",
  raw: unknown
): { ok: true; value: ModelChoice | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "object") return { ok: false, error: `${field} must be an object or null` };
  const c = raw as Record<string, unknown>;

  let modelId: string | null = null;
  if ("modelId" in c) {
    if (c.modelId === null) modelId = null;
    else if (typeof c.modelId === "string") {
      // A non-empty, unknown modelId is rejected. (Already-stored unknown ids are
      // retained verbatim on read; this only guards new writes.)
      if (c.modelId && !knownModelIds().has(c.modelId)) {
        return { ok: false, error: `unknown modelId: ${c.modelId}` };
      }
      modelId = c.modelId || null;
    } else return { ok: false, error: `${field}.modelId must be a string or null` };
  }

  let effort: ModelChoice["effort"] = null;
  if ("effort" in c) {
    if (c.effort === null) effort = null;
    else if (isEffortLevel(c.effort)) effort = c.effort;
    else return { ok: false, error: `${field}.effort is invalid` };
  }

  // Effort must be supported by the selected model (spec Edge Cases).
  if (modelId && effort) {
    const opt = buildModelOptions().find((o) => o.id === modelId);
    if (opt && !opt.supportedEfforts.includes(effort)) {
      return { ok: false, error: `effort "${effort}" not supported by ${modelId}` };
    }
  }

  return { ok: true, value: { modelId, effort } };
}

export function validateModelsPatch(raw: unknown): ValidateResult {
  if (raw === null || raw === undefined) return { ok: true, patch: {} };
  if (typeof raw !== "object") return { ok: false, error: "models must be an object" };
  const body = raw as Record<string, unknown>;
  const patch: Partial<ModelSettings> = {};

  for (const field of ["defaultModel", "reviewModel"] as const) {
    if (field in body) {
      const r = validateChoice(field, body[field]);
      if (!r.ok) return r;
      patch[field] = r.value as never;
    }
  }

  if ("codexPersonality" in body) {
    const v = body.codexPersonality;
    if (v === null) patch.codexPersonality = null;
    else if (isCodexPersonality(v)) patch.codexPersonality = v;
    else return { ok: false, error: "codexPersonality is invalid" };
  }

  for (const field of [
    "defaultToPlanMode",
    "defaultToFastMode",
    "useClaudeCodeWithChrome",
  ] as const) {
    if (field in body) {
      const v = body[field];
      if (v === null || typeof v === "boolean") patch[field] = v;
      else return { ok: false, error: `${field} must be a boolean or null` };
    }
  }

  return { ok: true, patch };
}

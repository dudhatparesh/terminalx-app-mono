import { describe, it, expect } from "vitest";
import { validateModelsPatch } from "@/lib/settings/validate";
import { knownModelIds, buildModelOptions } from "@/lib/settings/model-catalog";

const someModel = [...knownModelIds()][0]!;

describe("validateModelsPatch", () => {
  it("accepts an empty / undefined patch", () => {
    expect(validateModelsPatch(undefined)).toEqual({ ok: true, patch: {} });
    expect(validateModelsPatch({})).toEqual({ ok: true, patch: {} });
  });

  it("accepts a known modelId with a supported effort", () => {
    const r = validateModelsPatch({ defaultModel: { modelId: someModel, effort: "high" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.defaultModel).toEqual({ modelId: someModel, effort: "high" });
  });

  it("rejects an unknown modelId", () => {
    const r = validateModelsPatch({ defaultModel: { modelId: "nope:nope", effort: "high" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown modelId/);
  });

  it("rejects an invalid effort", () => {
    const r = validateModelsPatch({
      defaultModel: { modelId: someModel, effort: "turbo" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/effort/);
  });

  it("rejects an effort not in the model's supportedEfforts", () => {
    // Find a model whose supportedEfforts excludes something, then force it.
    const opt = buildModelOptions().find((o) => o.supportedEfforts.length < 4);
    if (!opt) return; // all models support all efforts in the catalog; skip
    const missing = (["low", "medium", "high", "max"] as const).find(
      (e) => !opt.supportedEfforts.includes(e)
    )!;
    const r = validateModelsPatch({ defaultModel: { modelId: opt.id, effort: missing } });
    expect(r.ok).toBe(false);
  });

  it("accepts null to clear a field (re-enable inheritance)", () => {
    const r = validateModelsPatch({ defaultModel: null, codexPersonality: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.defaultModel).toBeNull();
      expect(r.patch.codexPersonality).toBeNull();
    }
  });

  it("validates codexPersonality", () => {
    expect(validateModelsPatch({ codexPersonality: "thorough" }).ok).toBe(true);
    expect(validateModelsPatch({ codexPersonality: "snarky" }).ok).toBe(false);
  });

  it("validates boolean toggles", () => {
    expect(validateModelsPatch({ defaultToPlanMode: true }).ok).toBe(true);
    expect(validateModelsPatch({ defaultToFastMode: 1 as unknown }).ok).toBe(false);
  });

  it("allows the review model to be set independently", () => {
    const r = validateModelsPatch({ reviewModel: { modelId: someModel, effort: "low" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.reviewModel).toEqual({ modelId: someModel, effort: "low" });
  });
});

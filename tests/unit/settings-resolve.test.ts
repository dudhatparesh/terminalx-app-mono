import { describe, it, expect } from "vitest";
import { resolveModelSettings } from "@/lib/settings/resolve";
import { registryDefaultModel } from "@/lib/settings/model-catalog";
import type { ModelSettings } from "@/lib/settings/types";

describe("resolveModelSettings — precedence registry < user < repo", () => {
  it("returns registry defaults when nothing is set", () => {
    const r = resolveModelSettings(undefined, undefined);
    const def = registryDefaultModel()!;
    expect(r.defaultModel).toEqual(def);
    expect(r.reviewModel).toEqual(def);
    expect(r.codexPersonality).toBe("pragmatic");
    expect(r.defaultToPlanMode).toBe(false);
    expect(r.defaultToFastMode).toBe(false);
    expect(r.useClaudeCodeWithChrome).toBe(false);
    expect(r.source.defaultModel).toBe("default");
    expect(r.source.reviewModel).toBe("default");
    expect(r.source.codexPersonality).toBe("default");
  });

  it("user scope overrides defaults with provenance 'user'", () => {
    const user: Partial<ModelSettings> = {
      defaultModel: { modelId: "codex:gpt-5-codex", effort: "low" },
      defaultToPlanMode: true,
    };
    const r = resolveModelSettings(user, undefined);
    expect(r.defaultModel).toEqual({ modelId: "codex:gpt-5-codex", effort: "low" });
    expect(r.source.defaultModel).toBe("user");
    expect(r.defaultToPlanMode).toBe(true);
    expect(r.source.defaultToPlanMode).toBe("user");
    // unset stays default
    expect(r.source.defaultToFastMode).toBe("default");
  });

  it("repo scope wins over user, per-field", () => {
    const user: Partial<ModelSettings> = {
      defaultModel: { modelId: "claude:opus-4-8-1m", effort: "high" },
      codexPersonality: "concise",
    };
    const repo: Partial<ModelSettings> = {
      defaultModel: { modelId: "codex:gpt-5-codex", effort: "max" },
    };
    const r = resolveModelSettings(user, repo);
    expect(r.defaultModel).toEqual({ modelId: "codex:gpt-5-codex", effort: "max" });
    expect(r.source.defaultModel).toBe("repo");
    // codexPersonality unset at repo → inherits user
    expect(r.codexPersonality).toBe("concise");
    expect(r.source.codexPersonality).toBe("user");
  });

  it("review model is independent from default model", () => {
    const user: Partial<ModelSettings> = {
      defaultModel: { modelId: "claude:opus-4-8-1m", effort: "high" },
      reviewModel: { modelId: "codex:gpt-5-codex", effort: "medium" },
    };
    const r = resolveModelSettings(user, undefined);
    expect(r.defaultModel.modelId).toBe("claude:opus-4-8-1m");
    expect(r.reviewModel.modelId).toBe("codex:gpt-5-codex");
    expect(r.reviewModel.effort).toBe("medium");
  });

  it("a null sub-field falls through to the lower scope", () => {
    const user: Partial<ModelSettings> = {
      defaultModel: { modelId: "codex:gpt-5-codex", effort: "low" },
    };
    const repo: Partial<ModelSettings> = {
      // repo overrides only effort; modelId inherits from user
      defaultModel: { modelId: null, effort: "max" },
    };
    const r = resolveModelSettings(user, repo);
    expect(r.defaultModel.modelId).toBe("codex:gpt-5-codex");
    expect(r.defaultModel.effort).toBe("max");
  });
});

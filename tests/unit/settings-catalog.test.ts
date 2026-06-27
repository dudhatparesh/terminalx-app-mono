import { describe, it, expect } from "vitest";
import {
  buildModelOptions,
  knownModelIds,
  modelIdFor,
  registryDefaultModel,
} from "@/lib/settings/model-catalog";

describe("model-catalog", () => {
  it("qualifies model ids as <harness>:<slug>", () => {
    expect(modelIdFor("claude", "opus-4-8-1m")).toBe("claude:opus-4-8-1m");
  });

  it("excludes bash (no models) and groups by harness", () => {
    const opts = buildModelOptions();
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => o.harness !== "bash")).toBe(true);
    expect(opts.some((o) => o.harness === "claude")).toBe(true);
    expect(opts.some((o) => o.harness === "codex")).toBe(true);
  });

  it("marks models unavailable with a reason when the harness is unavailable", () => {
    const opts = buildModelOptions({ claude: false });
    const claude = opts.filter((o) => o.harness === "claude");
    expect(claude.length).toBeGreaterThan(0);
    expect(claude.every((o) => o.available === false)).toBe(true);
    expect(claude.every((o) => typeof o.unavailableReason === "string")).toBe(true);
  });

  it("defaults all harnesses available when no availability map is given", () => {
    const opts = buildModelOptions();
    expect(opts.every((o) => o.available)).toBe(true);
  });

  it("registryDefaultModel returns the first model at effort high", () => {
    const def = registryDefaultModel()!;
    expect(def.effort).toBe("high");
    expect(knownModelIds().has(def.modelId)).toBe(true);
  });
});

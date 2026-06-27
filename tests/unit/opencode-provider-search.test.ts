import { describe, it, expect } from "vitest";
import {
  ALL_OPENCODE_PROVIDERS,
  FEATURED_OPENCODE_PROVIDERS,
  TOTAL_OPENCODE_PROVIDERS,
  featuredProviders,
  providerCount,
  getProviderEntry,
  searchProviders,
} from "@/lib/harnesses/opencode-providers";

describe("opencode provider catalog (extended, issue #8)", () => {
  it("the full catalog totals exactly TOTAL_OPENCODE_PROVIDERS (96)", () => {
    expect(ALL_OPENCODE_PROVIDERS).toHaveLength(TOTAL_OPENCODE_PROVIDERS);
    expect(providerCount()).toBe(96);
  });

  it("the 7 featured rows lead the catalog in the documented order", () => {
    expect(featuredProviders()).toBe(FEATURED_OPENCODE_PROVIDERS);
    expect(ALL_OPENCODE_PROVIDERS.slice(0, 7).map((p) => p.id)).toEqual([
      "opencode-zen",
      "openai",
      "github-copilot",
      "anthropic",
      "google",
      "vercel",
      "openrouter",
    ]);
  });

  it("every catalog entry has a unique id", () => {
    const ids = ALL_OPENCODE_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks gateways endpointEditable and standard providers not", () => {
    expect(getProviderEntry("vercel")?.endpointEditable).toBe(true);
    expect(getProviderEntry("openrouter")?.endpointEditable).toBe(true);
    expect(getProviderEntry("anthropic")?.endpointEditable).toBeFalsy();
    expect(getProviderEntry("openai")?.endpointEditable).toBeFalsy();
  });

  it("carries the two-brand labels for OpenCode + GitHub", () => {
    expect(getProviderEntry("opencode-zen")?.brands).toEqual(["OpenCode Go", "OpenCode Zen"]);
    expect(getProviderEntry("github-copilot")?.brands).toEqual(["GitHub Copilot", "GitHub Models"]);
  });
});

describe("searchProviders (AC-4: filters across the full 96 by label + brands)", () => {
  it("empty query returns the entire catalog (View all = 96)", () => {
    expect(searchProviders("")).toHaveLength(96);
    expect(searchProviders("   ")).toHaveLength(96);
  });

  it("matches a featured label case-insensitively", () => {
    const hits = searchProviders("openrouter");
    expect(hits.map((p) => p.id)).toContain("openrouter");
  });

  it("matches a sub-brand that is not the row's primary label", () => {
    // "OpenCode Go" is a brand of the opencode-zen row, not its id/label start.
    const hits = searchProviders("opencode go");
    expect(hits.map((p) => p.id)).toContain("opencode-zen");
    // "GitHub Models" is the second brand on the github-copilot row.
    const gh = searchProviders("github models");
    expect(gh.map((p) => p.id)).toContain("github-copilot");
  });

  it("reaches into the lazily-fetched 96-entry tail (not just the 7 featured)", () => {
    const all = searchProviders("");
    const tail = all.filter((p) => !p.featured);
    expect(tail.length).toBe(96 - FEATURED_OPENCODE_PROVIDERS.length);
    // A representative tail provider is searchable.
    const sample = tail[0]!;
    const hits = searchProviders(sample.label);
    expect(hits.map((p) => p.id)).toContain(sample.id);
  });

  it("returns nothing for a nonsense query", () => {
    expect(searchProviders("zzz-not-a-provider-zzz")).toHaveLength(0);
  });

  it("does NOT surface chatgpt/gemini as canonical featured ids (AC-6)", () => {
    expect(FEATURED_OPENCODE_PROVIDERS.some((p) => p.id === "chatgpt")).toBe(false);
    expect(FEATURED_OPENCODE_PROVIDERS.some((p) => p.id === "gemini")).toBe(false);
    expect(FEATURED_OPENCODE_PROVIDERS.some((p) => p.id === "ollama")).toBe(false);
  });
});

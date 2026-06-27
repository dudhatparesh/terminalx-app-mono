import { describe, it, expect } from "vitest";
import { parseModelsToml, readScopedToml, writeScopedToml } from "@/lib/settings/models-toml";
import type { ScopedSettings } from "@/lib/settings/types";

const SAMPLE = `# .terminalx/settings.toml
version = 1

[models.defaultModel]
modelId = "claude:opus-4-8-1m"
effort = "high"

[models.reviewModel]
modelId = "codex:gpt-5-codex"   # review model is independent
effort = "medium"

[models]
codexPersonality = "pragmatic"
defaultToPlanMode = true
defaultToFastMode = false
useClaudeCodeWithChrome = false
`;

describe("parseModelsToml", () => {
  it("parses the spec example", () => {
    const { models, parseError } = parseModelsToml(SAMPLE);
    expect(parseError).toBe(false);
    expect(models.defaultModel).toEqual({ modelId: "claude:opus-4-8-1m", effort: "high" });
    expect(models.reviewModel).toEqual({ modelId: "codex:gpt-5-codex", effort: "medium" });
    expect(models.codexPersonality).toBe("pragmatic");
    expect(models.defaultToPlanMode).toBe(true);
    expect(models.defaultToFastMode).toBe(false);
    expect(models.useClaudeCodeWithChrome).toBe(false);
  });

  it("strips trailing comments outside strings", () => {
    const { models } = parseModelsToml(`[models]\ncodexPersonality = "concise" # nice`);
    expect(models.codexPersonality).toBe("concise");
  });

  it("rejects an invalid effort (treated as null)", () => {
    const { models } = parseModelsToml(`[models.defaultModel]\neffort = "ludicrous"`);
    expect(models.defaultModel?.effort).toBeNull();
  });
});

describe("writeScopedToml round-trip", () => {
  it("round-trips models content", () => {
    const { settings } = readScopedToml(SAMPLE);
    const out = writeScopedToml(settings, SAMPLE);
    const reparsed = parseModelsToml(out).models;
    expect(reparsed.defaultModel).toEqual({ modelId: "claude:opus-4-8-1m", effort: "high" });
    expect(reparsed.reviewModel).toEqual({ modelId: "codex:gpt-5-codex", effort: "medium" });
    expect(reparsed.defaultToPlanMode).toBe(true);
  });

  it("preserves unknown sibling tables byte-content", () => {
    const withSibling = `version = 1

[harness.claude]
auth = "cli"

[environment]
FOO = "bar"

[models.defaultModel]
modelId = "claude:opus-4-8-1m"
effort = "high"
`;
    const { settings } = readScopedToml(withSibling);
    const out = writeScopedToml(settings, withSibling);
    expect(out).toContain("[harness.claude]");
    expect(out).toContain('auth = "cli"');
    expect(out).toContain("[environment]");
    expect(out).toContain('FOO = "bar"');
    // models still present
    expect(out).toContain("[models.defaultModel]");
  });

  it("emits a version line when none present", () => {
    const next: ScopedSettings = {
      version: 1,
      models: { defaultModel: { modelId: "codex:gpt-5-codex", effort: "low" } },
    };
    const out = writeScopedToml(next, "");
    expect(out).toMatch(/version = 1/);
    expect(out).toContain('modelId = "codex:gpt-5-codex"');
  });

  it("does not double a version that already exists in preserved content", () => {
    const prior = `version = 1\n\n[harness.codex]\nauth = "cli"\n`;
    const next: ScopedSettings = {
      version: 1,
      models: { defaultToPlanMode: true },
    };
    const out = writeScopedToml(next, prior);
    const matches = out.match(/^version = /gm) ?? [];
    expect(matches.length).toBe(1);
  });
});

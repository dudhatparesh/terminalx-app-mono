import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  parseHarnessSettings,
  upsertOpenCodeProviderToml,
  removeOpenCodeProviderToml,
  writeOpenCodeProviderConfig,
  removeOpenCodeProviderConfig,
  readOpenCodeProviderConfig,
  repoSettingsPath,
} from "@/lib/harnesses/settings-toml";

// ─────────────────────────────────────────────────────────────────────────────
// Pure TOML upsert/remove (no fs).
// ─────────────────────────────────────────────────────────────────────────────

describe("upsertOpenCodeProviderToml", () => {
  it("creates a [harness.opencode] block in empty content", () => {
    const out = upsertOpenCodeProviderToml("", { providerId: "anthropic", scope: "repo" });
    const s = parseHarnessSettings(out);
    expect(s.opencodeProviders).toEqual(["anthropic"]);
    expect(out).toContain("[harness.opencode]");
  });

  it("appends a provider without duplicating an existing one", () => {
    let out = upsertOpenCodeProviderToml("", { providerId: "anthropic", scope: "repo" });
    out = upsertOpenCodeProviderToml(out, { providerId: "openrouter", scope: "repo" });
    out = upsertOpenCodeProviderToml(out, { providerId: "anthropic", scope: "repo" });
    const s = parseHarnessSettings(out);
    expect(s.opencodeProviders).toEqual(["anthropic", "openrouter"]);
  });

  it("merges the configured provider's models into [harness.opencode] models", () => {
    let out = upsertOpenCodeProviderToml("", {
      providerId: "anthropic",
      models: ["claude-opus-4-8"],
      scope: "repo",
    });
    out = upsertOpenCodeProviderToml(out, {
      providerId: "openai",
      models: ["gpt-4o", "claude-opus-4-8"],
      scope: "repo",
    });
    const s = parseHarnessSettings(out);
    expect(s.opencodeProviders).toEqual(["anthropic", "openai"]);
    expect(s.opencodeModels.sort()).toEqual(["claude-opus-4-8", "gpt-4o"]);
  });

  it("preserves unrelated tables when updating", () => {
    const existing = `[defaults]\nharness = "opencode"\n\n[harness.claude]\nauth = "cli"\n`;
    const out = upsertOpenCodeProviderToml(existing, { providerId: "anthropic", scope: "repo" });
    const s = parseHarnessSettings(out);
    expect(s.defaultHarness).toBe("opencode");
    expect(s.auth).toEqual({ claude: "cli" });
    expect(s.opencodeProviders).toEqual(["anthropic"]);
  });

  it("persists a gateway provider's endpoint across upsert→serialize→parse (#8)", () => {
    const out = upsertOpenCodeProviderToml("", {
      providerId: "openrouter",
      endpoint: "https://gw.example.com/v1",
      models: ["openrouter/auto"],
      scope: "repo",
    });
    // The endpoint must be written into the TOML, not silently dropped.
    expect(out).toContain("https://gw.example.com/v1");
    const s = parseHarnessSettings(out);
    expect(s.opencodeProviders).toEqual(["openrouter"]);
    expect(s.opencodeProviderEndpoints).toEqual({
      openrouter: "https://gw.example.com/v1",
    });
  });

  it("preserves existing provider endpoints when upserting another provider (#8)", () => {
    let out = upsertOpenCodeProviderToml("", {
      providerId: "openrouter",
      endpoint: "https://or.example.com/v1",
      scope: "repo",
    });
    out = upsertOpenCodeProviderToml(out, { providerId: "anthropic", scope: "repo" });
    const s = parseHarnessSettings(out);
    expect(s.opencodeProviders).toEqual(["openrouter", "anthropic"]);
    expect(s.opencodeProviderEndpoints.openrouter).toBe("https://or.example.com/v1");
  });

  it("keeps non-gateway providers free of any endpoint key (#8)", () => {
    const out = upsertOpenCodeProviderToml("", { providerId: "anthropic", scope: "repo" });
    const s = parseHarnessSettings(out);
    expect(s.opencodeProviderEndpoints).toEqual({});
    expect(out.toLowerCase()).not.toContain("endpoint");
  });

  it("never writes a secret/apiKey into the TOML (AC-7)", () => {
    const out = upsertOpenCodeProviderToml("", {
      providerId: "openrouter",
      endpoint: "https://gw.example.com/v1",
      // @ts-expect-error — defends against an apiKey leaking through if a caller adds it
      apiKey: "sk-should-never-persist",
      scope: "repo",
    });
    expect(out).not.toContain("sk-should-never-persist");
    expect(out.toLowerCase()).not.toContain("apikey");
    expect(out.toLowerCase()).not.toContain("api_key");
  });
});

describe("removeOpenCodeProviderToml", () => {
  it("removes a provider and leaves the others", () => {
    let out = upsertOpenCodeProviderToml("", { providerId: "anthropic", scope: "repo" });
    out = upsertOpenCodeProviderToml(out, { providerId: "openrouter", scope: "repo" });
    out = removeOpenCodeProviderToml(out, "anthropic");
    const s = parseHarnessSettings(out);
    expect(s.opencodeProviders).toEqual(["openrouter"]);
  });

  it("is a no-op when the provider is absent", () => {
    const out = upsertOpenCodeProviderToml("", { providerId: "anthropic", scope: "repo" });
    const after = removeOpenCodeProviderToml(out, "openai");
    expect(parseHarnessSettings(after).opencodeProviders).toEqual(["anthropic"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Filesystem read/write (repo scope into a tmp dir).
// ─────────────────────────────────────────────────────────────────────────────

describe("writeOpenCodeProviderConfig (repo scope, fs)", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tx-opencode-cfg-"));
  });
  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("writes [harness.opencode] providers to .terminalx/settings.toml", () => {
    writeOpenCodeProviderConfig(
      { providerId: "anthropic", models: ["claude-opus-4-8"], scope: "repo" },
      repoRoot
    );
    const file = repoSettingsPath(repoRoot);
    expect(fs.existsSync(file)).toBe(true);
    const raw = fs.readFileSync(file, "utf-8");
    expect(raw).toContain("[harness.opencode]");
    expect(raw).toContain("anthropic");

    const read = readOpenCodeProviderConfig(repoRoot);
    expect(read.providers).toEqual(["anthropic"]);
    expect(read.models).toEqual(["claude-opus-4-8"]);
  });

  it("increments the configured-provider count on a second add (AC-11)", () => {
    writeOpenCodeProviderConfig({ providerId: "anthropic", scope: "repo" }, repoRoot);
    expect(readOpenCodeProviderConfig(repoRoot).providers).toHaveLength(1);
    writeOpenCodeProviderConfig({ providerId: "openrouter", scope: "repo" }, repoRoot);
    expect(readOpenCodeProviderConfig(repoRoot).providers).toHaveLength(2);
  });

  it("persists a gateway endpoint and removes a provider via DELETE", () => {
    writeOpenCodeProviderConfig(
      { providerId: "openrouter", endpoint: "https://or.example.com/v1", scope: "repo" },
      repoRoot
    );
    expect(readOpenCodeProviderConfig(repoRoot).providers).toEqual(["openrouter"]);

    removeOpenCodeProviderConfig("openrouter", repoRoot);
    expect(readOpenCodeProviderConfig(repoRoot).providers).toEqual([]);
  });

  it("round-trips the gateway endpoint through write→read (#8)", () => {
    writeOpenCodeProviderConfig(
      { providerId: "openrouter", endpoint: "https://or.example.com/v1", scope: "repo" },
      repoRoot
    );
    const raw = fs.readFileSync(repoSettingsPath(repoRoot), "utf-8");
    expect(raw).toContain("https://or.example.com/v1");

    const read = readOpenCodeProviderConfig(repoRoot);
    expect(read.endpoints).toEqual({ openrouter: "https://or.example.com/v1" });
  });

  it("never writes a secret to the committed file (AC-10)", () => {
    writeOpenCodeProviderConfig(
      // @ts-expect-error — defend against an apiKey leaking onto disk
      { providerId: "anthropic", apiKey: "sk-leak", scope: "repo" },
      repoRoot
    );
    const raw = fs.readFileSync(repoSettingsPath(repoRoot), "utf-8");
    expect(raw).not.toContain("sk-leak");
  });
});

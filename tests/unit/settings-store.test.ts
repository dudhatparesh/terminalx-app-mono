import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { mergeModels } from "@/lib/settings/store";
import type { ScopedSettings } from "@/lib/settings/types";

// The store captures DATA_DIR from process.cwd() at module load (mirroring
// ai-sessions.ts). Load a FRESH module instance after chdir so DATA_DIR points
// at the per-test tmp cwd.
type StoreModule = typeof import("@/lib/settings/store");
async function freshStore(): Promise<StoreModule> {
  vi.resetModules();
  return import("@/lib/settings/store");
}

describe("mergeModels", () => {
  it("merges scalar fields", () => {
    const out = mergeModels({ defaultToPlanMode: true }, { defaultToFastMode: true });
    expect(out).toEqual({ defaultToPlanMode: true, defaultToFastMode: true });
  });

  it("setting a field to null clears it", () => {
    const out = mergeModels({ codexPersonality: "concise" }, { codexPersonality: null });
    expect(out.codexPersonality).toBeUndefined();
  });

  it("merges ModelChoice sub-fields independently", () => {
    const out = mergeModels(
      { defaultModel: { modelId: "claude:opus-4-8-1m", effort: "high" } },
      { defaultModel: { modelId: "codex:gpt-5-codex", effort: null } }
    );
    // modelId overridden, effort cleared
    expect(out.defaultModel).toEqual({ modelId: "codex:gpt-5-codex", effort: null });
  });

  it("drops a choice that becomes fully empty", () => {
    const out = mergeModels(
      { defaultModel: { modelId: "claude:opus-4-8-1m", effort: null } },
      { defaultModel: { modelId: null, effort: null } }
    );
    expect(out.defaultModel).toBeUndefined();
  });
});

describe("user-scope store (JSON)", () => {
  let cwd: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tx-settings-user-")));
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("reads empty defaults when no file exists", async () => {
    const { readUserSettings } = await freshStore();
    const s = readUserSettings();
    expect(s.version).toBe(1);
    expect(s.models).toBeUndefined();
  });

  it("writes then reads back user settings", async () => {
    const { writeUserSettings, readUserSettings } = await freshStore();
    const next: ScopedSettings = {
      version: 1,
      models: { defaultModel: { modelId: "codex:gpt-5-codex", effort: "low" } },
    };
    await writeUserSettings(next);
    const back = readUserSettings();
    expect(back.models?.defaultModel).toEqual({ modelId: "codex:gpt-5-codex", effort: "low" });
  });

  it("writes the user file with 0600 perms", async () => {
    const { writeUserSettings } = await freshStore();
    await writeUserSettings({ version: 1, models: { defaultToPlanMode: true } });
    const file = path.join(cwd, "data", "settings", "user.json");
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== "win32") {
      const mode = fs.statSync(file).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
});

describe("repo-scope store (TOML)", () => {
  let root: string;
  let repoRoot: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tx-settings-repo-")));
    process.env.TERMINUS_ROOT = root;
    repoRoot = path.join(root, "repo");
    fs.mkdirSync(repoRoot, { recursive: true });
  });

  afterEach(() => {
    delete process.env.TERMINUS_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns exists:false when the file is absent", async () => {
    const { readRepoSettings } = await freshStore();
    const r = readRepoSettings(repoRoot);
    expect(r.exists).toBe(false);
    expect(r.parseError).toBe(false);
  });

  it("writes then reads back repo settings", async () => {
    const { writeRepoSettings, readRepoSettings, repoSettingsPath } = await freshStore();
    await writeRepoSettings(repoRoot, {
      version: 1,
      models: { reviewModel: { modelId: "codex:gpt-5-codex", effort: "medium" } },
    });
    const file = repoSettingsPath(repoRoot);
    expect(fs.existsSync(file)).toBe(true);
    const r = readRepoSettings(repoRoot);
    expect(r.exists).toBe(true);
    expect(r.settings.models?.reviewModel).toEqual({
      modelId: "codex:gpt-5-codex",
      effort: "medium",
    });
  });

  it("preserves a pre-existing sibling table across a write", async () => {
    const { writeRepoSettings, repoSettingsPath } = await freshStore();
    const file = repoSettingsPath(repoRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `version = 1\n\n[harness.claude]\nauth = "cli"\n`, "utf-8");
    await writeRepoSettings(repoRoot, {
      version: 1,
      models: { defaultToPlanMode: true },
    });
    const text = fs.readFileSync(file, "utf-8");
    expect(text).toContain("[harness.claude]");
    expect(text).toContain('auth = "cli"');
    expect(text).toContain("defaultToPlanMode = true");
  });

  it("repoSettingsPath blocks traversal outside TERMINUS_ROOT", async () => {
    const { repoSettingsPath } = await freshStore();
    expect(() => repoSettingsPath(path.join(root, "..", "..", "etc"))).toThrow();
  });
});

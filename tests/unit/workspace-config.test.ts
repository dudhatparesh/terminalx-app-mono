import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  parseToml,
  interpolate,
  copyConfiguredFiles,
  resolveWorkspaceConfig,
  repoConfigPath,
  settingsTomlTemplate,
} from "@/lib/workspace-config";

// Each test gets an isolated TERMINUS_ROOT so resolveSafePath / sensitive-path
// checks operate inside the sandbox. macOS /var -> /private/var symlink means we
// must realpath the temp dir (mirrors file-service.test.ts).
let root = "";
let repoRoot = "";

function writeRepoToml(content: string) {
  fs.mkdirSync(path.join(repoRoot, ".terminalx"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".terminalx", "settings.toml"), content, "utf-8");
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tx-wsconfig-")));
  process.env.TERMINUS_ROOT = root;
  repoRoot = path.join(root, "repo");
  fs.mkdirSync(repoRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.TERMINUS_ROOT;
  delete process.env.TERMINALX_ALLOW_SENSITIVE_FILE_ACCESS;
});

describe("parseToml (minimal reader)", () => {
  it("parses scalars, strings, ints, bools", () => {
    const t = parseToml(`version = 1\nname = "hello"\nflag = true\nother = false`);
    expect(t).toMatchObject({ version: 1, name: "hello", flag: true, other: false });
  });

  it("parses arrays of strings", () => {
    const t = parseToml(`copyFiles = [".env", ".env.local"]`);
    expect(t.copyFiles).toEqual([".env", ".env.local"]);
  });

  it("parses nested tables and dotted sub-tables", () => {
    const t = parseToml(
      [
        "version = 1",
        "[workspace]",
        'defaultKind = "claude"',
        "[env]",
        'NODE_ENV = "development"',
        "[scripts.dev]",
        'command = "npm run dev"',
        'description = "Start the dev server"',
      ].join("\n")
    );
    expect((t.workspace as Record<string, unknown>).defaultKind).toBe("claude");
    expect((t.env as Record<string, unknown>).NODE_ENV).toBe("development");
    const scripts = t.scripts as Record<string, Record<string, unknown>>;
    expect(scripts.dev!.command).toBe("npm run dev");
    expect(scripts.dev!.description).toBe("Start the dev server");
  });

  it("ignores comments and blank lines", () => {
    const t = parseToml(`# a comment\n\nversion = 1 # trailing\n`);
    expect(t.version).toBe(1);
  });

  it("throws on malformed input", () => {
    expect(() => parseToml(`this is not = = toml [[[`)).toThrow();
  });
});

describe("interpolate", () => {
  it("expands ${VAR} from the provided scope", () => {
    expect(interpolate("http://localhost:${PORT}", { PORT: "4100" })).toBe("http://localhost:4100");
  });

  it("expands unknown vars to empty string (single pass, no throw)", () => {
    expect(interpolate("a-${NOPE}-b", {})).toBe("a--b");
  });

  it("does not recursively expand injected values", () => {
    // scope value itself contains a ${...} token; single-pass leaves it literal.
    expect(interpolate("${A}", { A: "${B}", B: "deep" })).toBe("${B}");
  });
});

describe("resolveWorkspaceConfig", () => {
  it("returns built-in defaults when no repo config exists", () => {
    const cfg = resolveWorkspaceConfig(repoRoot);
    expect(cfg.hasRepoConfig).toBe(false);
    expect(cfg.defaultKind).toBe("bash");
    expect(cfg.copyFiles).toEqual([".env", ".env.local"]);
    expect(cfg.env).toEqual({});
    expect(cfg.setup).toBeNull();
    expect(cfg.scripts).toEqual([]);
    expect(cfg.provenance.defaultKind).toBe("default");
    expect(cfg.configPath).toBe(repoConfigPath(cfg.repoRoot));
  });

  it("reads a committed settings.toml and records repo provenance", () => {
    writeRepoToml(
      [
        "version = 1",
        "[workspace]",
        'defaultKind = "claude"',
        'copyFiles = [".env"]',
        "[env]",
        'NODE_ENV = "development"',
        "[setup]",
        'command = "npm ci"',
        "timeoutSeconds = 600",
        "[scripts.dev]",
        'description = "Start the dev server"',
        'command = "npm run dev -- --port ${TERMINALX_PORT}"',
        "[scripts.test]",
        'command = "npm test"',
      ].join("\n")
    );
    const cfg = resolveWorkspaceConfig(repoRoot);
    expect(cfg.hasRepoConfig).toBe(true);
    expect(cfg.defaultKind).toBe("claude");
    expect(cfg.copyFiles).toEqual([".env"]);
    expect(cfg.env).toEqual({ NODE_ENV: "development" });
    expect(cfg.setup).toEqual({ command: "npm ci", timeoutSeconds: 600 });
    expect(cfg.scripts).toHaveLength(2);
    const dev = cfg.scripts.find((s) => s.name === "dev");
    expect(dev?.command).toBe("npm run dev -- --port ${TERMINALX_PORT}");
    expect(dev?.description).toBe("Start the dev server");
    expect(cfg.provenance.defaultKind).toBe("repo");
    expect(cfg.provenance.scripts).toBe("repo");
    expect(cfg.provenance.setup).toBe("repo");
  });

  it("never throws on a malformed settings.toml; degrades to defaults with a warning", () => {
    writeRepoToml("this is = = not valid [[[ toml");
    const cfg = resolveWorkspaceConfig(repoRoot);
    expect(cfg.hasRepoConfig).toBe(false);
    expect(cfg.defaultKind).toBe("bash");
    expect(cfg.warnings.length).toBeGreaterThan(0);
    expect(cfg.warnings.join(" ")).toMatch(/parse/i);
  });

  it("drops an invalid defaultKind with a warning (falls through to default)", () => {
    writeRepoToml(["version = 1", "[workspace]", 'defaultKind = "wat"'].join("\n"));
    const cfg = resolveWorkspaceConfig(repoRoot);
    expect(cfg.defaultKind).toBe("bash");
    expect(cfg.provenance.defaultKind).toBe("default");
    expect(cfg.warnings.join(" ")).toMatch(/defaultKind/i);
  });

  it("drops reserved/invalid env keys with a warning", () => {
    writeRepoToml(
      ["version = 1", "[env]", 'PATH = "/evil"', 'TERMINALX_PORT = "9"', 'OK_KEY = "v"'].join("\n")
    );
    const cfg = resolveWorkspaceConfig(repoRoot);
    expect(cfg.env).toEqual({ OK_KEY: "v" });
    expect(cfg.warnings.join(" ")).toMatch(/PATH|TERMINALX_PORT|reserved/i);
  });

  it("layers user-scope JSON under repo config (repo wins, user fills gaps)", () => {
    // user-scope file lives at <cwd>/data/workspace-config.json
    const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tx-wscwd-")));
    const dataDir = path.join(cwd, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "workspace-config.json"),
      JSON.stringify({ version: 1, defaultKind: "codex", copyFiles: [".env.custom"] }),
      "utf-8"
    );
    const origCwd = process.cwd;
    process.cwd = (() => cwd) as typeof process.cwd;
    try {
      // repo only sets defaultKind; copyFiles should come from user scope.
      writeRepoToml(["version = 1", "[workspace]", 'defaultKind = "claude"'].join("\n"));
      const cfg = resolveWorkspaceConfig(repoRoot);
      expect(cfg.defaultKind).toBe("claude");
      expect(cfg.provenance.defaultKind).toBe("repo");
      expect(cfg.copyFiles).toEqual([".env.custom"]);
      expect(cfg.provenance.copyFiles).toBe("user");
    } finally {
      process.cwd = origCwd;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("interpolates ${TERMINALX_PORT} into env values at resolve time when a port is supplied", () => {
    writeRepoToml(
      ["version = 1", "[env]", 'API = "http://localhost:${TERMINALX_PORT}"'].join("\n")
    );
    const cfg = resolveWorkspaceConfig(repoRoot, { port: 4242 });
    expect(cfg.env.API).toBe("http://localhost:4242");
  });
});

describe("settingsTomlTemplate", () => {
  it("produces parseable TOML seed content", () => {
    const tpl = settingsTomlTemplate();
    expect(tpl).toContain("[workspace]");
    expect(() => parseToml(tpl)).not.toThrow();
  });
});

describe("copyConfiguredFiles", () => {
  let src = "";
  let dest = "";
  beforeEach(() => {
    src = path.join(root, "source");
    dest = path.join(root, "worktree");
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
  });

  it("copies .env / .env.local WITHOUT TERMINALX_ALLOW_SENSITIVE_FILE_ACCESS set", () => {
    delete process.env.TERMINALX_ALLOW_SENSITIVE_FILE_ACCESS;
    fs.writeFileSync(path.join(src, ".env"), "SECRET=1");
    fs.writeFileSync(path.join(src, ".env.local"), "LOCAL=2");
    const { copied, warnings } = copyConfiguredFiles(src, dest, [".env", ".env.local"]);
    expect(copied).toEqual([".env", ".env.local"]);
    expect(warnings).toEqual([]);
    expect(fs.readFileSync(path.join(dest, ".env"), "utf-8")).toBe("SECRET=1");
    expect(fs.readFileSync(path.join(dest, ".env.local"), "utf-8")).toBe("LOCAL=2");
  });

  it("skips missing sources silently ('.env if you have one')", () => {
    const { copied, warnings } = copyConfiguredFiles(src, dest, [".env"]);
    expect(copied).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("rejects absolute paths", () => {
    const { copied, warnings } = copyConfiguredFiles(src, dest, ["/etc/passwd"]);
    expect(copied).toEqual([]);
    expect(warnings.join(" ")).toMatch(/relative/i);
  });

  it("rejects .. traversal", () => {
    fs.writeFileSync(path.join(root, "outside.txt"), "leak");
    const { copied, warnings } = copyConfiguredFiles(src, dest, ["../outside.txt"]);
    expect(copied).toEqual([]);
    expect(warnings.join(" ")).toMatch(/relative|escapes/i);
    expect(fs.existsSync(path.join(dest, "outside.txt"))).toBe(false);
  });

  it("does not clobber an existing dest file", () => {
    fs.writeFileSync(path.join(src, ".env"), "NEW");
    fs.writeFileSync(path.join(dest, ".env"), "KEEP");
    const { copied, warnings } = copyConfiguredFiles(src, dest, [".env"]);
    expect(copied).toEqual([]);
    expect(warnings.join(" ")).toMatch(/already exists/i);
    expect(fs.readFileSync(path.join(dest, ".env"), "utf-8")).toBe("KEEP");
  });

  it("creates nested dest directories for nested copy entries", () => {
    fs.mkdirSync(path.join(src, "config"), { recursive: true });
    fs.writeFileSync(path.join(src, "config", "local.json"), "{}");
    const { copied } = copyConfiguredFiles(src, dest, ["config/local.json"]);
    expect(copied).toEqual(["config/local.json"]);
    expect(fs.existsSync(path.join(dest, "config", "local.json"))).toBe(true);
  });
});

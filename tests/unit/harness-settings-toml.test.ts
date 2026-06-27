import { describe, it, expect } from "vitest";
import { parseHarnessSettings } from "@/lib/harnesses/settings-toml";

const SAMPLE = `
# .terminalx/settings.toml  (Conductor analog: .conductor/settings.toml)
[harness.claude]
auth = "cli"            # or "api-key"

[harness.opencode]
bin = ""                # empty => bundled/PATH
providers = ["anthropic", "openrouter"]
models = ["claude-sonnet"]

[defaults]
harness = "claude"
`;

describe("parseHarnessSettings", () => {
  it("parses the spec's example settings.toml", () => {
    const s = parseHarnessSettings(SAMPLE);
    expect(s.defaultHarness).toBe("claude");
    expect(s.auth).toEqual({ claude: "cli" });
    // empty bin string => undefined (use bundled/PATH)
    expect(s.opencodeBin).toBeUndefined();
    expect(s.opencodeProviders).toEqual(["anthropic", "openrouter"]);
    expect(s.opencodeModels).toEqual(["claude-sonnet"]);
  });

  it("reads a non-empty opencode bin override", () => {
    const s = parseHarnessSettings(`[harness.opencode]\nbin = "/usr/local/bin/opencode"`);
    expect(s.opencodeBin).toBe("/usr/local/bin/opencode");
  });

  it("strips comments outside quoted strings", () => {
    const s = parseHarnessSettings(`[defaults]\nharness = "codex" # the repo default`);
    expect(s.defaultHarness).toBe("codex");
  });

  it("degrades to empty defaults on garbage input", () => {
    const s = parseHarnessSettings("this is not toml :::");
    expect(s.auth).toEqual({});
    expect(s.opencodeProviders).toEqual([]);
    expect(s.opencodeModels).toEqual([]);
    expect(s.defaultHarness).toBeUndefined();
  });

  it("handles an empty file", () => {
    const s = parseHarnessSettings("");
    expect(s.opencodeProviders).toEqual([]);
  });
});

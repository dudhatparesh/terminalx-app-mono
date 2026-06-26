import { describe, it, expect, afterEach } from "vitest";
import { commandForHarness } from "@/lib/harnesses/command";

/**
 * Byte-identical parity: commandForHarness must emit the EXACT wrapper the old
 * commandForKind produced for bash/claude/codex, so existing tmux behavior and
 * any downstream snapshots stay stable.
 */
function legacyWrapper(bin: string, args: string[] = []): string {
  const invocation = [bin, ...args].join(" ");
  return `bash -lc '${invocation}; ec=$?; echo; echo "[${bin} exited with code $ec — dropping to bash]"; exec bash -l'`;
}

describe("commandForHarness", () => {
  it("returns null for bash (no wrapper needed)", () => {
    expect(commandForHarness("bash")).toBeNull();
  });

  it("returns null for unknown harness ids", () => {
    expect(commandForHarness("does-not-exist")).toBeNull();
  });

  it("emits the byte-identical legacy wrapper for claude", () => {
    expect(commandForHarness("claude")).toBe(legacyWrapper("claude"));
  });

  it("emits the byte-identical legacy wrapper for codex", () => {
    expect(commandForHarness("codex")).toBe(legacyWrapper("codex"));
  });

  it("appends --dangerously-skip-permissions to claude when opted in (byte-identical)", () => {
    expect(commandForHarness("claude", { dangerouslySkipPermissions: true })).toBe(
      legacyWrapper("claude", ["--dangerously-skip-permissions"])
    );
  });

  it("ignores dangerouslySkipPermissions for codex (flag not declared)", () => {
    const cmd = commandForHarness("codex", { dangerouslySkipPermissions: true });
    expect(cmd).toBe(legacyWrapper("codex"));
    expect(cmd).not.toContain("--dangerously-skip-permissions");
  });

  it("wraps the new cursor harness with the cursor-agent binary", () => {
    expect(commandForHarness("cursor")).toBe(legacyWrapper("cursor-agent"));
  });

  it("wraps the new opencode harness with the opencode binary", () => {
    expect(commandForHarness("opencode")).toBe(legacyWrapper("opencode"));
  });

  describe("opencode executable-path override", () => {
    const prev = process.env.TERMINALX_OPENCODE_BIN;
    afterEach(() => {
      if (prev === undefined) delete process.env.TERMINALX_OPENCODE_BIN;
      else process.env.TERMINALX_OPENCODE_BIN = prev;
    });

    it("honors TERMINALX_OPENCODE_BIN when set", () => {
      process.env.TERMINALX_OPENCODE_BIN = "/opt/oc/opencode";
      expect(commandForHarness("opencode")).toBe(legacyWrapper("/opt/oc/opencode"));
    });

    it("falls back to the bundled bin when the override is blank", () => {
      process.env.TERMINALX_OPENCODE_BIN = "   ";
      expect(commandForHarness("opencode")).toBe(legacyWrapper("opencode"));
    });
  });
});

/**
 * Back-compat: the legacy commandForKind / isValidKind names still resolve
 * (via the ai-sessions shim) and behave like the new registry functions.
 */
describe("ai-sessions back-compat shim", () => {
  it("re-exports commandForKind/isValidKind with registry behavior", async () => {
    const { commandForKind, isValidKind } = await import("@/lib/ai-sessions");
    expect(commandForKind("bash")).toBeNull();
    expect(commandForKind("claude")).toBe(legacyWrapper("claude"));
    expect(isValidKind("bash")).toBe(true);
    expect(isValidKind("claude")).toBe(true);
    expect(isValidKind("codex")).toBe(true);
    // newly registered ids are now valid kinds too
    expect(isValidKind("cursor")).toBe(true);
    expect(isValidKind("opencode")).toBe(true);
    expect(isValidKind("nope")).toBe(false);
  });
});

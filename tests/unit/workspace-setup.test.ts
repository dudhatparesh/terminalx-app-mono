import { describe, expect, it } from "vitest";
import {
  buildWorkspaceEnvExports,
  withWorkspaceEnv,
  buildSetupCommand,
  buildRunCommand,
  resolveScriptCommand,
} from "@/lib/workspace-setup";

describe("buildWorkspaceEnvExports", () => {
  it("exports each key, single-quoting values", () => {
    const out = buildWorkspaceEnvExports({ TERMINALX_PORT: "4100", NODE_ENV: "development" });
    expect(out).toContain("export TERMINALX_PORT='4100'");
    expect(out).toContain("export NODE_ENV='development'");
  });

  it("escapes single quotes inside values to prevent injection", () => {
    const out = buildWorkspaceEnvExports({ EVIL: "a'; rm -rf /; '" });
    // The literal `'; rm -rf /; '` must be neutralized via '\'' escaping.
    expect(out).toContain(`'\\''`);
    expect(out).not.toMatch(/export EVIL='a'; rm/);
  });

  it("returns empty string for no env", () => {
    expect(buildWorkspaceEnvExports({})).toBe("");
  });
});

describe("withWorkspaceEnv", () => {
  it("prefixes an inner command with env exports inside a login shell", () => {
    const cmd = withWorkspaceEnv("exec bash -l", { TERMINALX_PORT: "4100" });
    expect(cmd).toContain("bash -lc");
    expect(cmd).toContain("export TERMINALX_PORT='4100'");
    expect(cmd).toContain("exec bash -l");
  });

  it("returns the bare inner command when there is no env", () => {
    expect(withWorkspaceEnv("exec bash -l", {})).toBe("exec bash -l");
  });
});

describe("buildSetupCommand", () => {
  it("wraps setup so it exports env, runs the command, prints an exit marker, and exits (transient)", () => {
    const cmd = buildSetupCommand("npm ci", { TERMINALX_PORT: "4100" });
    expect(cmd).toContain("bash -lc");
    // The whole inner command is single-quoted, so the env export's own quotes
    // are '\''-escaped. The port value still appears.
    expect(cmd).toContain("export TERMINALX_PORT=");
    expect(cmd).toContain("4100");
    expect(cmd).toContain("npm ci");
    expect(cmd).toMatch(/setup exited with code/);
    // transient: must exit, never drop into an interactive shell.
    expect(cmd).toContain("exit $ec");
    expect(cmd).not.toContain("exec bash -l");
  });
});

describe("buildRunCommand", () => {
  it("wraps a run script and keeps the shell alive on exit (drop to bash)", () => {
    const cmd = buildRunCommand("dev", "npm run dev", { TERMINALX_PORT: "4100" });
    expect(cmd).toContain("npm run dev");
    expect(cmd).toContain("export TERMINALX_PORT=");
    expect(cmd).toContain("4100");
    // run scripts keep the session inspectable on crash.
    expect(cmd).toContain("exec bash -l");
  });
});

describe("resolveScriptCommand (interpolation at execute time)", () => {
  it("interpolates ${TERMINALX_PORT} into the command", () => {
    const cmd = resolveScriptCommand("npm run dev -- --port ${TERMINALX_PORT}", {
      TERMINALX_PORT: "4242",
    });
    expect(cmd).toBe("npm run dev -- --port 4242");
  });
});

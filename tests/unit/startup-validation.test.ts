import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("startup validation", () => {
  let tmp: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terminalx-startup-"));
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("refuses no-auth mode", async () => {
    process.env.TERMINALX_AUTH_MODE = "none";
    process.env.TERMINALX_JWT_SECRET = "x".repeat(40);
    const { validateStartupConfiguration } = await import("@/lib/startup-validation");

    const result = validateStartupConfiguration({ host: "127.0.0.1", cwd: tmp });

    expect(result.errors.some((error) => error.includes("AUTH_MODE=none"))).toBe(true);
  });

  it("requires an admin password on first local-auth startup", async () => {
    process.env.TERMINALX_AUTH_MODE = "local";
    process.env.TERMINALX_JWT_SECRET = "x".repeat(40);
    delete process.env.TERMINALX_ADMIN_PASSWORD;
    const { validateStartupConfiguration } = await import("@/lib/startup-validation");

    const result = validateStartupConfiguration({ host: "127.0.0.1", cwd: tmp });

    expect(result.errors.some((error) => error.includes("TERMINALX_ADMIN_PASSWORD"))).toBe(true);
  });

  it("accepts local auth with an existing user file and jwt secret", async () => {
    fs.mkdirSync(path.join(tmp, "data"));
    fs.writeFileSync(path.join(tmp, "data", "users.json"), JSON.stringify([{ id: "u1" }]));
    process.env.TERMINALX_AUTH_MODE = "local";
    process.env.TERMINALX_JWT_SECRET = "x".repeat(40);
    const { validateStartupConfiguration } = await import("@/lib/startup-validation");

    const result = validateStartupConfiguration({ host: "127.0.0.1", cwd: tmp });

    expect(result.errors).toEqual([]);
  });
});

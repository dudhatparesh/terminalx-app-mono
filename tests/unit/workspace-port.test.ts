import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as net from "net";

// Mock ai-sessions.listMetadata so we control which ports are "claimed".
let claimedMeta: Array<{ name: string; port?: number }> = [];
vi.mock("@/lib/ai-sessions", () => ({
  listMetadata: () => claimedMeta,
}));

import { allocateWorkspacePort, isPortFree } from "@/lib/workspace-port";

function listenOn(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

describe("workspace port allocation", () => {
  beforeEach(() => {
    claimedMeta = [];
    process.env.TERMINALX_PORT_BASE = "4100";
    process.env.TERMINALX_PORT_RANGE = "50";
  });

  afterEach(() => {
    delete process.env.TERMINALX_PORT_BASE;
    delete process.env.TERMINALX_PORT_RANGE;
  });

  it("isPortFree resolves false for a port already in use", async () => {
    const srv = await listenOn(4123);
    try {
      expect(await isPortFree(4123)).toBe(false);
    } finally {
      srv.close();
    }
  });

  it("allocates the base port when nothing is claimed and it is free", async () => {
    const port = await allocateWorkspacePort();
    expect(port).toBeGreaterThanOrEqual(4100);
    expect(port).toBeLessThan(4150);
  });

  it("skips ports already claimed in session metadata", async () => {
    claimedMeta = [
      { name: "a", port: 4100 },
      { name: "b", port: 4101 },
    ];
    const port = await allocateWorkspacePort();
    expect(port).not.toBe(4100);
    expect(port).not.toBe(4101);
  });

  it("skips a port that is in use by a live listener", async () => {
    const srv = await listenOn(4100);
    try {
      const port = await allocateWorkspacePort();
      expect(port).not.toBe(4100);
    } finally {
      srv.close();
    }
  });

  it("throws when the range is exhausted", async () => {
    process.env.TERMINALX_PORT_RANGE = "2";
    claimedMeta = [
      { name: "a", port: 4100 },
      { name: "b", port: 4101 },
    ];
    await expect(allocateWorkspacePort()).rejects.toThrow(/free workspace port/i);
  });
});

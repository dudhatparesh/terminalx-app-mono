/**
 * Per-workspace port allocation. TerminalX analog of Conductor's
 * `CONDUCTOR_PORT`: each managed workspace gets a unique, persisted
 * `TERMINALX_PORT` so multiple `run · dev` servers across worktrees never
 * collide. The chosen port is stored on `SessionMeta.port` and released
 * implicitly when the session metadata is deleted (allocation only consults
 * live metadata + a transient liveness probe).
 */
import * as net from "net";
import { listMetadata } from "./ai-sessions";

function portBase(): number {
  const n = Number(process.env.TERMINALX_PORT_BASE ?? 4100);
  return Number.isInteger(n) && n > 0 ? n : 4100;
}

function portRange(): number {
  const n = Number(process.env.TERMINALX_PORT_RANGE ?? 900);
  return Number.isInteger(n) && n > 0 ? n : 900;
}

/** Resolve true if nothing is currently listening on the loopback port. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

/** Allocate a free, not-currently-claimed port for a new workspace. */
export async function allocateWorkspacePort(): Promise<number> {
  const base = portBase();
  const range = portRange();
  const claimed = new Set(
    listMetadata()
      .map((m) => m.port)
      .filter((p): p is number => Number.isInteger(p))
  );
  for (let i = 0; i < range; i++) {
    const candidate = base + i;
    if (claimed.has(candidate)) continue;
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error("No free workspace port in TERMINALX_PORT range");
}

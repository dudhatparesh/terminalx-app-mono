import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// deleteRecordingsForSession prunes a worktree's recordings on a confirmed
// delete (issue #9). The recorder names files "<sanitized-sessionId>-<ts>.jsonl"
// and writes the raw sessionId into the header, so cleanup matches BOTH the
// header sessionId (authoritative) and the sanitized-name prefix (best-effort,
// for legacy/headerless files). The store captures the recordings dir from cwd
// at module load, so we chdir into a tmp dir and load fresh modules.

async function freshModules() {
  const { vi } = await import("vitest");
  vi.resetModules();
  const recorder = await import("@/lib/session-recorder");
  const cleanup = await import("@/lib/recordings-cleanup");
  return { recorder, cleanup };
}

function recordingsDir(cwd: string): string {
  return path.join(cwd, "data", "recordings");
}

function writeRecording(cwd: string, fileBase: string, header: Record<string, unknown>): string {
  const dir = recordingsDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${fileBase}.jsonl`);
  fs.writeFileSync(file, JSON.stringify(header) + "\n" + JSON.stringify({ t: 1, d: "x" }) + "\n");
  return file;
}

describe("deleteRecordingsForSession (issue #9)", () => {
  let cwd: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tx-reccl-")));
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("deletes recordings whose header sessionId matches", async () => {
    const { cleanup } = await freshModules();
    const mine = writeRecording(cwd, "feat-x-1700000000000", { v: 1, sessionId: "feat-x" });
    const other = writeRecording(cwd, "feat-y-1700000000000", { v: 1, sessionId: "feat-y" });

    const { deleted } = cleanup.deleteRecordingsForSession("feat-x");
    expect(deleted).toBe(1);
    expect(fs.existsSync(mine)).toBe(false);
    expect(fs.existsSync(other)).toBe(true);
  });

  it("matches the sanitized-name prefix when the header is missing/garbled", async () => {
    const { cleanup } = await freshModules();
    // No usable header sessionId, but the filename prefix is the sanitized name.
    const legacy = writeRecording(cwd, "feat.x-1700000000000", { v: 1 });
    const { deleted } = cleanup.deleteRecordingsForSession("feat.x");
    expect(deleted).toBe(1);
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it("returns {deleted:0} when nothing matches or the dir is absent", async () => {
    const { cleanup } = await freshModules();
    expect(cleanup.deleteRecordingsForSession("ghost").deleted).toBe(0);
    writeRecording(cwd, "keep-1700000000000", { v: 1, sessionId: "keep" });
    expect(cleanup.deleteRecordingsForSession("nope").deleted).toBe(0);
    expect(fs.existsSync(path.join(recordingsDir(cwd), "keep-1700000000000.jsonl"))).toBe(true);
  });

  it("removes a real recording written by the recorder", async () => {
    const { recorder, cleanup } = await freshModules();
    process.env.TERMINUS_RECORD_SESSIONS = "true";
    try {
      const rec = recorder.startRecorder({ sessionId: "live-sess", cols: 80, rows: 24 });
      rec!.write("hi");
      await rec!.close();
      expect(fs.existsSync(rec!.file)).toBe(true);
      const { deleted } = cleanup.deleteRecordingsForSession("live-sess");
      expect(deleted).toBe(1);
      expect(fs.existsSync(rec!.file)).toBe(false);
    } finally {
      delete process.env.TERMINUS_RECORD_SESSIONS;
    }
  });

  it("does not match a different session that shares a name prefix", async () => {
    const { cleanup } = await freshModules();
    // "feat" must not sweep "feature" — the prefix match is on the "<name>-" boundary.
    const sibling = writeRecording(cwd, "feature-1700000000000", { v: 1, sessionId: "feature" });
    expect(cleanup.deleteRecordingsForSession("feat").deleted).toBe(0);
    expect(fs.existsSync(sibling)).toBe(true);
  });
});

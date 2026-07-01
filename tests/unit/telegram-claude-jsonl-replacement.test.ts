import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// IMPORTANT: claude-transcript.ts transitively imports state.ts, whose DATA_DIR
// is captured at module-evaluation time. We must point it at a throwaway dir
// BEFORE the dynamic import below, or the test would write to the real
// data/telegram-state.json.
const stateTmp = fs.mkdtempSync(path.join(os.tmpdir(), "tgstate-jsonl-"));
process.env.TERMINALX_DATA_DIR = stateTmp;

const { bindingIsForeignToPane, findLiveReplacementJsonl } =
  await import("@/lib/telegram/claude-transcript");
const state = await import("@/lib/telegram/state");

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-jsonl-"));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(stateTmp, { recursive: true, force: true });
});

function newCase(): {
  mk: (name: string, mtimeSec: number) => string;
  dir: string;
} {
  const dir = fs.mkdtempSync(path.join(tmp, "case-"));
  return {
    dir,
    // Note: utimes only sets mtime — the file's birthtime stays "now", i.e.
    // every test file looks freshly created. Tests steer the ctime gate via
    // claudeStartMs instead (past = candidate passes, future = candidate
    // predates the restart and must be rejected).
    mk: (name, mtimeSec) => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, "");
      fs.utimesSync(p, mtimeSec, mtimeSec);
      return p;
    },
  };
}

function mkTranscript(dir: string, name: string, startedMs: number, mtimeSec: number): string {
  const p = path.join(dir, name);
  const sessionId = name.endsWith(".jsonl") ? name.slice(0, -6) : name;
  fs.writeFileSync(
    p,
    [
      { type: "mode", sessionId },
      {
        type: "user",
        timestamp: new Date(startedMs).toISOString(),
        sessionId,
        message: { content: "hello" },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n"
  );
  fs.utimesSync(p, mtimeSec, mtimeSec);
  return p;
}

describe("findLiveReplacementJsonl", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const TOPIC = 9999; // not registered with any watcher → claimedJsonls is empty
  // A claude process that (re)started 5 minutes ago — after every "stale"
  // bound file in these cases was last written.
  const restartedMs = (nowSec - 300) * 1000;

  it("rotates to the lone live sibling when claude restarted after the bound JSONL froze", () => {
    const { mk } = newCase();
    const bound = mk("stale.jsonl", nowSec - 86400);
    const live = mk("live.jsonl", nowSec - 10);
    expect(findLiveReplacementJsonl(TOPIC, bound, restartedMs)).toBe(live);
  });

  it("never rotates without a claude process on the pane (claudeStartMs null)", () => {
    const { mk } = newCase();
    const bound = mk("stale.jsonl", nowSec - 86400);
    mk("live.jsonl", nowSec - 10);
    expect(findLiveReplacementJsonl(TOPIC, bound, null)).toBeNull();
  });

  it("never rotates when claude started before the bound JSONL's last write (no restart)", () => {
    const { mk } = newCase();
    // Long-running idle claude: process started a day ago, bound file last
    // written an hour ago. A live unrelated sibling must NOT be stolen.
    const bound = mk("own.jsonl", nowSec - 3600);
    mk("someone-elses.jsonl", nowSec - 10);
    const longRunningMs = (nowSec - 86400) * 1000;
    expect(findLiveReplacementJsonl(TOPIC, bound, longRunningMs)).toBeNull();
  });

  it("does not mark an in-process rotated transcript as foreign", () => {
    const { dir } = newCase();
    const longRunningMs = (nowSec - 86400) * 1000;
    mkTranscript(dir, "old-session.jsonl", longRunningMs + 5000, nowSec - 600);
    const current = mkTranscript(dir, "new-session.jsonl", (nowSec - 300) * 1000, nowSec - 10);

    expect(bindingIsForeignToPane(current, longRunningMs)).toBe(false);
  });

  it("does not mark newer transcripts as foreign for long-running Claude panes", () => {
    const { dir } = newCase();
    const longRunningMs = (nowSec - 86400) * 1000;
    mkTranscript(dir, "pane-session.jsonl", longRunningMs + 5000, nowSec - 200);
    const current = mkTranscript(dir, "other-session.jsonl", (nowSec - 300) * 1000, nowSec - 10);

    expect(bindingIsForeignToPane(current, longRunningMs)).toBe(false);
  });

  it("rotates when the same long-running claude process switches transcript files", () => {
    const { mk, dir } = newCase();
    const bound = mk("old-session.jsonl", nowSec - 600);
    const live = mkTranscript(dir, "new-session.jsonl", (nowSec - 300) * 1000, nowSec - 10);
    const longRunningMs = (nowSec - 86400) * 1000;

    expect(findLiveReplacementJsonl(TOPIC, bound, longRunningMs)).toBe(live);
  });

  it("rejects candidates created before the claude restart", () => {
    const { mk } = newCase();
    const bound = mk("stale.jsonl", nowSec - 86400);
    mk("pre-existing-live.jsonl", nowSec - 10);
    // claude "restarts" 60s in the future → every test file (birthtime ≈ now)
    // predates it and must fail the ctime gate.
    const futureStartMs = (nowSec + 60) * 1000;
    expect(findLiveReplacementJsonl(TOPIC, bound, futureStartMs)).toBeNull();
  });

  it("refuses to guess when several siblings qualify (ambiguous)", () => {
    const { mk } = newCase();
    const bound = mk("stale.jsonl", nowSec - 86400);
    mk("candidate-a.jsonl", nowSec - 240);
    mk("candidate-b.jsonl", nowSec - 5);
    expect(findLiveReplacementJsonl(TOPIC, bound, restartedMs)).toBeNull();
  });

  it("does not rotate when the bound JSONL is still being written to", () => {
    const { mk } = newCase();
    const bound = mk("live.jsonl", nowSec - 10);
    mk("older-sibling.jsonl", nowSec - 1000);
    expect(findLiveReplacementJsonl(TOPIC, bound, restartedMs)).toBeNull();
  });

  it("does not rotate when the sibling is only marginally newer (gap < 60 s)", () => {
    const { mk } = newCase();
    const bound = mk("current.jsonl", nowSec - 100);
    mk("barely-newer.jsonl", nowSec - 70);
    expect(findLiveReplacementJsonl(TOPIC, bound, (nowSec - 90) * 1000)).toBeNull();
  });

  it("does not rotate to a sibling that itself looks dormant (no activity in 5 min)", () => {
    const { mk } = newCase();
    const bound = mk("very-stale.jsonl", nowSec - 86400 * 3);
    mk("also-dormant.jsonl", nowSec - 86400);
    expect(findLiveReplacementJsonl(TOPIC, bound, restartedMs)).toBeNull();
  });

  it("returns null when the bound JSONL does not exist", () => {
    const { dir } = newCase();
    expect(
      findLiveReplacementJsonl(TOPIC, path.join(dir, "missing.jsonl"), restartedMs)
    ).toBeNull();
  });

  it("never rotates into a JSONL that another topic has bound on disk", async () => {
    const { mk } = newCase();
    const bound = mk("self-stale.jsonl", nowSec - 86400);
    // A freshly-written sibling that LOOKS like the live one by mtime — but
    // it is persisted as another topic's binding, so we must not steal it.
    const otherTopicJsonl = mk("other-topic.jsonl", nowSec - 5);
    await state.setTopic({
      topicId: 4242,
      sessionName: "sibling-session",
      kind: "claude",
      cwd: "/x",
      jsonlPath: otherTopicJsonl,
    });
    expect(findLiveReplacementJsonl(TOPIC, bound, restartedMs)).toBeNull();
    // Now drop a different live sibling — that one IS fair game.
    const trulyFree = mk("free-live.jsonl", nowSec - 4);
    expect(findLiveReplacementJsonl(TOPIC, bound, restartedMs)).toBe(trulyFree);
  });

  it("ignores non-JSONL files in the project dir", () => {
    const { mk, dir } = newCase();
    const bound = mk("bound.jsonl", nowSec - 86400);
    const distractor = path.join(dir, "scratch.txt");
    fs.writeFileSync(distractor, "");
    fs.utimesSync(distractor, nowSec - 10, nowSec - 10);
    expect(findLiveReplacementJsonl(TOPIC, bound, restartedMs)).toBeNull();
  });
});

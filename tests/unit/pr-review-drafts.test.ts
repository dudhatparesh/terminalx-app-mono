import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildModel,
  clearDrafts,
  discardDraft,
  getDraftReview,
  getResolvedMap,
  getSessionDrafts,
  setDraftReview,
  setThreadResolved,
  upsertDraft,
} from "@/lib/pr-review/drafts";
import type { DraftComment } from "@/types/pr-review";

function draft(overrides: Partial<DraftComment> = {}): DraftComment {
  const now = new Date().toISOString();
  return {
    id: "draft:sess:src/a.ts:12:abc",
    sessionName: "sess",
    path: "src/a.ts",
    line: 12,
    side: "RIGHT",
    body: "needs a test",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("pr-review draft store (§6.2)", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-pr-drafts-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("upsert/get round-trips a draft through data/pr-review/<session>.json", async () => {
    await upsertDraft("sess", draft());
    const onDisk = getSessionDrafts("sess");
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]!.body).toBe("needs a test");
    // Persisted to the expected per-session file (NOT IndexedDB).
    const file = path.join(tmpDir, "data", "pr-review", "sess.json");
    expect(fs.existsSync(file)).toBe(true);
  });

  it("upsert updates an existing draft in place (preserving createdAt)", async () => {
    await upsertDraft("sess", draft({ createdAt: "2026-01-01T00:00:00Z" }));
    await upsertDraft("sess", draft({ body: "edited" }));
    const drafts = getSessionDrafts("sess");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.body).toBe("edited");
    expect(drafts[0]!.createdAt).toBe("2026-01-01T00:00:00Z");
  });

  it("discard removes a draft", async () => {
    await upsertDraft("sess", draft());
    const removed = await discardDraft("sess", draft().id);
    expect(removed).toBe(true);
    expect(getSessionDrafts("sess")).toHaveLength(0);
  });

  it("setDraftReview persists the pending event/body", async () => {
    await setDraftReview("sess", { body: "lgtm overall", event: "APPROVE" });
    const dr = getDraftReview("sess");
    expect(dr?.event).toBe("APPROVE");
    expect(dr?.body).toBe("lgtm overall");
  });

  it("setThreadResolved flips a TerminalX-tracked flag (never posted to GitHub)", async () => {
    await setThreadResolved("sess", "src/a.ts::12::RIGHT", true);
    expect(getResolvedMap("sess")["src/a.ts::12::RIGHT"]).toBe(true);
    await setThreadResolved("sess", "src/a.ts::12::RIGHT", false);
    expect(getResolvedMap("sess")["src/a.ts::12::RIGHT"]).toBeUndefined();
  });

  it("clearDrafts removes only the submitted ids and clears the draft review", async () => {
    await upsertDraft("sess", draft({ id: "a" }));
    await upsertDraft("sess", draft({ id: "b" }));
    await setDraftReview("sess", { body: "", event: "COMMENT" });
    await clearDrafts("sess", ["a"]);
    expect(getSessionDrafts("sess").map((d) => d.id)).toEqual(["b"]);
    expect(getDraftReview("sess")).toBeNull();
  });

  it("buildModel merges the session's drafts into the model", async () => {
    await upsertDraft("sess", draft({ id: "x", line: 40, path: "fresh.ts" }));
    const model = buildModel("sess", null, null);
    expect(model.draftCount).toBe(1);
    expect(model.byFile.map((g) => g.path)).toContain("fresh.ts");
  });

  it("rejects a session name that could escape the data dir", async () => {
    await expect(upsertDraft("../evil", draft({ id: "z" }))).rejects.toThrow(
      "invalid session name"
    );
  });
});

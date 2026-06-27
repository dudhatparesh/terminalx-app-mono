import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  buildResponse,
  computeDiff,
  computeFileDiff,
  fileExtension,
  fileId,
  mapStatus,
  mergeNameStatusAndNumstat,
  parseNameStatus,
  parseNumstat,
  parseUnifiedDiff,
  resolveBase,
  splitPath,
} from "@/lib/git-diff";
import { pairLines } from "@/lib/diff-pairing";
import type { DiffLine } from "@/types/diff";

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// ---------------------------------------------------------------------------
// Pure parsing — no git required.
// ---------------------------------------------------------------------------

describe("splitPath", () => {
  it("splits a nested path into a muted dir + emphasized filename", () => {
    expect(splitPath(".terminalx/settings.toml")).toEqual({
      dir: ".terminalx/",
      filename: "settings.toml",
    });
  });

  it("treats a bare filename as having no dir", () => {
    expect(splitPath("README.md")).toEqual({ dir: "", filename: "README.md" });
  });

  it("keeps the trailing slash on deep dirs", () => {
    expect(splitPath("src/components/diff-viewer/DiffViewer.tsx")).toEqual({
      dir: "src/components/diff-viewer/",
      filename: "DiffViewer.tsx",
    });
  });
});

describe("fileExtension", () => {
  it("returns the extension without the dot", () => {
    expect(fileExtension("settings.toml")).toBe("toml");
    expect(fileExtension("DiffViewer.tsx")).toBe("tsx");
  });

  it("returns empty for dotfiles with no extension and for extensionless files", () => {
    expect(fileExtension(".env")).toBe("");
    expect(fileExtension("Makefile")).toBe("");
  });

  it("uses the last dot for multi-dot names", () => {
    expect(fileExtension("archive.tar.gz")).toBe("gz");
  });
});

describe("fileId", () => {
  it("is stable for the same path", () => {
    expect(fileId("a/b.ts")).toBe(fileId("a/b.ts"));
  });

  it("differs when the path differs", () => {
    expect(fileId("a/b.ts")).not.toBe(fileId("a/c.ts"));
  });

  it("incorporates oldPath for renames", () => {
    expect(fileId("new.ts", "old.ts")).not.toBe(fileId("new.ts"));
  });
});

describe("mapStatus", () => {
  it("maps git status letters to FileStatus", () => {
    expect(mapStatus("A")).toBe("added");
    expect(mapStatus("D")).toBe("deleted");
    expect(mapStatus("M")).toBe("modified");
    expect(mapStatus("R096")).toBe("renamed");
    expect(mapStatus("C100")).toBe("copied");
    expect(mapStatus("T")).toBe("mode-change");
  });

  it("defaults unknown letters to modified", () => {
    expect(mapStatus("X")).toBe("modified");
  });
});

describe("parseNameStatus", () => {
  it("parses simple add/modify/delete rows", () => {
    const raw = "A\t.terminalx/settings.toml\nM\tsrc/index.ts\nD\told.txt\n";
    expect(parseNameStatus(raw)).toEqual([
      { status: "added", path: ".terminalx/settings.toml" },
      { status: "modified", path: "src/index.ts" },
      { status: "deleted", path: "old.txt" },
    ]);
  });

  it("parses a rename row into oldPath/path with similarity", () => {
    const raw = "R096\tsrc/old.ts\tsrc/new.ts\n";
    expect(parseNameStatus(raw)).toEqual([
      { status: "renamed", oldPath: "src/old.ts", path: "src/new.ts", similarity: 96 },
    ]);
  });

  it("ignores blank lines", () => {
    expect(parseNameStatus("\n\nM\ta.ts\n\n")).toEqual([{ status: "modified", path: "a.ts" }]);
  });
});

describe("parseNumstat", () => {
  it("parses additions/deletions", () => {
    expect(parseNumstat("19\t0\t.terminalx/settings.toml\n")).toEqual([
      { additions: 19, deletions: 0, isBinary: false, path: ".terminalx/settings.toml" },
    ]);
  });

  it("flags binary files (-\t-) with zeroed counts", () => {
    expect(parseNumstat("-\t-\tassets/logo.png\n")).toEqual([
      { additions: 0, deletions: 0, isBinary: true, path: "assets/logo.png" },
    ]);
  });

  it("parses the brace rename form into old/new paths", () => {
    const [entry] = parseNumstat("2\t1\tsrc/{old => new}/file.ts\n");
    expect(entry!.path).toBe("src/new/file.ts");
    expect(entry!.oldPath).toBe("src/old/file.ts");
  });

  it("parses the simple arrow rename form", () => {
    const [entry] = parseNumstat("0\t0\told.ts => new.ts\n");
    expect(entry!.path).toBe("new.ts");
    expect(entry!.oldPath).toBe("old.ts");
  });
});

describe("mergeNameStatusAndNumstat", () => {
  it("produces FileDiff rows with emphasized filename, dir, delta, and status", () => {
    const files = mergeNameStatusAndNumstat(
      "A\t.terminalx/settings.toml\n",
      "19\t0\t.terminalx/settings.toml\n"
    );
    expect(files).toHaveLength(1);
    const f = files[0]!;
    expect(f.path).toBe(".terminalx/settings.toml");
    expect(f.dir).toBe(".terminalx/");
    expect(f.filename).toBe("settings.toml");
    expect(f.extension).toBe("toml");
    expect(f.status).toBe("added");
    expect(f.additions).toBe(19);
    expect(f.deletions).toBe(0);
    expect(f.isBinary).toBe(false);
    expect(f.hunks).toBeUndefined();
  });

  it("carries binary flag and zero deltas for binary files", () => {
    const files = mergeNameStatusAndNumstat("M\tlogo.png\n", "-\t-\tlogo.png\n");
    expect(files[0]!.isBinary).toBe(true);
    expect(files[0]!.additions).toBe(0);
    expect(files[0]!.deletions).toBe(0);
  });

  it("carries rename oldPath + similarity", () => {
    const files = mergeNameStatusAndNumstat(
      "R096\tsrc/old.ts\tsrc/new.ts\n",
      "2\t1\tsrc/{old => new}.ts\n"
    );
    expect(files[0]!.status).toBe("renamed");
    expect(files[0]!.oldPath).toBe("src/old.ts");
    expect(files[0]!.similarity).toBe(96);
  });
});

describe("parseUnifiedDiff", () => {
  const patch = [
    "diff --git a/src/foo.ts b/src/foo.ts",
    "index e69de29..4b825dc 100644",
    "--- a/src/foo.ts",
    "+++ b/src/foo.ts",
    "@@ -10,5 +12,6 @@ export function foo() {",
    " const x = 1",
    "+const y = 2",
    "-console.log(x)",
    " return x",
    "\\ No newline at end of file",
  ].join("\n");

  it("skips file headers and starts at the @@ hunk header", () => {
    const hunks = parseUnifiedDiff(patch, "abc");
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.header).toBe("@@ -10,5 +12,6 @@ export function foo() {");
    expect(hunks[0]!.oldStart).toBe(10);
    expect(hunks[0]!.oldCount).toBe(5);
    expect(hunks[0]!.newStart).toBe(12);
    expect(hunks[0]!.newCount).toBe(6);
    expect(hunks[0]!.index).toBe(0);
  });

  it("classifies lines and tracks old/new line numbers", () => {
    const [hunk] = parseUnifiedDiff(patch, "abc");
    const types = hunk!.lines.map((l) => l.type);
    expect(types).toEqual(["context", "addition", "deletion", "context"]);

    const [ctx1, add, del, ctx2] = hunk!.lines;
    expect(ctx1).toMatchObject({ content: "const x = 1", oldLineNum: 10, newLineNum: 12 });
    expect(add).toMatchObject({ content: "const y = 2", oldLineNum: null, newLineNum: 13 });
    expect(del).toMatchObject({ content: "console.log(x)", oldLineNum: 11, newLineNum: null });
    expect(ctx2).toMatchObject({ content: "return x", oldLineNum: 12, newLineNum: 14 });
  });

  it("assigns stable per-line ids of the form fileId:hunkIndex:lineIndex", () => {
    const [hunk] = parseUnifiedDiff(patch, "abc");
    expect(hunk!.lines[0]!.id).toBe("abc:0:0");
    expect(hunk!.lines[1]!.id).toBe("abc:0:1");
  });

  it("defaults count to 1 when the @@ header omits it", () => {
    const single = ["@@ -1 +1 @@", "-old", "+new"].join("\n");
    const [hunk] = parseUnifiedDiff(single, "x");
    expect(hunk!.oldCount).toBe(1);
    expect(hunk!.newCount).toBe(1);
  });

  it("parses multiple hunks with increasing indices", () => {
    const multi = ["@@ -1,1 +1,1 @@", "-a", "+A", "@@ -10,1 +10,1 @@", "-b", "+B"].join("\n");
    const hunks = parseUnifiedDiff(multi, "y");
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.index).toBe(0);
    expect(hunks[1]!.index).toBe(1);
    expect(hunks[1]!.lines[0]!.id).toBe("y:1:0");
  });
});

describe("pairLines (split mode)", () => {
  function ln(type: DiffLine["type"], content: string): DiffLine {
    return { id: content, type, content, oldLineNum: null, newLineNum: null };
  }

  it("pairs deletions with empty right and additions with empty left", () => {
    const pairs = pairLines([
      ln("context", "ctx-a"),
      ln("deletion", "del-1"),
      ln("addition", "add-1"),
      ln("context", "ctx-b"),
    ]);
    expect(pairs.map(([l, r]) => [l?.content ?? null, r?.content ?? null])).toEqual([
      ["ctx-a", "ctx-a"],
      ["del-1", "add-1"],
      ["ctx-b", "ctx-b"],
    ]);
  });

  it("pads uneven deletion/addition runs with nulls", () => {
    const pairs = pairLines([ln("deletion", "d1"), ln("deletion", "d2"), ln("addition", "a1")]);
    expect(pairs.map(([l, r]) => [l?.content ?? null, r?.content ?? null])).toEqual([
      ["d1", "a1"],
      ["d2", null],
    ]);
  });
});

describe("buildResponse", () => {
  it("derives the summary (filesChanged, additions, deletions, byStatus)", () => {
    const res = buildResponse({
      repoPath: "/repo",
      base: "main",
      head: "feature",
      timestamp: 123,
      files: [
        {
          id: "1",
          path: "a.ts",
          filename: "a.ts",
          dir: "",
          extension: "ts",
          status: "added",
          additions: 5,
          deletions: 0,
          isBinary: false,
        },
        {
          id: "2",
          path: "b.ts",
          filename: "b.ts",
          dir: "",
          extension: "ts",
          status: "modified",
          additions: 2,
          deletions: 3,
          isBinary: false,
        },
      ],
    });
    expect(res.summary.filesChanged).toBe(2);
    expect(res.summary.additions).toBe(7);
    expect(res.summary.deletions).toBe(3);
    expect(res.summary.byStatus.added).toBe(1);
    expect(res.summary.byStatus.modified).toBe(1);
    expect(res.summary.byStatus.deleted).toBe(0);
    expect(res.request.timestamp).toBe(123);
    expect(res.isComplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Real-git integration — mirrors git-worktree.test.ts setup. Skipped if no git.
// ---------------------------------------------------------------------------

const describeGit = hasGit() ? describe : describe.skip;

describeGit("computeDiff against a real repo", () => {
  let tmpDir: string;
  let repoDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tx-git-diff-")));
    repoDir = path.join(tmpDir, "repo");
    fs.mkdirSync(path.join(repoDir, "src"), { recursive: true });
    git(tmpDir, ["init", "-b", "main", repoDir]);
    git(repoDir, ["config", "user.email", "terminalx@example.test"]);
    git(repoDir, ["config", "user.name", "TerminalX Test"]);
    fs.writeFileSync(path.join(repoDir, "README.md"), "hello\nworld\n");
    fs.writeFileSync(path.join(repoDir, "src", "index.ts"), "export const value = 1;\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "initial"]);

    // Feature branch: add a file, modify another.
    git(repoDir, ["checkout", "-b", "feature/sample-change"]);
    fs.mkdirSync(path.join(repoDir, ".terminalx"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, ".terminalx", "settings.toml"), "[diff]\nenabled = true\n");
    fs.writeFileSync(path.join(repoDir, "src", "index.ts"), "export const value = 2;\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "feature change"]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves the merge-base of head against the default branch", () => {
    const base = resolveBase(repoDir, "feature/sample-change");
    expect(base).toBeTruthy();
    // merge-base of feature and main == the initial commit.
    const initial = git(repoDir, ["rev-parse", "main"]);
    expect(base).toBe(initial);
  });

  it("returns the changed file list with status + deltas (no hunks when includeHunks=false)", () => {
    const res = computeDiff({
      safeRoot: repoDir,
      base: "main",
      head: "feature/sample-change",
      includeHunks: false,
    });
    const paths = res.files.map((f) => f.path).sort();
    expect(paths).toEqual([".terminalx/settings.toml", "src/index.ts"]);

    const added = res.files.find((f) => f.path === ".terminalx/settings.toml")!;
    expect(added.status).toBe("added");
    expect(added.additions).toBeGreaterThan(0);
    expect(added.filename).toBe("settings.toml");
    expect(added.dir).toBe(".terminalx/");
    expect(added.hunks).toBeUndefined();

    const modified = res.files.find((f) => f.path === "src/index.ts")!;
    expect(modified.status).toBe("modified");
    expect(modified.additions).toBe(1);
    expect(modified.deletions).toBe(1);

    expect(res.summary.filesChanged).toBe(2);
    expect(res.summary.byStatus.added).toBe(1);
    expect(res.summary.byStatus.modified).toBe(1);
  });

  it("includes parsed hunks for a modified file by default", () => {
    const res = computeDiff({
      safeRoot: repoDir,
      base: "main",
      head: "feature/sample-change",
    });
    const modified = res.files.find((f) => f.path === "src/index.ts")!;
    expect(modified.hunks).toBeDefined();
    expect(modified.hunks!.length).toBeGreaterThanOrEqual(1);
    const allLines = modified.hunks!.flatMap((h) => h.lines);
    expect(allLines.some((l) => l.type === "addition" && l.content.includes("value = 2"))).toBe(
      true
    );
    expect(allLines.some((l) => l.type === "deletion" && l.content.includes("value = 1"))).toBe(
      true
    );
  });

  it("computeFileDiff returns a single file with hunks", () => {
    const file = computeFileDiff({
      safeRoot: repoDir,
      base: "main",
      head: "feature/sample-change",
      path: "src/index.ts",
    });
    expect(file).not.toBeNull();
    expect(file!.path).toBe("src/index.ts");
    expect(file!.hunks).toBeDefined();
    expect(file!.hunks!.length).toBeGreaterThanOrEqual(1);
  });

  it("detects a rename as renamed with oldPath", () => {
    git(repoDir, ["mv", "README.md", "READYOU.md"]);
    git(repoDir, ["commit", "-m", "rename readme"]);
    const res = computeDiff({
      safeRoot: repoDir,
      base: "main",
      head: "feature/sample-change",
      includeHunks: false,
    });
    const renamed = res.files.find((f) => f.path === "READYOU.md");
    expect(renamed).toBeDefined();
    expect(renamed!.status).toBe("renamed");
    expect(renamed!.oldPath).toBe("README.md");
  });

  it("returns an empty file list when head == base", () => {
    const res = computeDiff({
      safeRoot: repoDir,
      base: "main",
      head: "main",
      includeHunks: false,
    });
    expect(res.files).toEqual([]);
    expect(res.summary.filesChanged).toBe(0);
  });
});

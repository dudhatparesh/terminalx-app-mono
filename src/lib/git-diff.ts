/**
 * git-diff: shell out to `git diff` and parse the output into the structured
 * model in src/types/diff.ts. Pure parsing functions (no React, no filesystem
 * side effects beyond the git invocation) so they can be unit-tested thoroughly.
 *
 * See docs/conductor-parity/designs/diff-viewer.spec.md §3.
 */
import * as crypto from "crypto";
import { execFileSync } from "child_process";
import type { DiffHunk, DiffLine, DiffResponse, FileDiff, FileStatus } from "@/types/diff";

const GIT_DIFF_TIMEOUT_MS = 20_000;
const GIT_DIFF_MAX_BUFFER = 16 * 1024 * 1024;

/** Run git in a repo with an argument array (no shell). Mirrors git-worktree.ts. */
export function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_DIFF_TIMEOUT_MS,
    maxBuffer: GIT_DIFF_MAX_BUFFER,
  });
}

/** Stable, short id for a file derived from its path(s). */
export function fileId(path: string, oldPath?: string): string {
  return crypto
    .createHash("sha1")
    .update(oldPath ? `${oldPath}\0${path}` : path)
    .digest("hex")
    .slice(0, 12);
}

/** Split a repo-relative path into { dir, filename } where dir keeps its trailing slash. */
export function splitPath(path: string): { dir: string; filename: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { dir: "", filename: path };
  return { dir: path.slice(0, idx + 1), filename: path.slice(idx + 1) };
}

/** Extension without the leading dot ("" when none / dotfile with no extension). */
export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  // No dot, or a leading dot with nothing after (".env" → no extension).
  if (dot <= 0) return "";
  return filename.slice(dot + 1);
}

/**
 * Map a `git diff --name-status` status letter to our FileStatus.
 * X letter forms: A, D, M, Rxxx (rename, with similarity), Cxxx (copy), T (type/mode).
 */
export function mapStatus(letter: string): FileStatus {
  const code = letter[0] ?? "M";
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "mode-change";
    case "M":
    default:
      return "modified";
  }
}

/** Build the per-file row metadata (path/dir/filename/extension/id). */
function baseFileFields(
  path: string,
  oldPath?: string
): Pick<FileDiff, "id" | "path" | "filename" | "dir" | "extension" | "oldPath"> {
  const { dir, filename } = splitPath(path);
  return {
    id: fileId(path, oldPath),
    path,
    filename,
    dir,
    extension: fileExtension(filename),
    ...(oldPath ? { oldPath } : {}),
  };
}

interface NameStatusEntry {
  status: FileStatus;
  path: string;
  oldPath?: string;
  similarity?: number;
}

/**
 * Parse `git diff --name-status -M -C` (tab-separated). Rename/copy rows have
 * THREE fields: `R096\told\tnew`. Everything else has two: `M\tpath`.
 */
export function parseNameStatus(raw: string): NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    const status = mapStatus(code);
    if ((code.startsWith("R") || code.startsWith("C")) && parts.length >= 3) {
      const simMatch = code.match(/\d+/);
      entries.push({
        status,
        oldPath: parts[1] ?? "",
        path: parts[2] ?? "",
        ...(simMatch ? { similarity: parseInt(simMatch[0], 10) } : {}),
      });
    } else {
      entries.push({ status, path: parts[1] ?? "" });
    }
  }
  return entries;
}

interface NumstatEntry {
  additions: number;
  deletions: number;
  isBinary: boolean;
  /** new path (or rename target) */
  path: string;
  oldPath?: string;
}

/**
 * Parse `git diff --numstat -M -C`. Columns: `<add>\t<del>\t<path>`.
 * Binary files report `-\t-\t<path>`. Renames render the path as either
 * `old => new` or the brace form `dir/{old => new}/file`.
 */
export function parseNumstat(raw: string): NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [addStr = "", delStr = "", ...rest] = parts;
    const pathField = rest.join("\t");
    const isBinary = addStr === "-" && delStr === "-";
    const { path, oldPath } = parseNumstatPath(pathField);
    entries.push({
      additions: isBinary ? 0 : parseInt(addStr, 10) || 0,
      deletions: isBinary ? 0 : parseInt(delStr, 10) || 0,
      isBinary,
      path,
      ...(oldPath ? { oldPath } : {}),
    });
  }
  return entries;
}

/** Resolve the numstat path field, which for renames uses `=>` notations. */
function parseNumstatPath(field: string): { path: string; oldPath?: string } {
  // Brace form: `src/{old => new}/file.ts`
  const brace = field.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (brace) {
    const prefix = brace[1] ?? "";
    const from = brace[2] ?? "";
    const to = brace[3] ?? "";
    const suffix = brace[4] ?? "";
    const oldPath = `${prefix}${from}${suffix}`.replace(/\/\//g, "/");
    const path = `${prefix}${to}${suffix}`.replace(/\/\//g, "/");
    return { path, oldPath };
  }
  // Simple form: `old => new`
  const arrow = field.match(/^(.*) => (.*)$/);
  if (arrow) {
    return { path: arrow[2] ?? field, oldPath: arrow[1] ?? "" };
  }
  return { path: field };
}

/**
 * Merge `--name-status` (authoritative for status + rename old/new) with
 * `--numstat` (additions/deletions/binary) into FileDiff[] (no hunks yet).
 */
export function mergeNameStatusAndNumstat(nameStatusRaw: string, numstatRaw: string): FileDiff[] {
  const nameEntries = parseNameStatus(nameStatusRaw);
  const numEntries = parseNumstat(numstatRaw);
  const numByPath = new Map<string, NumstatEntry>();
  for (const n of numEntries) numByPath.set(n.path, n);

  return nameEntries.map((ne) => {
    const num = numByPath.get(ne.path);
    return {
      ...baseFileFields(ne.path, ne.oldPath),
      status: ne.status,
      additions: num?.additions ?? 0,
      deletions: num?.deletions ?? 0,
      isBinary: num?.isBinary ?? false,
      ...(ne.similarity !== undefined ? { similarity: ne.similarity } : {}),
    };
  });
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Parse a single-file unified patch (the body of `git diff -U<n> base...head -- <path>`)
 * into DiffHunk[]. `id` seeds the stable per-line ids. Leading file headers
 * (`diff --git`, `index`, `---`, `+++`) are skipped; parsing begins at the first
 * `@@` hunk header.
 */
export function parseUnifiedDiff(patch: string, id: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = patch.split("\n");
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let lineIndex = 0;

  for (const raw of lines) {
    const headerMatch = raw.match(HUNK_HEADER_RE);
    if (headerMatch) {
      const oldStart = parseInt(headerMatch[1] ?? "0", 10);
      const oldCount = headerMatch[2] !== undefined ? parseInt(headerMatch[2], 10) : 1;
      const newStart = parseInt(headerMatch[3] ?? "0", 10);
      const newCount = headerMatch[4] !== undefined ? parseInt(headerMatch[4], 10) : 1;
      hunk = {
        header: raw,
        oldStart,
        oldCount,
        newStart,
        newCount,
        index: hunks.length,
        lines: [],
      };
      hunks.push(hunk);
      oldLine = oldStart;
      newLine = newStart;
      lineIndex = 0;
      continue;
    }

    if (!hunk) continue; // Pre-hunk file headers.

    // "\ No newline at end of file" — attach to nothing; skip as metadata.
    if (raw.startsWith("\\")) continue;

    const marker = raw[0];
    const content = raw.slice(1);
    const lineId = `${id}:${hunk.index}:${lineIndex}`;

    if (marker === "+") {
      hunk.lines.push(line(lineId, "addition", content, null, newLine));
      newLine++;
    } else if (marker === "-") {
      hunk.lines.push(line(lineId, "deletion", content, oldLine, null));
      oldLine++;
    } else if (marker === " ") {
      hunk.lines.push(line(lineId, "context", content, oldLine, newLine));
      oldLine++;
      newLine++;
    } else if (raw === "") {
      // A blank line inside a hunk is a context line with empty content. git
      // unified output always prefixes context with a space, so a truly empty
      // string is the trailing split artifact — ignore it.
      continue;
    } else {
      continue;
    }
    lineIndex++;
  }

  return hunks;
}

function line(
  id: string,
  type: DiffLine["type"],
  content: string,
  oldLineNum: number | null,
  newLineNum: number | null
): DiffLine {
  return { id, type, content, oldLineNum, newLineNum };
}

// pairLines moved to "@/lib/diff-pairing" (browser-safe) so client components
// can split-render without pulling this server-only module into the bundle.

/** Compose the DiffResponse envelope (summary derived from the file rows). */
export function buildResponse(input: {
  session?: string;
  repoPath: string;
  base: string;
  head: string;
  files: FileDiff[];
  isComplete?: boolean;
  timestamp?: number;
}): DiffResponse {
  const byStatus: Record<FileStatus, number> = {
    added: 0,
    deleted: 0,
    modified: 0,
    renamed: 0,
    copied: 0,
    "mode-change": 0,
  };
  let additions = 0;
  let deletions = 0;
  for (const f of input.files) {
    byStatus[f.status]++;
    additions += f.additions;
    deletions += f.deletions;
  }
  return {
    request: {
      ...(input.session ? { session: input.session } : {}),
      repoPath: input.repoPath,
      base: input.base,
      head: input.head,
      timestamp: input.timestamp ?? Date.now(),
    },
    files: input.files,
    summary: {
      filesChanged: input.files.length,
      additions,
      deletions,
      byStatus,
    },
    isComplete: input.isComplete ?? true,
  };
}

/**
 * Resolve the base ref for a head: the merge-base of head and the repo's
 * default branch, so the diff matches what the workspace's PR would show
 * (three-dot range). Falls back to `head~1` when no merge-base exists
 * (e.g. detached / no default branch). Returns null when even that fails.
 */
export function resolveBase(cwd: string, head: string): string | null {
  const candidates = defaultBranchCandidates(cwd);
  for (const cand of candidates) {
    try {
      const mb = git(cwd, ["merge-base", cand, head]).trim();
      if (mb) return mb;
    } catch {
      /* try next candidate */
    }
  }
  // No default branch / no merge-base: diff against the parent commit.
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", `${head}~1`]);
    return `${head}~1`;
  } catch {
    return null;
  }
}

function defaultBranchCandidates(cwd: string): string[] {
  const candidates: string[] = [];
  try {
    const symRef = git(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]).trim();
    // refs/remotes/origin/main → origin/main
    const m = symRef.match(/refs\/remotes\/(.+)$/);
    if (m && m[1]) candidates.push(m[1]);
  } catch {
    /* no origin/HEAD */
  }
  candidates.push("main", "master", "origin/main", "origin/master");
  return candidates;
}

/**
 * Compute the full diff (file list WITH hunks) between two refs of a repo.
 * Used by POST /api/diffs. `safeRoot` MUST already be sandbox-validated by the
 * caller. Returns the spec's DiffResponse.
 */
export function computeDiff(input: {
  safeRoot: string;
  base: string;
  head: string;
  session?: string;
  context?: number;
  maxFiles?: number;
  includeHunks?: boolean;
}): DiffResponse {
  const { safeRoot, base, head } = input;
  const context = input.context ?? 3;
  const maxFiles = input.maxFiles ?? 300;
  const range = `${base}...${head}`;

  const nameStatus = git(safeRoot, ["diff", "--name-status", "-M", "-C", range]);
  const numStat = git(safeRoot, ["diff", "--numstat", "-M", "-C", range]);

  let files = mergeNameStatusAndNumstat(nameStatus, numStat);
  if (files.length > maxFiles) files = files.slice(0, maxFiles);

  if (input.includeHunks !== false) {
    for (const file of files) {
      if (file.isBinary || file.status === "mode-change") continue;
      const targetPath = file.path;
      try {
        const patch = git(safeRoot, [
          "diff",
          `--unified=${context}`,
          "-M",
          "-C",
          range,
          "--",
          ...(file.oldPath ? [file.oldPath, targetPath] : [targetPath]),
        ]);
        file.hunks = parseUnifiedDiff(patch, file.id);
      } catch {
        // Leave hunks undefined on per-file failure; the row still renders.
      }
    }
  }

  return buildResponse({
    session: input.session,
    repoPath: safeRoot,
    base,
    head,
    files,
  });
}

/**
 * Compute hunks for a single file (lazy expand, spec §3.3).
 * `safeRoot` MUST already be sandbox-validated by the caller.
 */
export function computeFileDiff(input: {
  safeRoot: string;
  base: string;
  head: string;
  path: string;
  context?: number;
}): FileDiff | null {
  const { safeRoot, base, head, path } = input;
  const context = input.context ?? 3;
  const range = `${base}...${head}`;

  const nameStatus = git(safeRoot, ["diff", "--name-status", "-M", "-C", range, "--", path]);
  const numStat = git(safeRoot, ["diff", "--numstat", "-M", "-C", range, "--", path]);
  const files = mergeNameStatusAndNumstat(nameStatus, numStat);
  const file = files.find((f) => f.path === path) ?? files[0];
  if (!file) return null;

  if (!file.isBinary && file.status !== "mode-change") {
    const patch = git(safeRoot, ["diff", `--unified=${context}`, "-M", "-C", range, "--", path]);
    file.hunks = parseUnifiedDiff(patch, file.id);
  }
  return file;
}

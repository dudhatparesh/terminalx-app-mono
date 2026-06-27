/**
 * Data model for the Diff Viewer (the "Changes" tab of the Review panel).
 * See docs/conductor-parity/designs/diff-viewer.spec.md §2.
 */

/** A diff line. `+`/`-` markers are stripped; `type` carries the marker. */
export interface DiffLine {
  /** Stable id: `${fileId}:${hunkIndex}:${lineIndex}` */
  id: string;
  type: "context" | "addition" | "deletion";
  content: string;
  /** Original-file line number; null on additions. */
  oldLineNum: number | null;
  /** New-file line number; null on deletions. */
  newLineNum: number | null;
}

/** A contiguous `@@ ... @@` block plus its context. */
export interface DiffHunk {
  /** e.g. "@@ -10,5 +12,8 @@ export function foo() {" */
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  index: number;
  lines: DiffLine[];
}

export type FileStatus = "added" | "deleted" | "modified" | "renamed" | "copied" | "mode-change";

/** One changed file. The Changes-tab file row is rendered from this. */
export interface FileDiff {
  /** Stable id (hash of path+oldPath). */
  id: string;
  /** Repo-relative path, e.g. ".terminalx/settings.toml". */
  path: string;
  /** Trailing filename, emphasized in the row, e.g. "settings.toml". */
  filename: string;
  /** Directory prefix, muted in the row, e.g. ".terminalx/". */
  dir: string;
  /** Extension (no dot), for the file/status icon + highlighting hint. */
  extension: string;
  status: FileStatus;
  /** Previous path when status === "renamed" | "copied". */
  oldPath?: string;
  additions: number; // "+N" in the row
  deletions: number; // "-N" in the row
  isBinary: boolean;
  /** Absent until the file is expanded (lazy diff). */
  hunks?: DiffHunk[];
  /** Similarity 0–100 for renames. */
  similarity?: number;
  /** Set when the file was truncated for size. */
  truncated?: boolean;
  oldMode?: string;
  newMode?: string;
}

/** The whole Changes payload for a workspace's branch vs base. */
export interface DiffResponse {
  request: {
    /** Session whose worktree was diffed (when applicable). */
    session?: string;
    repoPath: string;
    base: string; // the ref we diffed against (e.g. "main")
    head: string; // the workspace branch (e.g. "feature/x" or "HEAD")
    timestamp: number;
  };
  files: FileDiff[];
  summary: {
    filesChanged: number;
    additions: number;
    deletions: number;
    byStatus: Record<FileStatus, number>;
  };
  /** False while streaming. */
  isComplete: boolean;
}

/** View-only UI state (not persisted server-side). spec §2.1 */
export interface DiffViewPrefs {
  layout: "unified" | "split"; // a.k.a. side-by-side; persisted to localStorage
  wordWrap: boolean;
  /** Files whose diff is collapsed in the Changes tab. */
  collapsed: string[]; // FileDiff.id (serializable; Set in spec, array on the wire)
}

// Recording cleanup for archived/deleted worktrees (issue #9).
//
// SERVER-ONLY (fs/path). On a CONFIRMED delete (workspace delete, or a session
// delete) a worktree's recordings under data/recordings/ are pruned. Archiving a
// worktree does NOT call this — archived worktrees keep their recordings until a
// later purge.
//
// The recorder (session-recorder.ts) names files "<sanitized-sessionId>-<ts>.jsonl"
// and writes the RAW sessionId into the first-line header. We match BOTH:
//   1. the header sessionId (authoritative), and
//   2. the sanitized-name prefix "<sanitized>-" (best-effort, for legacy or
//      header-less files), bounded by the "-" the recorder always inserts before
//      the timestamp so "feat" never sweeps "feature".

import * as fs from "fs";
import * as path from "path";

function recordingsDir(): string {
  // Mirror session-recorder.ts: resolved from cwd so tests can chdir into a tmp.
  return path.join(process.cwd(), "data", "recordings");
}

/** Same sanitizer the recorder uses to build the on-disk id. */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.\-]/g, "_");
}

function readHeaderSessionId(file: string): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.subarray(0, n).toString("utf-8");
    const idx = text.indexOf("\n");
    const firstLine = idx === -1 ? text : text.slice(0, idx);
    const header = JSON.parse(firstLine) as { sessionId?: unknown };
    return typeof header.sessionId === "string" ? header.sessionId : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Delete every recording belonging to a session/worktree. Best-effort: a single
 * failed unlink never aborts the rest. Returns the number of files removed.
 */
export function deleteRecordingsForSession(sessionId: string): { deleted: number } {
  const dir = recordingsDir();
  if (!fs.existsSync(dir)) return { deleted: 0 };

  const sanitizedPrefix = `${sanitize(sessionId)}-`;
  let deleted = 0;

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return { deleted: 0 };
  }

  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const full = path.join(dir, name);

    const headerId = readHeaderSessionId(full);
    const matchesHeader = headerId !== null && headerId === sessionId;
    // The recorder always inserts "<sanitized>-<timestamp>", so requiring the
    // trailing "-" keeps "feat" from sweeping "feature-...".
    const matchesPrefix = name.startsWith(sanitizedPrefix);

    if (!matchesHeader && !matchesPrefix) continue;

    try {
      fs.unlinkSync(full);
      deleted++;
    } catch {
      // Best-effort: leave the rest of the sweep intact.
    }
  }

  return { deleted };
}

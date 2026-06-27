// Best-effort orphaned-worktree sweep (issue #9).
//
// SERVER-ONLY (fs/path). Prunes worktree dirs under the worktrees root whose
// owning session no longer exists — e.g. a worktree removed out-of-band, or a
// stale dir left behind by a partially-failed teardown. Worktrees still
// referenced by a session meta (active OR archived) are KEPT: an archived
// worktree's meta still points at its path so a restore can rebuild in place.
//
// The sweep is confined to getWorktreesBaseDir() (validated against
// TERMINUS_ROOT, never a sensitive path) and never throws — a single failed
// removal is swallowed so a sweep can never block the delete that triggered it.

import * as fs from "fs";
import * as path from "path";
import { getWorktreesBaseDir } from "./git-worktree";
import { listMetadata } from "./ai-sessions";
import { assertNotSensitivePath, resolveSafePath } from "./file-service";

/**
 * Remove worktree directories under the worktrees root that no session meta
 * references. Returns the number of dirs removed. Only directories are
 * considered (stray files are left untouched).
 */
export function pruneOrphanedWorktrees(): { removed: number } {
  let baseDir: string;
  try {
    baseDir = getWorktreesBaseDir();
  } catch {
    return { removed: 0 };
  }
  if (!fs.existsSync(baseDir)) return { removed: 0 };

  // Every worktree path any session (active or archived) still references.
  const referenced = new Set<string>();
  for (const meta of listMetadata()) {
    const p = meta.worktree?.path;
    if (!p) continue;
    try {
      referenced.add(resolveSafePath(p));
    } catch {
      // Unresolvable path → can't match it; ignore.
    }
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return { removed: 0 };
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue; // only prune orphaned DIRS
    const full = path.join(baseDir, entry.name);

    let safeFull: string;
    try {
      safeFull = resolveSafePath(full);
      assertNotSensitivePath(safeFull);
    } catch {
      // Never touch a path that fails validation.
      continue;
    }
    // Confirm the entry stays inside the worktrees base (no symlink escape).
    const rel = path.relative(baseDir, safeFull);
    if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") continue;

    if (referenced.has(safeFull)) continue; // still owned by a session

    try {
      fs.rmSync(safeFull, { recursive: true, force: true });
      removed++;
    } catch {
      // Best-effort: leave the rest of the sweep intact.
    }
  }

  return { removed };
}

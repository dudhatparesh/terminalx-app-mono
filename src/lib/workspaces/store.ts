// Workspace registration store (issue #12, corrected model).
//
// SERVER-ONLY (fs/path). Persists registered project/repo containers to
// data/workspaces.json, keyed by repoRoot. Atomic writes (tmp + rename) and a
// serialized withLock chain mirror ai-sessions.ts / settings/store.ts; the file
// is written mode 0600. Reads degrade to an empty list on any error.
//
// A Workspace maps to ONE git repo. Worktrees are NOT stored here — they are
// derived from sessions whose SessionMeta.worktree.repoRoot matches (see
// derive.ts). Deleting a workspace removes the project registration; the API
// route additionally removes each worktree.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ensureSecureDir } from "@/lib/secure-dir";
import { resolveSafePath, assertNotSensitivePath } from "@/lib/file-service";
import { getGitDirectoryInfo } from "@/lib/git-worktree";
import { defaultWorkspaceName } from "./derive";
import type { Workspace } from "@/types/workspace";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "workspaces.json");

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.then(
    () => {},
    () => {}
  );
  return next;
}

function atomicWrite(list: Workspace[]) {
  ensureSecureDir(DATA_DIR);
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

export function listWorkspaces(): Workspace[] {
  try {
    ensureSecureDir(DATA_DIR);
    if (!fs.existsSync(FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8")) as Workspace[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getWorkspace(id: string): Workspace | undefined {
  return listWorkspaces().find((w) => w.id === id);
}

export function getWorkspaceByRepoRoot(repoRoot: string): Workspace | undefined {
  return listWorkspaces().find((w) => w.repoRoot === repoRoot);
}

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

/**
 * Register a workspace for a selected directory. Validates the directory is a
 * git repo (via getGitDirectoryInfo, confined to TERMINUS_ROOT) and resolves it
 * to the repo ROOT so two checkouts of the same repo collapse to one workspace.
 * Idempotent: re-registering an existing repoRoot returns the existing record.
 */
export async function registerWorkspace(input: {
  directory: string;
  name?: string;
}): Promise<Workspace> {
  // Confine to the sandbox before shelling out to git.
  let safeDir: string;
  try {
    safeDir = resolveSafePath(input.directory);
    assertNotSensitivePath(safeDir);
  } catch {
    throw new WorkspaceError("Access denied", 403);
  }

  const info = getGitDirectoryInfo(safeDir);
  if (!info.isRepo || !info.root) {
    throw new WorkspaceError("Selected directory is not a Git repository", 400);
  }
  const repoRoot = info.root;

  return withLock(async () => {
    const list = listWorkspaces();
    const existing = list.find((w) => w.repoRoot === repoRoot);
    if (existing) return existing;

    const name = (input.name?.trim() || info.repoName || defaultWorkspaceName(repoRoot)).slice(
      0,
      120
    );
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      repoRoot,
      name,
      createdAt: new Date().toISOString(),
    };
    list.push(workspace);
    atomicWrite(list);
    return workspace;
  });
}

/**
 * Remove a workspace registration by id. Returns the removed record (so the
 * caller can tear down its worktrees) or undefined when no such id exists.
 * NOTE: this only drops the registration — worktree removal is the route's job.
 */
export async function deleteWorkspace(id: string): Promise<Workspace | undefined> {
  return withLock(async () => {
    const list = listWorkspaces();
    const idx = list.findIndex((w) => w.id === id);
    if (idx === -1) return undefined;
    const [removed] = list.splice(idx, 1);
    atomicWrite(list);
    return removed;
  });
}

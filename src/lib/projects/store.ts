// Project registration store (issue #12, corrected model).
//
// SERVER-ONLY (fs/path). Persists registered project/repo containers to
// data/projects.json, keyed by repoRoot. Atomic writes (tmp + rename) and a
// serialized withLock chain mirror ai-sessions.ts / settings/store.ts; the file
// is written mode 0600. Reads degrade to an empty list on any error.
//
// A Project maps to ONE git repo. Workspaces are NOT stored here — they are
// derived from sessions whose SessionMeta.worktree.repoRoot matches (see
// derive.ts). Deleting a project removes the project registration; the API
// route additionally removes each workspace.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ensureSecureDir } from "@/lib/secure-dir";
import { resolveSafePath, assertNotSensitivePath } from "@/lib/file-service";
import { getGitDirectoryInfo } from "@/lib/git-worktree";
import { defaultProjectName } from "./derive";
import type { Project } from "@/types/project";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "projects.json");

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.then(
    () => {},
    () => {}
  );
  return next;
}

function atomicWrite(list: Project[]) {
  ensureSecureDir(DATA_DIR);
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

export function listProjects(): Project[] {
  try {
    ensureSecureDir(DATA_DIR);
    if (!fs.existsSync(FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8")) as Project[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getProject(id: string): Project | undefined {
  return listProjects().find((p) => p.id === id);
}

export function getProjectByRepoRoot(repoRoot: string): Project | undefined {
  return listProjects().find((p) => p.repoRoot === repoRoot);
}

export class ProjectError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ProjectError";
  }
}

/**
 * Register a project for a selected directory. Validates the directory is a
 * git repo (via getGitDirectoryInfo, confined to TERMINUS_ROOT) and resolves it
 * to the repo ROOT so two checkouts of the same repo collapse to one project.
 * Idempotent: re-registering an existing repoRoot returns the existing record.
 */
export async function registerProject(input: {
  directory: string;
  name?: string;
}): Promise<Project> {
  // Confine to the sandbox before shelling out to git.
  let safeDir: string;
  try {
    safeDir = resolveSafePath(input.directory);
    assertNotSensitivePath(safeDir);
  } catch {
    throw new ProjectError("Access denied", 403);
  }

  const info = getGitDirectoryInfo(safeDir);
  if (!info.isRepo || !info.root) {
    throw new ProjectError("Selected directory is not a Git repository", 400);
  }
  const repoRoot = info.root;

  return withLock(async () => {
    const list = listProjects();
    const existing = list.find((p) => p.repoRoot === repoRoot);
    if (existing) return existing;

    const name = (input.name?.trim() || info.repoName || defaultProjectName(repoRoot)).slice(
      0,
      120
    );
    const project: Project = {
      id: crypto.randomUUID(),
      repoRoot,
      name,
      createdAt: new Date().toISOString(),
    };
    list.push(project);
    atomicWrite(list);
    return project;
  });
}

/**
 * Remove a project registration by id. Returns the removed record (so the
 * caller can tear down its workspaces) or undefined when no such id exists.
 * NOTE: this only drops the registration — workspace removal is the route's job.
 */
export async function deleteProject(id: string): Promise<Project | undefined> {
  return withLock(async () => {
    const list = listProjects();
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) return undefined;
    const [removed] = list.splice(idx, 1);
    atomicWrite(list);
    return removed;
  });
}

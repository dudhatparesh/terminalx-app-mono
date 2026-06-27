import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

// The store captures DATA_DIR from process.cwd() at module load (mirroring
// ai-sessions.ts). Load a FRESH instance after chdir so DATA_DIR points at the
// per-test tmp cwd. getGitDirectoryInfo shells out to real git, so we seed real
// repos inside TERMINUS_ROOT.
type StoreModule = typeof import("@/lib/projects/store");
async function freshStore(): Promise<StoreModule> {
  vi.resetModules();
  return import("@/lib/projects/store");
}

function git(repo: string, args: string[]): void {
  execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
}

function initRepo(root: string, dir: string): string {
  const repo = path.join(root, dir);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "t@example.test"]);
  git(repo, ["config", "user.name", "T"]);
  fs.writeFileSync(path.join(repo, "README.md"), "x\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "base"]);
  return repo;
}

describe("projects store (issue #12, corrected model)", () => {
  let root: string;
  let cwd: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    // TERMINUS_ROOT must contain both the repos and the cwd (resolveSafePath).
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tx-proj-")));
    process.env.TERMINUS_ROOT = root;
    cwd = path.join(root, "cwd");
    fs.mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    delete process.env.TERMINUS_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists empty when no file exists", async () => {
    const { listProjects } = await freshStore();
    expect(listProjects()).toEqual([]);
  });

  it("registers a git repo as a project keyed by repoRoot", async () => {
    const repo = initRepo(root, "myrepo");
    const { registerProject, listProjects } = await freshStore();
    const proj = await registerProject({ directory: repo });
    expect(proj.repoRoot).toBe(fs.realpathSync(repo));
    expect(proj.name).toBe("myrepo");
    expect(proj.id).toBeTruthy();
    expect(listProjects()).toHaveLength(1);
  });

  it("resolves a sub-directory to the repo root", async () => {
    const repo = initRepo(root, "myrepo2");
    const sub = path.join(repo, "src");
    fs.mkdirSync(sub, { recursive: true });
    const { registerProject } = await freshStore();
    const proj = await registerProject({ directory: sub });
    expect(proj.repoRoot).toBe(fs.realpathSync(repo));
  });

  it("is idempotent — re-registering the same repo returns the existing record", async () => {
    const repo = initRepo(root, "myrepo3");
    const { registerProject, listProjects } = await freshStore();
    const a = await registerProject({ directory: repo });
    const b = await registerProject({ directory: path.join(repo, "..", "myrepo3") });
    expect(b.id).toBe(a.id);
    expect(listProjects()).toHaveLength(1);
  });

  it("rejects a non-git directory with a 400 ProjectError", async () => {
    const plain = path.join(root, "plain");
    fs.mkdirSync(plain, { recursive: true });
    const { registerProject, ProjectError } = await freshStore();
    await expect(registerProject({ directory: plain })).rejects.toBeInstanceOf(ProjectError);
    await expect(registerProject({ directory: plain })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a path that escapes TERMINUS_ROOT with a 403", async () => {
    const { registerProject } = await freshStore();
    await expect(
      registerProject({ directory: path.join(root, "..", "..", "etc") })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("writes the data file with 0600 perms", async () => {
    const repo = initRepo(root, "permrepo");
    const { registerProject } = await freshStore();
    await registerProject({ directory: repo });
    const file = path.join(cwd, "data", "projects.json");
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it("deletes a project by id and returns the removed record", async () => {
    const repo = initRepo(root, "delrepo");
    const { registerProject, deleteProject, listProjects, getProject } = await freshStore();
    const proj = await registerProject({ directory: repo });
    const removed = await deleteProject(proj.id);
    expect(removed?.id).toBe(proj.id);
    expect(getProject(proj.id)).toBeUndefined();
    expect(listProjects()).toEqual([]);
  });

  it("deleting an unknown id returns undefined (no throw)", async () => {
    const { deleteProject } = await freshStore();
    await expect(deleteProject("nope")).resolves.toBeUndefined();
  });

  it("honors a custom display name", async () => {
    const repo = initRepo(root, "namedrepo");
    const { registerProject } = await freshStore();
    const proj = await registerProject({ directory: repo, name: "  My Project  " });
    expect(proj.name).toBe("My Project");
  });
});

// §1.1 JSON-file store under data/ (NOT a SQL DB). Mirrors the established
// load-all / mutate / atomicWrite-under-withLock pattern from src/lib/users.ts
// and src/lib/ai-sessions.ts. Three sibling files:
//   data/github-integrations.json  (GitHubIntegrationRecord[])
//   data/github-tokens.json        (GitHubTokenRecord[])
//   data/github-repositories.json  (GitHubRepositoryRecord[])
//
// Identity is the existing User.id (a string from data/users.json); records carry
// a `userId` field, NOT a SQL FK. Uniqueness + cascade-on-delete are enforced in
// code inside withLock (there are no DB constraints).
import * as fs from "fs";
import * as path from "path";
import { ensureSecureDir } from "../secure-dir";
import { GitHubIntegrationRecord, GitHubRepositoryRecord, GitHubTokenRecord } from "./types";

// Resolve paths lazily off process.cwd() so tests can chdir into a tmp dir for
// isolation (mirrors the session-recorder test's approach). Caching at module
// load would freeze data/ to the dir present at first import.
function dataDir(): string {
  return path.join(process.cwd(), "data");
}
function integrationsFile(): string {
  return path.join(dataDir(), "github-integrations.json");
}
function tokensFile(): string {
  return path.join(dataDir(), "github-tokens.json");
}
function reposFile(): string {
  return path.join(dataDir(), "github-repositories.json");
}

function ensureDir(): void {
  ensureSecureDir(dataDir());
}

// ── In-process write lock (shared across all three files) ────────────────────

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.then(
    () => {},
    () => {}
  );
  return next;
}

function readArray<T>(file: string): T[] {
  ensureDir();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T[];
  } catch {
    return [];
  }
}

function atomicWrite<T>(file: string, list: T[]): void {
  ensureDir();
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmp, file);
}

// ── Integrations ─────────────────────────────────────────────────────────────

export function listIntegrationRecords(): GitHubIntegrationRecord[] {
  return readArray<GitHubIntegrationRecord>(integrationsFile());
}

export function getIntegrationRecord(id: string): GitHubIntegrationRecord | undefined {
  return listIntegrationRecords().find((r) => r.id === id);
}

export function listIntegrationsForUser(userId: string): GitHubIntegrationRecord[] {
  return listIntegrationRecords().filter((r) => r.userId === userId);
}

export async function saveIntegrationRecord(rec: GitHubIntegrationRecord): Promise<void> {
  return withLock(async () => {
    const list = listIntegrationRecords();
    const idx = list.findIndex((r) => r.id === rec.id);
    if (idx !== -1) list[idx] = rec;
    else {
      // Enforce uniqueness on (userId, githubServerUrl, authType) (§1.1).
      const clash = list.find(
        (r) =>
          r.userId === rec.userId &&
          r.githubServerUrl === rec.githubServerUrl &&
          r.authType === rec.authType
      );
      if (clash) {
        throw new Error(
          `An integration for ${rec.githubServerUrl} (${rec.authType}) already exists for this user`
        );
      }
      list.push(rec);
    }
    atomicWrite(integrationsFile(), list);
  });
}

export async function updateIntegrationRecord(
  id: string,
  patch: Partial<GitHubIntegrationRecord>
): Promise<GitHubIntegrationRecord> {
  return withLock(async () => {
    const list = listIntegrationRecords();
    const rec = list.find((r) => r.id === id);
    if (!rec) throw new Error("Integration not found");
    Object.assign(rec, patch, { updatedAt: new Date().toISOString() });
    atomicWrite(integrationsFile(), list);
    return rec;
  });
}

/** Delete an integration AND cascade to its token + repository records (§1.1 / §6.2). */
export async function deleteIntegrationRecord(id: string): Promise<void> {
  return withLock(async () => {
    const integrations = listIntegrationRecords().filter((r) => r.id !== id);
    atomicWrite(integrationsFile(), integrations);

    const tokens = readArray<GitHubTokenRecord>(tokensFile()).filter((t) => t.integrationId !== id);
    atomicWrite(tokensFile(), tokens);

    const repos = readArray<GitHubRepositoryRecord>(reposFile()).filter(
      (r) => r.integrationId !== id
    );
    atomicWrite(reposFile(), repos);
  });
}

// ── Tokens ───────────────────────────────────────────────────────────────────

export function getTokenRecord(integrationId: string): GitHubTokenRecord | undefined {
  return readArray<GitHubTokenRecord>(tokensFile()).find((t) => t.integrationId === integrationId);
}

export async function saveTokenRecord(rec: GitHubTokenRecord): Promise<void> {
  return withLock(async () => {
    const list = readArray<GitHubTokenRecord>(tokensFile());
    const idx = list.findIndex((t) => t.integrationId === rec.integrationId);
    if (idx !== -1) list[idx] = rec;
    else list.push(rec);
    atomicWrite(tokensFile(), list);
  });
}

export async function deleteTokenRecord(integrationId: string): Promise<void> {
  return withLock(async () => {
    const list = readArray<GitHubTokenRecord>(tokensFile()).filter(
      (t) => t.integrationId !== integrationId
    );
    atomicWrite(tokensFile(), list);
  });
}

// ── Repositories ─────────────────────────────────────────────────────────────

export function listRepositoryRecords(integrationId?: string): GitHubRepositoryRecord[] {
  const all = readArray<GitHubRepositoryRecord>(reposFile());
  return integrationId ? all.filter((r) => r.integrationId === integrationId) : all;
}

export function getRepositoryRecord(id: string): GitHubRepositoryRecord | undefined {
  return readArray<GitHubRepositoryRecord>(reposFile()).find((r) => r.id === id);
}

export async function saveRepositoryRecord(rec: GitHubRepositoryRecord): Promise<void> {
  return withLock(async () => {
    const list = readArray<GitHubRepositoryRecord>(reposFile());
    const idx = list.findIndex((r) => r.id === rec.id);
    if (idx !== -1) list[idx] = rec;
    else {
      // fullName unique per integrationId (§1.1).
      const clash = list.find(
        (r) => r.integrationId === rec.integrationId && r.fullName === rec.fullName
      );
      if (clash) {
        throw new Error(`Repository ${rec.fullName} already registered for this integration`);
      }
      list.push(rec);
    }
    atomicWrite(reposFile(), list);
  });
}

export async function deleteRepositoryRecord(id: string): Promise<void> {
  return withLock(async () => {
    const list = readArray<GitHubRepositoryRecord>(reposFile()).filter((r) => r.id !== id);
    atomicWrite(reposFile(), list);
  });
}

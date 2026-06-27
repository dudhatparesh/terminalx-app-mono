// Bind a session's repo checkout to a GitHub integration (spec §5, §6.5).
//
// The PR-review routes need three things to talk to GitHub: the owner/repo to
// address, the default base branch, and an authenticated GitHubAPI client. None
// of that is reinvented here — we resolve owner/repo from the checkout's git
// remote, match it to a stored GitHubRepositoryRecord (data/github-repositories
// .json, owned by issue #7), and hand the record's integrationId to the shared
// GitHubAPI + token vault. Returns null when the repo isn't bound, which the
// route turns into the `pr:null` / "Connect this repo" payload (§10).
//
// SERVER-ONLY: uses child_process (git) + the JSON-file store.

import { execFileSync } from "child_process";
import { GitHubAPI } from "../github/api";
import { listRepositoryRecords } from "../github/store";
import { tokenVault } from "../github/token-vault";
import { getGitDirectoryInfo } from "../git-worktree";
import type { SessionMeta } from "../ai-sessions";

export interface RepoBinding {
  owner: string;
  repo: string;
  integrationId: string;
  /** Default base branch for Create-PR; falls back to the checkout's branch. */
  defaultBranch: string;
}

/** owner/name parsed from any common git remote URL form. */
export function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const url = remoteUrl.trim();
  // git@github.com:owner/repo.git  |  ssh://git@github.com/owner/repo.git
  // https://github.com/owner/repo(.git)  |  https://x-access-token:tok@github.com/owner/repo
  const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/) ?? null;
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  if (!owner || !repo) return null;
  return { owner, repo };
}

/** Read `origin` (or the first) remote URL for a checkout; null if none. */
function readRemoteUrl(repoRoot: string): string | null {
  try {
    const out = execFileSync("git", ["-C", repoRoot, "remote", "get-url", "origin"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the GitHub binding for a repo checkout. Matches the checkout's remote
 * owner/name against the registered repository records (§1.1, issue #7). Returns
 * null when the remote can't be parsed or no integration owns that repo.
 */
export async function resolveRepoBinding(repoRoot: string): Promise<RepoBinding | null> {
  const remote = readRemoteUrl(repoRoot);
  if (!remote) return null;
  const parsed = parseGitHubRemote(remote);
  if (!parsed) return null;

  const fullName = `${parsed.owner}/${parsed.repo}`.toLowerCase();
  const record = listRepositoryRecords().find((r) => r.fullName.toLowerCase() === fullName);
  if (!record) return null;

  const info = getGitDirectoryInfo(repoRoot);
  return {
    owner: record.owner,
    repo: record.name,
    integrationId: record.integrationId,
    defaultBranch: record.defaultBranch || info.branch || "main",
  };
}

/**
 * Resolve the git repo backing a session for the PR-review surface (spec §6.1).
 *
 * A session created with a Git worktree carries the repo root + branch in its
 * meta. A session merely *rooted* at a checkout (no worktree created) carries
 * only its `cwd`; we still derive the repo root + current branch from that
 * directory so the Review tab can render inline ("Connect this repo" / Create-PR)
 * instead of 404-ing. Returns null when the session has no git checkout at all.
 */
export function resolveSessionRepo(
  meta: SessionMeta | undefined
): { repoRoot: string; headBranch: string } | null {
  if (meta?.worktree) {
    return { repoRoot: meta.worktree.repoRoot, headBranch: meta.worktree.branch };
  }
  if (meta?.cwd) {
    const info = getGitDirectoryInfo(meta.cwd);
    if (info.isRepo && info.root) {
      return { repoRoot: info.root, headBranch: info.branch ?? "" };
    }
  }
  return null;
}

/**
 * Build the shared GitHubAPI client for a binding. The route NEVER instantiates
 * Octokit (or the client) by hand — token retrieval, retry/backoff, and rate
 * limiting are owned by GitHubAPI + the token vault (§6.5).
 */
export function getGitHubApiForRepo(binding: RepoBinding): GitHubAPI {
  return new GitHubAPI(binding.integrationId, tokenVault);
}

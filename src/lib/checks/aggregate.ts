// Server-side checks aggregation (checks-dashboard.spec.md §3.2). This is the ONLY
// place that talks to the GitHub client for the Checks tab. It adds NO new GitHub
// HTTP code — it composes CheckRunAPI / StatusAPI / PullRequestAPI from the GitHub
// integration layer (issue #7).
//
// SERVER-ONLY: imports child_process (via git-worktree) and the GitHub client.
// Never import this from a "use client" file — the route owns it.
import { execFileSync } from "child_process";
import { GitHubAPI } from "@/lib/github/api";
import { tokenVault } from "@/lib/github/token-vault";
import { integrationIdForRepo } from "./repo-binding";
import type { GitDirectoryInfo } from "@/lib/git-worktree";
import type { CheckRun, CommitStatus, PullRequest } from "@/lib/github/types";
import { CheckStatus } from "@/lib/github/types";
import type {
  ChecksCounts,
  ChecksItem,
  ChecksItemState,
  ChecksPr,
  ChecksRollup,
  ChecksView,
} from "@/types/checks";

const GIT_TIMEOUT_MS = 5000;

// ── Pure helpers (no I/O) — unit-tested directly ─────────────────────────────

/**
 * Parse owner/repo from a git `origin` remote URL. Returns null when the remote
 * is not a github.com (or GitHub Enterprise) HTTPS/SSH URL. Checks are GitHub-only
 * in v1 (§7); a non-GitHub remote yields a `no-repo` rollup upstream.
 */
export function parseGitHubRemote(remoteUrl: string): { owner: string; name: string } | null {
  const url = remoteUrl.trim();
  if (!url) return null;
  // git@github.com:owner/repo(.git)  |  ssh://git@github.com/owner/repo(.git)
  const ssh = url.match(/^(?:ssh:\/\/)?git@([^/:]+)[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (ssh) {
    const [, host, owner, name] = ssh;
    if (!host || !owner || !name || !/github/i.test(host)) return null;
    return { owner, name };
  }
  // https://github.com/owner/repo(.git)  |  http(s)://host/owner/repo
  const https = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (https) {
    const [, host, owner, name] = https;
    if (!host || !owner || !name || !/github/i.test(host)) return null;
    return { owner, name };
  }
  return null;
}

/** Map a CheckRun (raw status+conclusion) to a row state (§2.3). */
export function checkRunState(run: CheckRun): ChecksItemState {
  if (run.status !== CheckStatus.COMPLETED) return "pending";
  switch (run.conclusion) {
    case "success":
      return "success";
    case "neutral":
      return "neutral";
    case "skipped":
      return "skipped";
    case "failure":
    case "timed_out":
    case "action_required":
    case "cancelled":
      return "failure";
    default:
      return "pending";
  }
}

/** Map a legacy commit-status state to a row state (§2.3). */
export function commitStatusState(state: CommitStatus["state"]): ChecksItemState {
  switch (state) {
    case "success":
      return "success";
    case "pending":
      return "pending";
    case "failure":
    case "error":
      return "failure";
    default:
      return "pending";
  }
}

function checkRunSource(run: CheckRun): string {
  return run.app?.name ?? "GitHub Actions";
}

function durationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const s = Date.parse(startedAt);
  const e = Date.parse(completedAt);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  return e - s;
}

function checkRunToItem(run: CheckRun): ChecksItem {
  return {
    id: `check-run:${run.id}`,
    kind: "check-run",
    name: run.name,
    state: checkRunState(run),
    rawStatus: run.status,
    rawConclusion: run.conclusion,
    source: checkRunSource(run),
    detailsUrl: run.html_url ?? null,
    summary: run.output?.title ?? null,
    startedAt: run.started_at ?? null,
    completedAt: run.completed_at ?? null,
    durationMs: durationMs(run.started_at ?? null, run.completed_at ?? null),
  };
}

function statusToItem(status: CommitStatus, idx: number): ChecksItem {
  return {
    id: `status:${status.context}:${idx}`,
    kind: "status",
    name: status.context,
    state: commitStatusState(status.state),
    rawStatus: "status",
    rawConclusion: status.state,
    source: "Commit status",
    detailsUrl: status.target_url ?? status.url ?? null,
    summary: status.description ?? null,
    startedAt: status.created_at ?? null,
    completedAt: null,
    durationMs: null,
  };
}

/**
 * Merge check-runs + legacy commit statuses into normalized rows, de-duping by
 * name (a check-run wins over a legacy status of the same name, §2.3).
 */
export function normalizeItems(runs: CheckRun[], statuses: CommitStatus[]): ChecksItem[] {
  const byName = new Map<string, ChecksItem>();
  // Statuses first (oldest-wins per context already handled by GitHub ordering),
  // then check-runs overwrite same-named entries.
  statuses.forEach((s, i) => {
    const existing = byName.get(s.context);
    // Prefer the latest status per context (statuses come newest-first from GitHub).
    if (!existing) byName.set(s.context, statusToItem(s, i));
  });
  for (const r of runs) byName.set(r.name, checkRunToItem(r));
  return [...byName.values()];
}

export function countStates(items: ChecksItem[]): ChecksCounts {
  const counts: ChecksCounts = { success: 0, failure: 0, pending: 0, neutral: 0, skipped: 0 };
  for (const it of items) counts[it.state] += 1;
  return counts;
}

/**
 * Roll up item states into the data rollup (§2.3 precedence among real checks:
 * failure > pending > success; empty => none).
 */
export function rollupFromCounts(counts: ChecksCounts, total: number): ChecksRollup {
  if (total === 0) return "none";
  if (counts.failure > 0) return "failure";
  if (counts.pending > 0) return "pending";
  return "success";
}

export function prToChecksPr(pr: PullRequest): ChecksPr {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    isDraft: Boolean(pr.draft),
    merged: Boolean(pr.merged_at || pr.merged),
    htmlUrl: pr.html_url,
  };
}

/** Build an informational empty view (no-repo / no-pr / none / error). */
export function emptyView(
  sessionName: string,
  rollup: ChecksRollup,
  reason?: string,
  partial?: Partial<ChecksView>
): ChecksView {
  const now = new Date();
  return {
    sessionName,
    repo: null,
    branch: null,
    headSha: null,
    pr: null,
    rollup,
    counts: { success: 0, failure: 0, pending: 0, neutral: 0, skipped: 0 },
    items: [],
    reason,
    fetchedAt: now.toISOString(),
    cached: false,
    stale: false,
    cachedUntil: new Date(now.getTime() + SOFT_TTL_MS).toISOString(),
    ...partial,
  };
}

// SOFT_TTL_MS duplicated here to avoid a cache import cycle for the pure path.
const SOFT_TTL_MS = 30_000;

// ── I/O helpers (server-only) ────────────────────────────────────────────────

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

function originRemoteUrl(repoRoot: string): string | null {
  try {
    return git(["-C", repoRoot, "remote", "get-url", "origin"]) || null;
  } catch {
    return null;
  }
}

function localHeadSha(repoRoot: string): string | null {
  try {
    return git(["-C", repoRoot, "rev-parse", "HEAD"]) || null;
  } catch {
    return null;
  }
}

/**
 * Whether a GitHub token is configured for the repo at `repoRoot`. A repo is
 * bound to an integration via the GitHubRepositoryRecord (owner/name → integrationId);
 * presence of an enabled integration credential is the signal. No HTTP — reads the
 * vault store the GitHub client already owns (§3.3).
 */
export function hasGitHubToken(repoRoot: string): boolean {
  const remote = originRemoteUrl(repoRoot);
  if (!remote) return false;
  const parsed = parseGitHubRemote(remote);
  if (!parsed) return false;
  return integrationIdForRepo(parsed.owner, parsed.name) !== null;
}

export interface BuildChecksViewArgs {
  sessionName: string;
  gitInfo: GitDirectoryInfo;
}

/**
 * Build the full ChecksView for a session by resolving repo/branch/PR/head-SHA and
 * aggregating check-runs + commit statuses (§3.2). Throws GitHub client errors so
 * the route can map them to 429/502 + stale cache.
 */
export async function buildChecksView({
  sessionName,
  gitInfo,
}: BuildChecksViewArgs): Promise<ChecksView> {
  const repoRoot = gitInfo.root!;
  const branch = gitInfo.branch ?? null;

  const remote = originRemoteUrl(repoRoot);
  const parsed = remote ? parseGitHubRemote(remote) : null;
  if (!parsed) {
    return emptyView(sessionName, "no-repo", "No GitHub remote", { branch });
  }
  const { owner, name } = parsed;

  const integrationId = integrationIdForRepo(owner, name);
  if (!integrationId) {
    return emptyView(sessionName, "error", "no-auth", {
      repo: { owner, name },
      branch,
    });
  }

  const api = new GitHubAPI(integrationId, tokenVault);

  // Resolve the PR (newest match for owner:branch, any state) and the head SHA.
  let pr: PullRequest | null = null;
  if (branch) {
    const prs = await api.pulls.listPullRequests(owner, name, {
      head: `${owner}:${branch}`,
      state: "all",
      sort: "created",
      direction: "desc",
    });
    const open = prs.find((p) => p.state === "open");
    pr =
      open ??
      [...prs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ??
      null;
  }

  const headSha = pr?.head.sha ?? localHeadSha(repoRoot);
  const fetchedAt = new Date();

  if (!headSha) {
    return emptyView(sessionName, pr ? "none" : "no-pr", pr ? undefined : "No resolvable HEAD", {
      repo: { owner, name },
      branch,
      pr: pr ? prToChecksPr(pr) : null,
    });
  }

  const [runs, statuses] = await Promise.all([
    api.checks.listCheckRuns(owner, name, headSha),
    api.status.listStatuses(owner, name, headSha),
  ]);

  const items = normalizeItems(runs, statuses);
  const counts = countStates(items);
  const rollup = rollupFromCounts(counts, items.length);

  return {
    sessionName,
    repo: { owner, name },
    branch,
    headSha,
    pr: pr ? prToChecksPr(pr) : null,
    rollup,
    counts,
    items,
    reason: items.length === 0 ? "No checks reported for this commit" : undefined,
    fetchedAt: fetchedAt.toISOString(),
    cached: false,
    stale: false,
    cachedUntil: new Date(fetchedAt.getTime() + SOFT_TTL_MS).toISOString(),
  };
}

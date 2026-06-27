// Pure projection/normalization helpers shared by the UI tabs (§2.3a, §2.4, §2.5)
// and the retry policy (§3.3). No I/O — trivially unit-testable.
import {
  CheckConclusion,
  CheckRun,
  CheckState,
  CheckStatus,
  ChecksOverall,
  ChecksSummary,
  CommitStatus,
  GitHubAPIError,
  GitHubErrorCode,
  NormalizedCheck,
  PullRequest,
  PullRequestStatus,
  PullRequestView,
  Review,
  ReviewComment,
  ReviewDecision,
  ReviewSummary,
  ReviewThread,
} from "./types";

// ── §2.3a Derived PR status ─────────────────────────────────────────────────

/**
 * Derive the single UI status pill from a raw GitHub PullRequest.
 * Order matters: merged wins over closed; draft only applies to still-open PRs.
 */
export function derivePullRequestStatus(pr: PullRequest): PullRequestStatus {
  if (pr.merged_at || pr.merged) return "merged"; // merged PRs are also state:'closed'
  if (pr.state === "closed") return "closed";
  if (pr.draft) return "draft";
  return "open";
}

/** Pill presentation hints (actual colors/tokens owned by the UI specs). */
export const PR_STATUS_PILL: Record<
  PullRequestStatus,
  { label: string; tone: "success" | "neutral" | "muted" | "danger" }
> = {
  merged: { label: "Merged", tone: "success" },
  open: { label: "Open", tone: "success" },
  draft: { label: "Draft", tone: "muted" },
  closed: { label: "Closed", tone: "danger" },
};

/** Project a raw PullRequest into the UI-facing PullRequestView (§2.3). */
export function toPullRequestView(pr: PullRequest): PullRequestView {
  return {
    number: pr.number,
    htmlUrl: pr.html_url,
    title: pr.title,
    status: derivePullRequestStatus(pr),
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    baseBranch: pr.base.ref,
    changedFiles: pr.changed_files,
    additions: pr.additions,
    deletions: pr.deletions,
  };
}

// ── §2.4 Checks normalization ────────────────────────────────────────────────

/**
 * Normalize a CheckRun's status+conclusion into a row CheckState.
 * (cancelled/action_required fold INTO failure; raw conclusion is preserved by
 *  the caller in NormalizedCheck.rawConclusion for tooltips.)
 */
export function normalizeCheckRunState(run: CheckRun): CheckState {
  if (run.status !== CheckStatus.COMPLETED) return "pending";
  switch (run.conclusion) {
    case CheckConclusion.SUCCESS:
      return "success";
    case CheckConclusion.NEUTRAL:
      return "neutral";
    case CheckConclusion.SKIPPED:
      return "skipped";
    case CheckConclusion.FAILURE:
    case CheckConclusion.TIMED_OUT:
    case CheckConclusion.ACTION_REQUIRED:
    case CheckConclusion.CANCELLED:
      return "failure";
    default:
      return "pending";
  }
}

/** Normalize a legacy commit status's state into a row CheckState. */
export function normalizeStatusState(status: CommitStatus["state"]): CheckState {
  switch (status) {
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

export function normalizeCheckRun(run: CheckRun): NormalizedCheck {
  return {
    source: "check_run",
    name: run.name,
    state: normalizeCheckRunState(run),
    rawConclusion: run.conclusion,
    detailsUrl: run.html_url,
    description: run.output?.title,
    startedAt: run.started_at,
    completedAt: run.completed_at ?? undefined,
  };
}

export function normalizeStatus(status: CommitStatus): NormalizedCheck {
  return {
    source: "status",
    name: status.context,
    state: normalizeStatusState(status.state),
    detailsUrl: status.target_url,
    description: status.description,
  };
}

/**
 * Merge normalized check runs + commit statuses into a single ChecksSummary,
 * de-duping by name (a check run wins over a legacy status of the same name).
 * Worst-case rollup: failure > pending > success.
 */
export function buildChecksSummary(
  headSha: string,
  runs: CheckRun[],
  statuses: CommitStatus[]
): ChecksSummary {
  const byName = new Map<string, NormalizedCheck>();
  for (const s of statuses) byName.set(s.context, normalizeStatus(s));
  for (const r of runs) byName.set(r.name, normalizeCheckRun(r)); // check runs win

  const checks = [...byName.values()];
  let passing = 0;
  let failing = 0;
  let pending = 0;
  for (const c of checks) {
    if (c.state === "failure") failing++;
    else if (c.state === "pending") pending++;
    else passing++; // success / neutral / skipped count as passing for the rollup
  }

  let overall: ChecksOverall;
  if (checks.length === 0) overall = "none";
  else if (failing > 0) overall = "failure";
  else if (pending > 0) overall = "pending";
  else overall = "success";

  return {
    headSha,
    total: checks.length,
    passing,
    failing,
    pending,
    overall,
    reason: checks.length === 0 ? "No checks reported for this commit" : undefined,
    checks,
  };
}

// ── §2.5 Review decision rollup ──────────────────────────────────────────────

/**
 * Roll up the overall review decision from per-reviewer reviews — the latest
 * non-pending review per user wins. CHANGES_REQUESTED dominates; otherwise an
 * APPROVED makes it "approved"; an empty/pending set is "review_required".
 */
export function deriveReviewDecision(reviews: Review[]): ReviewDecision {
  const latestByUser = new Map<number, Review>();
  for (const r of reviews) {
    if (r.state === "PENDING" || r.state === "DISMISSED") continue;
    const prev = latestByUser.get(r.user.id);
    const ts = r.submitted_at ? Date.parse(r.submitted_at) : 0;
    const prevTs = prev?.submitted_at ? Date.parse(prev.submitted_at) : -1;
    if (!prev || ts >= prevTs) latestByUser.set(r.user.id, r);
  }
  const states = [...latestByUser.values()].map((r) => r.state);
  if (states.includes("CHANGES_REQUESTED")) return "changes_requested";
  if (states.includes("APPROVED")) return "approved";
  if (states.length === 0) return "review_required";
  return "pending";
}

/** Group line-anchored review comments into threads keyed by (path,line,side). */
export function buildReviewThreads(comments: ReviewComment[]): ReviewThread[] {
  // Index comments by id so replies can find their root.
  const byId = new Map<number, ReviewComment>();
  for (const c of comments) byId.set(c.id, c);

  const rootKey = (c: ReviewComment): string => {
    let root = c;
    const seen = new Set<number>();
    while (root.in_reply_to_id != null && byId.has(root.in_reply_to_id)) {
      if (seen.has(root.id)) break; // guard against cycles
      seen.add(root.id);
      root = byId.get(root.in_reply_to_id)!;
    }
    return `${root.path}::${root.line ?? "null"}::${root.side}`;
  };

  const groups = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    const key = rootKey(c);
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  const threads: ReviewThread[] = [];
  for (const arr of groups.values()) {
    const ordered = [...arr].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const head = ordered[0];
    if (!head) continue;
    threads.push({
      path: head.path,
      line: head.line,
      side: head.side,
      resolved: false, // GitHub REST omits resolution; TerminalX tracks it elsewhere.
      comments: ordered,
    });
  }
  return threads;
}

export function buildReviewSummary(
  prNumber: number,
  reviews: Review[],
  comments: ReviewComment[]
): ReviewSummary {
  return {
    prNumber,
    decision: deriveReviewDecision(reviews),
    reviews,
    threads: buildReviewThreads(comments),
  };
}

// ── §3.3 Retry strategy ──────────────────────────────────────────────────────

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitterFraction: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 2000,
  maxDelayMs: 120000,
  multiplier: 2,
  jitterFraction: 0.2,
};

const TRANSIENT_ERRORS = [
  GitHubErrorCode.RATE_LIMIT_EXCEEDED,
  GitHubErrorCode.SECONDARY_RATE_LIMIT,
  GitHubErrorCode.SERVICE_UNAVAILABLE,
  GitHubErrorCode.SERVER_ERROR,
  GitHubErrorCode.TIMEOUT,
  GitHubErrorCode.NETWORK_ERROR,
];

const NON_RETRYABLE_ERRORS = [
  GitHubErrorCode.AUTHENTICATION_FAILED,
  GitHubErrorCode.TOKEN_EXPIRED,
  GitHubErrorCode.TOKEN_REVOKED,
  GitHubErrorCode.VALIDATION_ERROR,
  GitHubErrorCode.NOT_FOUND,
  GitHubErrorCode.FORBIDDEN,
];

export function shouldRetry(
  error: Pick<GitHubAPIError, "code">,
  attemptNumber: number,
  maxAttempts = 3
): boolean {
  if (NON_RETRYABLE_ERRORS.includes(error.code)) return false;
  if (!TRANSIENT_ERRORS.includes(error.code)) return false;
  if (attemptNumber >= maxAttempts) return false;
  return true;
}

/** Exponential backoff with ±jitter, capped at policy.maxDelayMs. */
export function calculateBackoff(attemptNumber: number, policy: RetryPolicy): number {
  const base = policy.initialDelayMs * Math.pow(policy.multiplier, attemptNumber - 1);
  const maxed = Math.min(base, policy.maxDelayMs);
  const jitter = maxed * policy.jitterFraction * (Math.random() * 2 - 1);
  return Math.max(0, maxed + jitter);
}

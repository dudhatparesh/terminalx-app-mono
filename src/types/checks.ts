// Checks tab view model (issue #6 — checks-dashboard.spec.md §2.2).
// TYPES ONLY — no runtime, no Node imports — so the client tab/hook and the
// server aggregation/route can both import these shapes safely.
//
// Low-level GitHub types (CheckRun / CheckStatus / CheckConclusion / PullRequest)
// are OWNED by the GitHub integration layer (src/lib/github/types.ts) and imported
// where needed; they are NOT redefined here.

/**
 * Normalized roll-up state used for the tab badge and the per-check rows.
 * Stays in sync with `ChecksOverall` in github-integration (same 7 members).
 * "no GitHub token configured" is folded into `error` (reason "no-auth") rather
 * than a new union member, so the two specs keep one vocabulary.
 */
export type ChecksRollup =
  | "success" // every required check passed (or neutral/skipped)
  | "failure" // at least one check failed / timed_out / action_required
  | "pending" // at least one check queued/in_progress, none failed
  | "none" // no checks reported for the head SHA
  | "error" // could not fetch (no token / rate-limit / network)
  | "no-repo" // session dir is not a git repo / no GitHub remote
  | "no-pr"; // repo+branch known, but no associated PR

/** Row-level normalized state — matches CheckState in github-integration. */
export type ChecksItemState = "success" | "failure" | "pending" | "neutral" | "skipped";

/** One normalized row in the Checks tab (a check-run OR a legacy commit status). */
export interface ChecksItem {
  /** Stable key: `${kind}:${id}`. */
  id: string;
  kind: "check-run" | "status";
  /** e.g. "build", "lint / node-20", "ci/circleci: test". */
  name: string;
  state: ChecksItemState;
  /** GitHub's raw conclusion/status when available, for tooltips. */
  rawStatus: string;
  rawConclusion: string | null;
  /** App/source that produced the check, e.g. "GitHub Actions", "CircleCI". */
  source: string;
  /** Deep link to the run/log (check_run.html_url or commit-status url). */
  detailsUrl: string | null;
  /** Short summary line (check_run.output.title or status.description). */
  summary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** ms; null while pending. */
  durationMs: number | null;
}

export interface ChecksCounts {
  success: number;
  failure: number;
  pending: number;
  neutral: number;
  skipped: number;
}

export interface ChecksPr {
  number: number;
  title: string;
  state: "open" | "closed";
  isDraft: boolean;
  merged: boolean;
  htmlUrl: string;
}

/** The full payload the Checks tab renders. */
export interface ChecksView {
  sessionName: string;
  repo: { owner: string; name: string } | null;
  branch: string | null;
  /** SHA the checks were evaluated against (PR head, else local HEAD). */
  headSha: string | null;
  pr: ChecksPr | null;
  rollup: ChecksRollup;
  counts: ChecksCounts;
  items: ChecksItem[];
  /**
   * Why rollup is "error"/"none"/etc. Stable discriminators the client switches
   * on for tailored copy — e.g. "no-auth", "rate-limited", "upstream".
   */
  reason?: string;
  /** Cache + freshness metadata. */
  fetchedAt: string; // ISO; when the underlying GitHub calls ran
  cached: boolean;
  stale: boolean; // served from cache past soft-TTL while revalidating
  cachedUntil: string; // ISO; hard expiry of the cached entry
}

/** Machine-readable error codes the client switches on (route envelope, §3.1). */
export type ChecksErrorCode = "INVALID_REQUEST" | "FORBIDDEN" | "RATE_LIMITED" | "UPSTREAM_ERROR";

/** Success envelope returned by GET /api/checks. */
export interface ChecksSuccessEnvelope {
  status: "success";
  data: ChecksView;
}

/** Error envelope returned by GET /api/checks (genuine request failures). */
export interface ChecksErrorEnvelope {
  status: "error";
  code: ChecksErrorCode;
  message?: string;
  retryAfter?: number;
  cached?: boolean;
  data?: ChecksView;
}

export type ChecksEnvelope = ChecksSuccessEnvelope | ChecksErrorEnvelope;

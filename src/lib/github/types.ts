// Shared type surface for the GitHub integration layer (issue #7).
// Mirrors github-integration.spec.md. Types only — no runtime — so both server
// code and the (client) settings UI can import the shapes without pulling in fs/crypto.

// ── §2.1 Errors ──────────────────────────────────────────────────────────────

// The set of error CODES. Kept separate from the thrown-object interface so the
// two names can't collide (spec §2.1).
export enum GitHubErrorCode {
  AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED", // 401
  FORBIDDEN = "FORBIDDEN", // 403
  NOT_FOUND = "NOT_FOUND", // 404
  VALIDATION_ERROR = "VALIDATION_ERROR", // 422

  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED", // 403 + X-RateLimit-Remaining: 0
  SECONDARY_RATE_LIMIT = "SECONDARY_RATE_LIMIT", // 403 (abuse detection)

  SERVER_ERROR = "SERVER_ERROR", // 500
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE", // 503

  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT = "TIMEOUT",

  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  TOKEN_REVOKED = "TOKEN_REVOKED",
  WEBHOOK_VALIDATION_FAILED = "WEBHOOK_VALIDATION_FAILED",
  CONFIGURATION_ERROR = "CONFIGURATION_ERROR",
}

// The thrown-error object. Its `code` is one of GitHubErrorCode.
export interface GitHubAPIError {
  code: GitHubErrorCode;
  message: string;
  statusCode: number;
  rateLimitReset?: Date;
  retryAfter?: number; // seconds
  requestId?: string; // GitHub's X-GitHub-Request-Id
  documentation?: string; // GitHub API docs URL
}

// ── §4.1 Error categories ────────────────────────────────────────────────────

export enum ErrorCategory {
  AUTHENTICATION = "AUTHENTICATION",
  AUTHORIZATION = "AUTHORIZATION",
  VALIDATION = "VALIDATION",
  NOT_FOUND = "NOT_FOUND",
  RATE_LIMITED = "RATE_LIMITED",
  ABUSE_DETECTED = "ABUSE_DETECTED",
  SERVER_ERROR = "SERVER_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  TIMEOUT = "TIMEOUT",
  NETWORK_ERROR = "NETWORK_ERROR",
  TOKEN_ERROR = "TOKEN_ERROR",
  CONFIGURATION = "CONFIGURATION",
  UNKNOWN = "UNKNOWN",
}

// ── §1.1 Storage records ─────────────────────────────────────────────────────

/** data/github-integrations.json — one per (userId, githubServerUrl, authType). */
export interface GitHubIntegrationRecord {
  id: string; // UUID, primary key within the JSON array
  userId: string; // == User.id from data/users.json (NOT a SQL FK)
  displayName: string;
  githubServerUrl: string;
  authType: "PAT" | "GITHUB_APP";

  enabled: boolean;
  createdAt: string; // ISO timestamp
  updatedAt: string;
  lastUsedAt?: string;

  rateLimitRemaining?: number;
  rateLimitResetAt?: string;

  userAgent?: string;
  ipAddress?: string;
}

/** data/github-tokens.json — encrypted material, kept separate from metadata. */
export interface GitHubTokenRecord {
  integrationId: string; // == GitHubIntegrationRecord.id
  tokenCiphertext: string; // AES-256-GCM encrypted (base64)
  tokenNonce: string; // IV/nonce for decryption (base64)
  tokenSalt: string; // Salt used in KDF (base64)
  tokenTag?: string; // GCM auth tag (base64)
  tokenType: "bearer" | "app-jwt";

  patScopes?: string[];

  appId?: string;
  installationId?: string;
  appPrivateKeyCiphertext?: string;

  rotationScheduledAt?: string;
  lastRotatedAt?: string;
}

/** data/github-repositories.json — runtime cache of .terminalx/settings.toml (§6.1). */
export interface GitHubRepositoryRecord {
  id: string; // UUID
  integrationId: string; // == GitHubIntegrationRecord.id
  owner: string;
  name: string;
  fullName: string; // owner/name; unique per integrationId (enforced in code)

  webhookSecret?: string; // HMAC-SHA256 secret (encrypted)
  webhookId?: string;
  webhookUrl?: string;
  webhookEvents?: WebhookEvent[];

  defaultBranch: string;
  isPrivate?: boolean;
  archived: boolean;

  createdAt: string;
  updatedAt: string;
}

// ── §1.2 Token configs ───────────────────────────────────────────────────────

export interface PATTokenConfig {
  token: string;
  scopes?: string[];
  expiresAt?: Date;
  notes?: string;
}

export interface GitHubAppConfig {
  appId: string;
  appName?: string;
  privateKey: string;
  installationId: string;
  webhookSecret?: string;
}

// ── §2.2 Repository ──────────────────────────────────────────────────────────

export interface Repository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; type: "User" | "Organization" };
  description: string;
  url: string;
  html_url: string;
  private: boolean;
  default_branch: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

export interface Branch {
  name: string;
  commit: { sha: string; url: string };
  protected: boolean;
}

export interface BranchProtection {
  required_status_checks?: { strict: boolean; contexts: string[] } | null;
  enforce_admins?: { enabled: boolean };
  required_pull_request_reviews?: { required_approving_review_count?: number } | null;
}

export interface Commit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
  };
  author: User | null;
  html_url: string;
}

// ── §2.3 Pull Requests ───────────────────────────────────────────────────────

export interface User {
  login: string;
  id: number;
  avatar_url: string;
  url: string;
  type: "User" | "Bot";
}

export interface Label {
  id: number;
  name: string;
  color: string;
  description: string;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed"; // RAW GitHub state. NOT the UI pill; see §2.3a.
  draft: boolean;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  merged?: boolean;
  merged_by?: User | null;
  closed_at: string | null;

  mergeable?: boolean | null;
  mergeable_state?: "clean" | "dirty" | "blocked" | "unstable" | "behind" | "unknown";

  head: { ref: string; sha: string; repo: Repository | null };
  base: { ref: string; sha: string; repo: Repository };

  user: User;
  assignees: User[];
  requested_reviewers: User[];
  labels: Label[];

  comments: number;
  review_comments: number;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;

  html_url: string;
  statuses_url?: string;
  url: string;
}

export interface Comment {
  id: number;
  url: string;
  html_url: string;
  body: string;
  user: User;
  created_at: string;
  updated_at: string;
  in_reply_to_id?: number;
}

// ── §2.3a Derived PR status ─────────────────────────────────────────────────

export type PullRequestStatus = "merged" | "open" | "draft" | "closed";

/**
 * UI-facing PR view — the shape the review-panel status bar (§0.1) renders.
 * Produced by toPullRequestView().
 */
export interface PullRequestView {
  number: number;
  htmlUrl: string;
  title: string;
  status: PullRequestStatus;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  changedFiles: number;
  additions: number;
  deletions: number;
}

/** Shared props for the status-bar PR pill+link (§2.3a). Single source of truth. */
export type ReviewStatusBarPr = Pick<PullRequestView, "number" | "htmlUrl" | "status">;

// ── §2.4 Checks & Statuses ───────────────────────────────────────────────────

export enum CheckStatus {
  QUEUED = "queued",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
}

export enum CheckConclusion {
  SUCCESS = "success",
  FAILURE = "failure",
  NEUTRAL = "neutral",
  CANCELLED = "cancelled",
  TIMED_OUT = "timed_out",
  ACTION_REQUIRED = "action_required",
  SKIPPED = "skipped",
}

export interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  start_column?: number;
  end_column?: number;
  annotation_level: "notice" | "warning" | "failure";
  message: string;
  title?: string;
  raw_details?: string;
}

export interface CheckRun {
  id: number;
  name: string;
  head_sha: string;
  status: CheckStatus;
  conclusion: CheckConclusion | null;
  started_at: string;
  completed_at: string | null;
  output?: {
    title: string;
    summary: string;
    text?: string;
    annotations?: CheckAnnotation[];
  };
  html_url: string;
  app?: { id: number; name: string };
}

export interface CommitStatus {
  state: "pending" | "success" | "failure" | "error";
  description: string;
  context: string;
  created_at: string;
  url: string;
  target_url?: string;
}

/** Row-level check state — MUST match checks-dashboard's ChecksItem.state. */
export type CheckState = "success" | "failure" | "pending" | "neutral" | "skipped";

export interface NormalizedCheck {
  source: "check_run" | "status";
  name: string;
  state: CheckState;
  rawConclusion?: CheckConclusion | null;
  detailsUrl?: string;
  description?: string;
  startedAt?: string;
  completedAt?: string;
}

export type ChecksOverall =
  | "success"
  | "failure"
  | "pending"
  | "none"
  | "error"
  | "no-repo"
  | "no-pr";

export interface ChecksSummary {
  headSha: string;
  total: number;
  passing: number;
  failing: number;
  pending: number;
  overall: ChecksOverall;
  reason?: string;
  checks: NormalizedCheck[];
}

// ── §2.5 Reviews ─────────────────────────────────────────────────────────────

export interface Review {
  id: number;
  user: User;
  body: string;
  state: "PENDING" | "COMMENTED" | "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED";
  submitted_at: string | null;
  commit_id: string;
  html_url: string;
}

export interface ReviewComment {
  id: number;
  pull_request_review_id: number | null;
  user: User;
  body: string;
  path: string;
  line: number | null;
  original_line: number | null;
  start_line: number | null;
  side: "LEFT" | "RIGHT";
  commit_id: string;
  diff_hunk: string;
  in_reply_to_id: number | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export type ReviewDecision = "approved" | "changes_requested" | "review_required" | "pending";

export interface ReviewThread {
  path: string;
  line: number | null;
  side: "LEFT" | "RIGHT";
  resolved: boolean;
  comments: ReviewComment[];
}

export interface ReviewSummary {
  prNumber: number;
  decision: ReviewDecision;
  reviews: Review[];
  threads: ReviewThread[];
}

// ── §5.1 Webhooks ────────────────────────────────────────────────────────────

export enum WebhookEvent {
  PUSH = "push",
  PULL_REQUEST = "pull_request",
  PULL_REQUEST_REVIEW = "pull_request_review",
  PULL_REQUEST_REVIEW_COMMENT = "pull_request_review_comment",
  CHECK_RUN = "check_run",
  CHECK_SUITE = "check_suite",
  ISSUE_COMMENT = "issue_comment",
}

export interface WebhookConfig {
  url: string;
  events: WebhookEvent[];
  active: boolean;
  secret: string;
  insecureSSL?: boolean;
}

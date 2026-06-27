# GitHub Integration Layer Specification

**TerminalX GitHub Integration**  
_Version: 1.1_  
_Date: 2026-06-25_  
_Backs GitHub issue: #7_

This is the **backend / data-layer** spec for GitHub. It is the source of truth for the
data contracts consumed by `diff-viewer.spec.md` and `checks-dashboard.spec.md`, which cite
this spec. The UI shapes here MUST agree with what those two specs render.

> **GitHub client strategy — two parallel approaches exist; this must be reconciled.**
> This spec hand-rolls a `GitHubAPIClient` (§2) over `fetch` and exposes higher-level
> aggregates (`ReviewAPI`/`ReviewSummary`/`ReviewThread`/`ReviewDecision`, `ChecksSummary`,
> `PullRequestView`). The `pr-review/` specs, by contrast, call **Octokit directly**
> (`@octokit/rest` — note: NOT currently a dependency in `package.json`) via
> `octokit.pulls.createReviewComment` / `octokit.pulls.createReplyForReviewComment`, and
> define their own `ReviewState`/`StoredReviewState`; they do **not** consume any type from
> this spec. So `pr-review/` is **a parallel/alternative implementation, not a consumer of
> this spec.** Before build, the integration must pick ONE client strategy (either migrate
> `pr-review/` onto this spec's `ReviewAggregateAPI`/`ReviewAPI` and drop its direct Octokit
> use, or adopt Octokit here and add it to `package.json`). The §2.5 aggregates below are
> written for the first option.

---

## 0. Conductor UI reference (from screenshots)

The TerminalX review surface mirrors Conductor's. These facts are extracted from the
authoritative Conductor screenshots and constrain the data this integration layer must
expose. **Conductor analog → TerminalX analog** is noted where naming differs.

### 0.1 The review surface is ONE panel with tabs

The diff viewer, checks dashboard, PR review and archive are **facets of a single
right-hand panel** attached to a session — not separate screens. Their specs must agree on
this surface. The panel has:

- **Top status bar:**
  - **`#n ↗`** — the PR link. `n` is the PR `number`; the `↗` opens `html_url` externally.
    (Conductor renders e.g. `#1 ↗`.) When the session's branch has **no** PR yet, this
    slot shows a "Create PR" affordance instead of a number.
  - **A status pill** — one of `Merged` / `Open` / `Draft` / `Closed`. This is a single
    **derived** UI state (see §2.3a), NOT the raw GitHub `state` field.
  - **`Continue`** button — resume the attached session.
  - **`Archive`** button — archive the session/workspace (prominent).
- **Tabs:** `All files` · `Changes` (with a count badge, e.g. `1`) · `Checks` · `Review` (eye icon).
  - `All files` / `Changes` are backed by the diff data (`diff-viewer.spec.md`).
  - `Checks` is backed by **check runs + commit statuses** (§2.4, consumed by
    `checks-dashboard.spec.md`).
  - `Review` is backed by **reviews + review comments** (§2.5). The `pr-review/` specs
    currently render this tab via direct Octokit calls, not via §2.5 — see the client-strategy
    note in the header; §2.5 is the proposed shared contract if `pr-review/` is migrated.
- **File rows:** path with the filename emphasized (e.g. `.conductor/settings.toml` →
  TerminalX: `.terminalx/settings.toml`), an added-lines count (e.g. `+19`), and a small
  file/status icon.

### 0.2 Settings scope: User vs Repo

Conductor splits settings into **User** and **Repo** scope tabs. Repo-scoped config is a
**committed TOML file** (`.conductor/settings.toml`) edited via a top-right
**"Edit settings.toml"** button.

- **TerminalX analog:** repo-scoped GitHub config (which integration a repo is bound to,
  webhook events, default base branch) lives in a committed `.terminalx/settings.toml`
  with an "Edit" affordance. **User-scoped** config (a user's tokens / integrations) lives
  in the JSON-file store under `data/` (`data/github-integrations.json` /
  `data/github-tokens.json`, §1.1) and never in the committed file. The
  `GitHubRepositoryRecord` (`data/github-repositories.json`, §1.1) is the runtime cache of
  what `.terminalx/settings.toml` declares for a repo.

### 0.3 Per-workspace injected port

Conductor injects a per-workspace `CONDUCTOR_PORT` so preview/run servers don't collide.
**TerminalX analog:** `TERMINALX_PORT` (per-worktree). Not owned by this spec, but PR
creation/links must tolerate that each session runs in its own worktree
(`SessionMeta.worktree`, see §2.7).

### 0.4 What this implies for the data layer

- Every PR object the UI consumes needs a **derived status pill value** and a **stable
  `#n` + `html_url`** pair (§2.3 / §2.3a).
- The `Checks` tab needs check runs **and** legacy commit statuses keyed by head SHA (§2.4).
- The `Review` tab needs reviews **and** line-anchored review comments (§2.5).
- Naming: use TerminalX names (`TERMINALX_*`, `.terminalx/`) for all new artifacts; the
  Conductor analog is noted, never copied verbatim.

---

## 1. Authentication & Token Management

### 1.1 Token Storage Architecture

#### Storage model: JSON files (NOT SQL)

TerminalX has **no SQL/relational database and no ORM** (verified: no
sqlite/better-sqlite3/prisma/drizzle/pg/postgres/mysql/knex/typeorm/sequelize in
`package.json`). All persistence is **JSON files under `data/`** with atomic writes +
in-process write locks — the established pattern in `src/lib/users.ts`
(`data/users.json`), `src/lib/ai-sessions.ts` (`data/ai-sessions.json`), snippets, and
recordings. This feature MUST follow that same pattern rather than introduce a database.

Each store is a JSON array persisted via `withLock` + an `atomicWrite` helper (write to a
temp file, then `rename`), mirroring `saveMeta`/`atomicWrite` in `src/lib/ai-sessions.ts`
and `withLock`/`atomicWriteUsers` in `src/lib/users.ts`. Identity is the existing
**`User.id`** (a string, from `data/users.json` via `getUserByUsername`/`getUserById` in
`src/lib/users.ts`) — there is no SQL `users(id)` table to reference. Records are keyed by
their own `id` and carry a `userId: User.id` field instead of a SQL foreign key.

```typescript
// src/lib/github/store.ts  ->  data/github-integrations.json (array of GitHubIntegrationRecord)
//                              data/github-tokens.json        (array of GitHubTokenRecord)
//                              data/github-repositories.json  (array of GitHubRepositoryRecord)
// Each file: load-all / mutate / atomicWrite under withLock, per the users.ts / ai-sessions.ts pattern.

/** data/github-integrations.json — one per (userId, githubServerUrl, authType). */
export interface GitHubIntegrationRecord {
  id: string; // UUID, primary key within the JSON array
  userId: string; // == User.id from data/users.json (NOT a SQL FK)
  displayName: string; // e.g., "GitHub (Personal)" or "GitHub Enterprise"
  githubServerUrl: string; // "https://github.com" or enterprise URL
  authType: "PAT" | "GITHUB_APP";

  enabled: boolean; // default true
  createdAt: string; // ISO timestamp (matches users.ts/ai-sessions.ts)
  updatedAt: string;
  lastUsedAt?: string;

  // Rate limiting state
  rateLimitRemaining?: number;
  rateLimitResetAt?: string;

  // For audit
  userAgent?: string;
  ipAddress?: string;
}
// Uniqueness (userId, githubServerUrl, authType) and the userId->User.id relationship are
// enforced in code inside withLock (scan the array before insert); there are no DB constraints.
// Cascade-on-delete is likewise emulated in code: deleting an integration also drops its
// token + repository records (see §6.2 DELETE).

/** data/github-tokens.json — encrypted material, kept in a separate file from metadata. */
export interface GitHubTokenRecord {
  integrationId: string; // == GitHubIntegrationRecord.id
  tokenCiphertext: string; // AES-256-GCM encrypted (base64)
  tokenNonce: string; // IV/nonce for decryption (base64)
  tokenSalt: string; // Salt used in KDF (base64)
  tokenType: "bearer" | "app-jwt";

  // For PAT tokens
  patScopes?: string[]; // ["repo", "read:org"]

  // For GitHub App tokens
  appId?: string;
  installationId?: string;
  appPrivateKeyCiphertext?: string; // Encrypted private key (server-side only)

  rotationScheduledAt?: string;
  lastRotatedAt?: string;
}

/** data/github-repositories.json — runtime cache of what .terminalx/settings.toml declares (§6.1). */
export interface GitHubRepositoryRecord {
  id: string; // UUID
  integrationId: string; // == GitHubIntegrationRecord.id
  owner: string;
  name: string;
  fullName: string; // owner/name; unique per integrationId (enforced in code)

  webhookSecret?: string; // HMAC-SHA256 secret (encrypted)
  webhookId?: string;
  webhookUrl?: string;
  webhookEvents?: WebhookEvent[]; // ["push", "pull_request", "check_run", ...]

  defaultBranch: string; // default 'main'
  isPrivate?: boolean;
  archived: boolean; // default false

  createdAt: string;
  updatedAt: string;
}
```

### 1.2 Token Lifecycle Management

#### PAT (Personal Access Token)

```typescript
interface PATTokenConfig {
  // User-supplied during setup
  token: string; // GitHub PAT
  scopes: string[]; // ["repo", "read:org", "workflow"]
  expiresAt?: Date; // Optional expiration
  notes?: string; // e.g., "TerminalX CI - Created 2026-06-25"
}
```

#### GitHub App Authentication

```typescript
interface GitHubAppConfig {
  appId: string; // Registered GitHub App ID
  appName: string; // e.g., "terminalx-pr-bot"
  privateKey: string; // PEM-encoded private key
  installationId: string; // Installation ID for this org
  webhookSecret: string; // Webhook HMAC secret
}
```

### 1.3 Secure Token Storage

```typescript
// src/lib/github/token-vault.ts

export interface TokenVault {
  /**
   * Store encrypted token in the JSON-file store (data/github-integrations.json +
   * data/github-tokens.json, §1.1), under withLock + atomicWrite.
   * @param userId  the existing User.id (from src/lib/users.ts), NOT a SQL key
   * @returns integration id for future reference
   */
  storeToken(
    userId: string,
    config: PATTokenConfig | GitHubAppConfig,
    metadata: {
      displayName: string;
      githubServerUrl: string;
      userAgent: string;
      ipAddress: string;
    }
  ): Promise<string>;

  /**
   * Retrieve and decrypt token (server-side only)
   * @throws if token not found, expired, or decryption fails
   */
  getToken(integrationId: string): Promise<string>;

  /**
   * Validate token is still valid (check expiration, not revoked)
   */
  validateToken(integrationId: string): Promise<boolean>;

  /**
   * Rotate PAT token (creates new token, deactivates old)
   * Manual process: user must provide new token
   */
  rotatePATToken(
    integrationId: string,
    newToken: string
  ): Promise<{ success: boolean; rotatedAt: Date }>;

  /**
   * Rotate GitHub App token (automatic JWT refresh)
   * Called before JWT expiration (< 1 minute remaining)
   */
  refreshGitHubAppToken(integrationId: string): Promise<string>;

  /**
   * Revoke token and prevent further use
   */
  revokeToken(integrationId: string): Promise<void>;

  /**
   * List all active integrations for user
   */
  listIntegrations(userId: string): Promise<
    Array<{
      id: string;
      displayName: string;
      authType: "PAT" | "GITHUB_APP";
      githubServerUrl: string;
      enabled: boolean;
      lastUsedAt?: Date;
    }>
  >;
}
```

### 1.4 Token Encryption

```typescript
// Encryption at rest using libsodium (via tweetnacl.js or node-forge)
// Key derivation: PBKDF2(masterKey, salt, 100000 iterations, 32 bytes)
// Cipher: AES-256-GCM with 12-byte nonce

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const KEY_DERIVATION_ITERATIONS = 100000;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const MASTER_KEY_ENV = "TERMINALX_GITHUB_TOKEN_MASTER_KEY"; // Must be 32 bytes (base64)
```

---

## 2. API Wrapper

### 2.1 Core API Client

```typescript
// src/lib/github/client.ts

// The set of error CODES. Kept separate from the thrown-object interface below so the two
// names can't collide (an enum and an interface of the same name merge in TS, which made
// `code: GitHubAPIError` recursively reference the object type instead of these codes).
export enum GitHubErrorCode {
  // Client errors (4xx)
  AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED", // 401
  FORBIDDEN = "FORBIDDEN", // 403
  NOT_FOUND = "NOT_FOUND", // 404
  VALIDATION_ERROR = "VALIDATION_ERROR", // 422

  // Rate limiting
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED", // 403 + X-RateLimit-Remaining: 0
  SECONDARY_RATE_LIMIT = "SECONDARY_RATE_LIMIT", // 403 (abuse detection)

  // Server errors (5xx)
  SERVER_ERROR = "SERVER_ERROR", // 500
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE", // 503

  // Network/Timeout
  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT = "TIMEOUT",

  // TerminalX-specific
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  TOKEN_REVOKED = "TOKEN_REVOKED",
  WEBHOOK_VALIDATION_FAILED = "WEBHOOK_VALIDATION_FAILED",
  CONFIGURATION_ERROR = "CONFIGURATION_ERROR",
}

// The thrown-error object. Its `code` is one of the GitHubErrorCode values above.
export interface GitHubAPIError {
  code: GitHubErrorCode;
  message: string;
  statusCode: number;
  rateLimitReset?: Date;
  retryAfter?: number; // seconds
  requestId?: string; // GitHub's X-GitHub-Request-Id
  documentation?: string; // GitHub API docs URL
}

export class GitHubAPIClient {
  constructor(
    integrationId: string,
    tokenVault: TokenVault,
    options?: {
      timeout?: number; // Default: 30000ms
      retryCount?: number; // Default: 3
      userAgent?: string; // Default: "TerminalX/1.0"
    }
  ) {}

  /**
   * Core request method (handles auth, retries, rate limiting)
   */
  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    endpoint: string,
    options?: {
      body?: Record<string, unknown>;
      headers?: Record<string, string>;
      query?: Record<string, string | number | boolean>;
    }
  ): Promise<T>;

  /**
   * Extract and cache rate limit info from response headers
   */
  private updateRateLimitState(headers: Headers): void;
}
```

### 2.2 Repository Endpoints

```typescript
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
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

export interface RepositoryAPI {
  /**
   * List all branches in a repository
   * GET /repos/{owner}/{repo}/branches
   *
   * @param perPage Pagination: 1-100, default 30
   * @param page Starting page number (default 1)
   * @returns List of branches with commit info
   * @throws GitHubErrorCode.RATE_LIMIT_EXCEEDED, NOT_FOUND, AUTHENTICATION_FAILED
   */
  listBranches(
    owner: string,
    repo: string,
    options?: { perPage?: number; page?: number }
  ): Promise<Branch[]>;

  /**
   * Get branch protection status
   * GET /repos/{owner}/{repo}/branches/{branch}/protection
   */
  getBranchProtection(
    owner: string,
    repo: string,
    branch: string
  ): Promise<BranchProtection | null>;

  /**
   * List repository commits
   * GET /repos/{owner}/{repo}/commits
   */
  listCommits(
    owner: string,
    repo: string,
    options?: {
      sha?: string; // Branch/tag/commit SHA
      path?: string; // Filter by path
      author?: string; // Filter by author login
      perPage?: number;
      page?: number;
    }
  ): Promise<Commit[]>;

  /**
   * Get single commit details
   * GET /repos/{owner}/{repo}/commits/{ref}
   */
  getCommit(
    owner: string,
    repo: string,
    ref: string // Commit SHA, branch, or tag
  ): Promise<Commit>;
}
```

### 2.3 Pull Request Endpoints

```typescript
export interface PullRequest {
  id: number;
  number: number; // Drives the UI "#n" status-bar link (§0.1)
  title: string;
  body: string;
  state: "open" | "closed"; // RAW GitHub state. NOT the UI pill; see §2.3a.
  draft: boolean;
  created_at: string;
  updated_at: string;
  merged_at: string | null; // Non-null => UI pill is "Merged"
  merged: boolean; // Present on single-PR GET; mirrors merged_at != null
  merged_by: User | null;
  closed_at: string | null;

  // Mergeability (populated by GitHub asynchronously on single-PR GET; may be null while
  // GitHub computes it). Used by the Checks tab's "merge conflicts" indicator.
  mergeable: boolean | null;
  mergeable_state?: "clean" | "dirty" | "blocked" | "unstable" | "behind" | "unknown";

  head: {
    ref: string; // Branch name — the JOIN KEY to a TerminalX session
    // (SessionMeta.worktree.branch); see §2.7.
    sha: string; // Commit SHA — JOIN KEY for check runs/statuses (§2.4)
    repo: Repository | null; // Null if deleted
  };

  base: {
    ref: string;
    sha: string;
    repo: Repository;
  };

  user: User;
  assignees: User[];
  requested_reviewers: User[]; // GitHub's field name (not "reviewers")
  labels: Label[];

  comments: number;
  review_comments: number;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;

  html_url: string; // Drives the "↗" in the "#n ↗" link (§0.1)
  statuses_url: string;
  url: string;
}

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

/**
 * UI-facing PR view. This is the shape the review-panel status bar (§0.1) actually
 * renders — the diff-viewer / pr-review / checks-dashboard specs consume `PullRequestView`,
 * NOT the raw `PullRequest`. Produced by `toPullRequestView()` below.
 */
export interface PullRequestView {
  number: number; // "#n"
  htmlUrl: string; // "↗" target
  title: string;
  status: PullRequestStatus; // the status pill (§2.3a)
  headBranch: string; // join key to SessionMeta.worktree.branch
  headSha: string; // join key to check runs / statuses
  baseBranch: string;
  changedFiles: number; // backs the "Changes" tab count badge
  additions: number;
  deletions: number;
}

export interface PullRequestAPI {
  /**
   * Create a pull request
   * POST /repos/{owner}/{repo}/pulls
   *
   * @throws GitHubErrorCode.VALIDATION_ERROR (branch protection, merge conflicts)
   * @throws GitHubErrorCode.NOT_FOUND (base or head branch doesn't exist)
   */
  createPullRequest(
    owner: string,
    repo: string,
    input: {
      title: string;
      body?: string;
      head: string; // Branch name or 'user:branch' for cross-repo
      base: string; // Target branch (default: repo.default_branch)
      draft?: boolean;
      labels?: string[];
      assignees?: string[];
      reviewers?: string[];
    }
  ): Promise<PullRequest>;

  /**
   * Get a pull request by number
   * GET /repos/{owner}/{repo}/pulls/{pull_number}
   */
  getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest>;

  /**
   * List pull requests
   * GET /repos/{owner}/{repo}/pulls
   */
  listPullRequests(
    owner: string,
    repo: string,
    options?: {
      state?: "open" | "closed" | "all";
      base?: string;
      head?: string;
      sort?: "created" | "updated" | "popularity" | "long-running";
      direction?: "asc" | "desc";
      perPage?: number;
      page?: number;
    }
  ): Promise<PullRequest[]>;

  /**
   * Update a pull request
   * PATCH /repos/{owner}/{repo}/pulls/{pull_number}
   */
  updatePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    updates: {
      title?: string;
      body?: string;
      state?: "open" | "closed";
      base?: string;
      draft?: boolean;
      labels?: string[];
      assignees?: string[];
    }
  ): Promise<PullRequest>;

  /**
   * Merge a pull request
   * PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge
   *
   * @throws GitHubErrorCode.VALIDATION_ERROR (not mergeable, missing approvals)
   */
  mergePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    options?: {
      commitTitle?: string;
      commitMessage?: string;
      mergeMethod?: "merge" | "squash" | "rebase";
    }
  ): Promise<{ sha: string; merged: boolean; message: string }>;

  /**
   * Create a pull request comment
   * POST /repos/{owner}/{repo}/issues/{issue_number}/comments
   * (issues endpoint handles both issues and PRs)
   */
  createComment(owner: string, repo: string, prNumber: number, body: string): Promise<Comment>;

  /**
   * Update a pull request comment
   * PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}
   */
  updateComment(owner: string, repo: string, commentId: number, body: string): Promise<Comment>;

  /**
   * Delete a pull request comment
   * DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}
   */
  deleteComment(owner: string, repo: string, commentId: number): Promise<void>;

  /**
   * List pull request comments
   * GET /repos/{owner}/{repo}/pulls/{pull_number}/comments
   */
  listComments(
    owner: string,
    repo: string,
    prNumber: number,
    options?: { perPage?: number; page?: number }
  ): Promise<Comment[]>;
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
```

### 2.3a Derived PR status (status-bar pill)

The review-panel status bar (§0.1) shows ONE pill: `Merged` / `Open` / `Draft` / `Closed`.
GitHub does not return this as a single field — it must be derived from `merged_at`,
`state`, and `draft`. Centralize the derivation so every surface (status bar,
checks-dashboard, pr-review) agrees.

```typescript
export type PullRequestStatus = "merged" | "open" | "draft" | "closed";

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
  merged: { label: "Merged", tone: "success" }, // Conductor renders a "Merged" pill
  open: { label: "Open", tone: "success" },
  draft: { label: "Draft", tone: "muted" },
  closed: { label: "Closed", tone: "danger" },
};

/** Project a raw PullRequest into the UI-facing PullRequestView (see §2.3). */
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

/**
 * Shared props type for the status-bar PR pill+link, exported as the SINGLE source of truth
 * for every surface that renders it (diff-viewer's `ReviewStatusBar`, the checks-dashboard
 * header, etc.). It is the `Pick<>` subset of `PullRequestView` those surfaces need — so the
 * field names are `htmlUrl` and `status` (NOT `url`/`state`). `diff-viewer.spec.md` §4.1
 * MUST import this rather than redeclaring an inline `{ number; url; state }` shape; matching
 * by field name is what makes the "these UI shapes MUST agree" claim in the header true.
 */
export type ReviewStatusBarPr = Pick<PullRequestView, "number" | "htmlUrl" | "status">;
```

### 2.4 Check Runs & Status Endpoints

```typescript
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

export interface CheckRunAPI {
  /**
   * List check runs for a commit
   * GET /repos/{owner}/{repo}/commits/{ref}/check-runs
   */
  listCheckRuns(
    owner: string,
    repo: string,
    ref: string, // Commit SHA or branch
    options?: {
      appId?: number; // Filter by app
      checkName?: string; // Filter by check name
      status?: CheckStatus;
      conclusion?: CheckConclusion;
      perPage?: number;
      page?: number;
    }
  ): Promise<CheckRun[]>;

  /**
   * Get a specific check run
   * GET /repos/{owner}/{repo}/check-runs/{check_run_id}
   */
  getCheckRun(owner: string, repo: string, checkRunId: number): Promise<CheckRun>;

  /**
   * Create a check run (requires GitHub App with checks:write permission)
   * POST /repos/{owner}/{repo}/check-runs
   */
  createCheckRun(
    owner: string,
    repo: string,
    input: {
      name: string;
      head_sha: string;
      status?: CheckStatus;
      details_url?: string;
      external_id?: string;
      output?: {
        title: string;
        summary: string;
        text?: string;
        annotations?: CheckAnnotation[];
      };
    }
  ): Promise<CheckRun>;

  /**
   * Update a check run
   * PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}
   */
  updateCheckRun(
    owner: string,
    repo: string,
    checkRunId: number,
    updates: {
      status?: CheckStatus;
      conclusion?: CheckConclusion;
      completed_at?: string;
      output?: CheckRun["output"];
    }
  ): Promise<CheckRun>;

  /**
   * List check suites for a commit
   * GET /repos/{owner}/{repo}/commits/{ref}/check-suites
   */
  listCheckSuites(
    owner: string,
    repo: string,
    ref: string
  ): Promise<Array<{ id: number; status: CheckStatus; conclusion: string | null }>>;
}

export interface StatusAPI {
  /**
   * List statuses for a commit (legacy API, still used for simple status checks)
   * GET /repos/{owner}/{repo}/commits/{ref}/statuses
   */
  listStatuses(
    owner: string,
    repo: string,
    ref: string
  ): Promise<
    Array<{
      state: "pending" | "success" | "failure" | "error";
      description: string;
      context: string;
      created_at: string;
      url: string;
    }>
  >;

  /**
   * Create a commit status (legacy, for simple CI/CD status updates)
   * POST /repos/{owner}/{repo}/statuses/{ref}
   */
  createStatus(
    owner: string,
    repo: string,
    ref: string,
    input: {
      state: "pending" | "success" | "failure" | "error";
      description?: string;
      context: string; // e.g., "terminalx/build"
      target_url?: string;
    }
  ): Promise<void>;
}
```

#### Checks tab aggregate (consumed by `checks-dashboard.spec.md`)

The `Checks` tab (§0.1) is backed by BOTH modern check runs (`CheckRunAPI`) and legacy
commit statuses (`StatusAPI`), keyed by the PR head SHA. The data layer merges them into a
single normalized list plus a rollup so the UI doesn't have to reconcile two GitHub APIs.
`NormalizedCheck` is the row this spec produces; `checks-dashboard.spec.md`'s `ChecksItem`
is the rendered row and shares the SAME `state` vocabulary (§2.4 `CheckState`) — keep the
two enums identical.

```typescript
// Row-level check state. This is the SHARED per-row vocabulary; it MUST match
// `ChecksItem.state` in `checks-dashboard.spec.md` (that spec owns the rendered rows). The
// raw GitHub conclusions `cancelled` and `action_required` are NOT row states — they are
// folded into `failure` during normalization (see the mapping below). `skipped` IS a row
// state. (Previously this enum exposed cancelled/action_required and lacked skipped, which
// disagreed with checks-dashboard; corrected to match.)
export type CheckState = "success" | "failure" | "pending" | "neutral" | "skipped";

/** One row in the Checks tab — normalized from a CheckRun OR a legacy commit Status. */
export interface NormalizedCheck {
  source: "check_run" | "status";
  name: string; // CheckRun.name or Status.context
  state: CheckState; // mapped from CheckStatus+CheckConclusion or Status.state
  rawConclusion?: CheckConclusion | null; // original conclusion (e.g. 'cancelled') for tooltips
  detailsUrl?: string; // CheckRun.html_url or Status.target_url
  description?: string; // Status.description or CheckRun.output.title
  startedAt?: string;
  completedAt?: string;
}

/**
 * Normalize a CheckRun's status+conclusion into a row CheckState. MUST agree with
 * `checks-dashboard.spec.md` §2.3 normalization rules:
 *   - status !== 'completed'                            -> 'pending'
 *   - conclusion 'success'                              -> 'success'
 *   - conclusion 'neutral'                              -> 'neutral'
 *   - conclusion 'skipped'                              -> 'skipped'
 *   - conclusion 'failure' | 'timed_out' | 'action_required' | 'cancelled' -> 'failure'
 * (cancelled/action_required fold INTO failure; keep the raw conclusion in `rawConclusion`
 *  so the row can still be labelled "cancelled" in a tooltip.)
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

/**
 * Rollup state for the head SHA. Includes the "happy path" states plus the meta/empty
 * states the Checks tab must render. MUST stay in sync with `ChecksRollup` in
 * `checks-dashboard.spec.md` (that spec re-exports / mirrors this vocabulary):
 *   success | failure | pending | none | error | no-repo | no-pr
 */
export type ChecksOverall =
  | "success" // every row is success/neutral/skipped
  | "failure" // at least one row is 'failure' (incl. folded timed_out/action_required/cancelled)
  | "pending" // at least one row is 'pending' (queued/in_progress), none failed
  | "none" // no checks reported for the head SHA
  | "error" // could not fetch (auth / rate-limit / network)
  | "no-repo" // not a git repo / no GitHub remote
  | "no-pr"; // repo + branch known, but no associated PR

/** Rollup for the head SHA — drives the Checks tab summary + the status-bar tab badge. */
export interface ChecksSummary {
  headSha: string;
  total: number;
  passing: number;
  failing: number;
  pending: number;
  /** Worst-case rollup; see ChecksOverall. failure > pending > success; meta states win
   *  when there is nothing to roll up (none/error/no-repo/no-pr). */
  overall: ChecksOverall;
  /** Populated when `overall` is a meta state (none/error/no-repo/no-pr), for the empty/error UI. */
  reason?: string;
  checks: NormalizedCheck[];
}

export interface ChecksAggregateAPI {
  /**
   * Merge check runs + commit statuses for a head SHA into one ChecksSummary.
   * Internally calls listCheckRuns() and listStatuses() and de-dupes by name.
   * This is what the Checks tab and the per-PR status badge consume.
   */
  getChecksForSha(owner: string, repo: string, headSha: string): Promise<ChecksSummary>;
}
```

### 2.5 Review Endpoints

```typescript
export interface Review {
  id: number;
  user: User;
  body: string;
  state: "PENDING" | "COMMENTED" | "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED";
  submitted_at: string | null;
  commit_id: string;
  html_url: string;
}

/**
 * A line-anchored review comment (GitHub "pull request review comment"). These are what the
 * `Review` tab (§0.1) and the diff viewer's inline threads render — distinct from the
 * issue-style `Comment` (§2.3) which is not line-anchored. This is the shape `pr-review/`
 * would consume IF migrated onto this spec; today `pr-review/` uses Octokit's own comment
 * types directly (see the client-strategy note in the header).
 */
export interface ReviewComment {
  id: number;
  pull_request_review_id: number | null; // groups comments into a Review thread
  user: User;
  body: string;
  path: string; // file the comment is anchored to
  line: number | null; // line in the diff (new side); null if outdated
  original_line: number | null;
  start_line: number | null; // for multi-line comments
  side: "LEFT" | "RIGHT"; // which side of the split diff
  commit_id: string;
  diff_hunk: string; // the hunk GitHub anchors the thread to
  in_reply_to_id: number | null; // threads replies
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface ReviewAPI {
  /**
   * List reviews on a pull request
   * GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews
   */
  listReviews(
    owner: string,
    repo: string,
    prNumber: number,
    options?: { perPage?: number; page?: number }
  ): Promise<Review[]>;

  /**
   * List line-anchored review comments on a pull request (for the Review tab + inline diff
   * threads). NOTE: this is the *review comments* endpoint, distinct from the issue-comments
   * endpoint used by PullRequestAPI.listComments (§2.3).
   * GET /repos/{owner}/{repo}/pulls/{pull_number}/comments
   */
  listReviewComments(
    owner: string,
    repo: string,
    prNumber: number,
    options?: { perPage?: number; page?: number }
  ): Promise<ReviewComment[]>;

  /**
   * Reply to an existing review comment thread (inline diff reply).
   * POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies
   */
  replyToReviewComment(
    owner: string,
    repo: string,
    prNumber: number,
    commentId: number,
    body: string
  ): Promise<ReviewComment>;

  /**
   * Request reviewers
   * POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers
   */
  requestReviewers(
    owner: string,
    repo: string,
    prNumber: number,
    input: {
      reviewers?: string[]; // GitHub usernames
      team_reviewers?: string[]; // Team slugs
    }
  ): Promise<PullRequest>;

  /**
   * Create a review
   * POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews
   * (can be pending, commented, or approved in one call)
   */
  createReview(
    owner: string,
    repo: string,
    prNumber: number,
    input: {
      body?: string;
      event: "PENDING" | "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
      comments?: Array<{
        path: string;
        line: number;
        body: string;
      }>;
    }
  ): Promise<Review>;

  /**
   * Dismiss a review
   * PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/dismissals
   */
  dismissReview(
    owner: string,
    repo: string,
    prNumber: number,
    reviewId: number,
    message: string
  ): Promise<Review>;
}
```

#### Review tab aggregate (proposed shared contract for `pr-review/`)

The `Review` tab (§0.1) needs the reviews (approval state per reviewer) AND the
line-anchored comment threads, grouped for rendering. The data layer composes them below.
This is the contract `pr-review/` SHOULD consume if the integration standardizes on this
spec's client; today `pr-review/` computes the equivalent itself via Octokit and its own
`ReviewState`/`StoredReviewState` (see the client-strategy note in the header).

```typescript
export type ReviewDecision = "approved" | "changes_requested" | "review_required" | "pending";

/** A grouped inline comment thread for one (path, line). */
export interface ReviewThread {
  path: string;
  line: number | null;
  side: "LEFT" | "RIGHT";
  resolved: boolean; // TerminalX-tracked (GitHub REST omits resolution)
  comments: ReviewComment[]; // ordered; first is root, rest are replies
}

export interface ReviewSummary {
  prNumber: number;
  /** Overall decision rolled up from per-reviewer reviews (latest review per user wins). */
  decision: ReviewDecision;
  reviews: Review[];
  threads: ReviewThread[];
}

export interface ReviewAggregateAPI {
  /** Compose listReviews() + listReviewComments() into the Review-tab payload. */
  getReviewSummary(owner: string, repo: string, prNumber: number): Promise<ReviewSummary>;
}
```

### 2.5a Authenticated user (viewer) endpoint

The integration-creation flow (§6.2) needs to confirm "who am I" to display the connected
account (Conductor's harness screen shows Provider / Plan / Org / Account, §0). That is the
`GET /user` endpoint, exposed as a small sub-API:

```typescript
export interface UsersAPI {
  /**
   * Get the authenticated user (the account the token/app belongs to).
   * GET /user
   */
  getAuthenticated(): Promise<User>;
}
```

### 2.6 Implementation Pattern

```typescript
// src/lib/github/api.ts

export class GitHubAPI {
  repo: RepositoryAPI;
  pulls: PullRequestAPI;
  checks: CheckRunAPI;
  reviews: ReviewAPI;
  status: StatusAPI;
  users: UsersAPI; // -> GET /user (§2.5a)
  webhooks: WebhookAPI; // -> repo webhooks (§5.1)

  // UI-facing aggregates that back the review panel's tabs (§0.1).
  checksAggregate: ChecksAggregateAPI; // -> Checks tab
  reviewAggregate: ReviewAggregateAPI; // -> Review tab

  constructor(
    private readonly integrationId: string,
    tokenVault: TokenVault
  ) {
    this.repo = new RepositoryAPIImpl(integrationId, tokenVault);
    this.pulls = new PullRequestAPIImpl(integrationId, tokenVault);
    this.checks = new CheckRunAPIImpl(integrationId, tokenVault);
    this.reviews = new ReviewAPIImpl(integrationId, tokenVault);
    this.status = new StatusAPIImpl(integrationId, tokenVault);
    this.users = new UsersAPIImpl(integrationId, tokenVault);
    this.webhooks = new WebhookAPIImpl(integrationId, tokenVault);
    this.checksAggregate = new ChecksAggregateAPIImpl(this.checks, this.status);
    this.reviewAggregate = new ReviewAggregateAPIImpl(this.reviews);
  }
}
```

Note: `WebhookAPI` methods take an explicit `integrationId` as their first argument (§5.1).
When called via `api.webhooks`, pass the instance's own `integrationId` through (see §6.2).

### 2.7 Linking a PR to a TerminalX session

The review panel is attached to a **session**, so the data layer must resolve "the PR for
this session". TerminalX sessions carry an optional worktree (verified in
`src/lib/ai-sessions.ts`):

```typescript
// src/lib/ai-sessions.ts (existing — do not redefine)
export interface SessionMeta {
  name: string;
  kind: SessionKind; // "bash" | "claude" | "codex"
  createdAt: string;
  // ...
  worktree?: {
    repoRoot: string;
    path: string;
    branch: string; // <-- the JOIN KEY to PullRequest.head.ref
  };
}
```

Resolution: given a session, take `worktree.branch` and query
`listPullRequests(owner, repo, { head: \`${owner}:${branch}\`, state: 'all' })`; the newest
match is the session's PR. The `owner/repo`pair comes from the repo's`.terminalx/settings.toml`binding (§0.2 / §6.1). If no PR exists, the status bar shows
"Create PR" (§0.1) wired to §7. Worktrees live under`TERMINALX_WORKTREES_ROOT`(default`<root>/.terminalx-worktrees`), created by `createGitWorktreeForSession`in`src/lib/git-worktree.ts`.

```typescript
// src/lib/github/session-link.ts
export interface SessionPRLink {
  sessionName: string;
  branch: string;
  pr: PullRequestView | null; // null => offer "Create PR"
}

export async function resolvePRForSession(
  api: GitHubAPI,
  owner: string,
  repo: string,
  session: SessionMeta
): Promise<SessionPRLink>;
```

---

## 3. Rate Limiting & Queuing

### 3.1 Rate Limit Handling

```typescript
// src/lib/github/rate-limiter.ts

export interface RateLimit {
  limit: number; // 5000 (authenticated) or 60 (public)
  remaining: number;
  reset: number; // Unix timestamp
  resetAt: Date;
  used: number;
}

export interface RateLimitQuota {
  core: RateLimit; // Regular API calls
  graphql: RateLimit; // GraphQL queries
  search: RateLimit; // Search API
}

export class RateLimiter {
  /**
   * Get current rate limit status
   * GET /rate_limit
   */
  getQuota(integrationId: string): Promise<RateLimitQuota>;

  /**
   * Check if request would exceed rate limit
   * Returns seconds to wait if rate limited
   */
  checkLimit(integrationId: string): Promise<{ allowed: boolean; waitSeconds?: number }>;

  /**
   * Update internal state from response headers
   * Called after every request
   */
  updateFromHeaders(integrationId: string, headers: Headers): void;

  /**
   * Wait until rate limit resets
   * Exponential backoff with jitter
   */
  async waitUntilReset(integrationId: string): Promise<void>;
}
```

### 3.2 Request Queue System

```typescript
// src/lib/github/queue.ts

export enum QueuePriority {
  LOW = 3,
  NORMAL = 2,
  HIGH = 1,
  CRITICAL = 0,
}

export interface QueuedRequest {
  id: string;
  integrationId: string;
  method: string;
  endpoint: string;
  body?: unknown;
  priority: QueuePriority;
  retries: { attempted: number; max: number };
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: { code: GitHubErrorCode; message: string };
}

export class RequestQueue {
  /**
   * Add request to queue
   * @returns request ID for tracking
   */
  enqueue(
    integrationId: string,
    method: string,
    endpoint: string,
    options?: {
      body?: unknown;
      priority?: QueuePriority;
      retryPolicy?: { max: number; exponentialBase: number };
    }
  ): string;

  /**
   * Get queue status
   */
  getStatus(): {
    totalQueued: number;
    byIntegration: Map<string, number>;
    byPriority: Map<QueuePriority, number>;
    oldestRequestAge: number; // milliseconds
  };

  /**
   * Subscribe to request completion
   */
  onRequestComplete(
    requestId: string,
    callback: (result: { success: boolean; data?: unknown; error?: GitHubAPIError }) => void
  ): () => void;

  /**
   * Cancel pending request
   */
  cancel(requestId: string): boolean;

  /**
   * Process queue (run periodically or on-demand)
   */
  async processQueue(): Promise<void>;
}

/**
 * Retry Strategy
 * - Transient errors (429, 503, timeout): exponential backoff with jitter
 *   - Base: 2 seconds, multiplier: 2, jitter: ±20%, max: 120 seconds
 * - Non-transient errors (401, 404, 422): no retry, fail immediately
 * - Secondary rate limit: wait X seconds (from Retry-After header)
 */
export interface RetryPolicy {
  maxAttempts: number; // Default: 3
  initialDelayMs: number; // Default: 2000
  maxDelayMs: number; // Default: 120000
  multiplier: number; // Default: 2
  jitterFraction: number; // Default: 0.2
}
```

### 3.3 Retry Strategy

```typescript
export function shouldRetry(error: GitHubAPIError, attemptNumber: number): boolean {
  const transientErrors = [
    GitHubErrorCode.RATE_LIMIT_EXCEEDED,
    GitHubErrorCode.SECONDARY_RATE_LIMIT,
    GitHubErrorCode.SERVICE_UNAVAILABLE,
    GitHubErrorCode.TIMEOUT,
    GitHubErrorCode.NETWORK_ERROR,
  ];

  const nonRetryableErrors = [
    GitHubErrorCode.AUTHENTICATION_FAILED,
    GitHubErrorCode.TOKEN_EXPIRED,
    GitHubErrorCode.TOKEN_REVOKED,
    GitHubErrorCode.VALIDATION_ERROR, // 422: unprocessable
    GitHubErrorCode.NOT_FOUND,
  ];

  if (nonRetryableErrors.includes(error.code)) return false;
  if (!transientErrors.includes(error.code)) return false;
  if (attemptNumber >= 3) return false;

  return true;
}

export function calculateBackoff(attemptNumber: number, policy: RetryPolicy): number {
  const base = policy.initialDelayMs * Math.pow(policy.multiplier, attemptNumber - 1);
  const maxed = Math.min(base, policy.maxDelayMs);
  const jitter = maxed * policy.jitterFraction * (Math.random() * 2 - 1);
  return Math.max(0, maxed + jitter);
}
```

---

## 4. Error Handling

### 4.1 Error Classification

```typescript
export enum ErrorCategory {
  // Client-side errors (retry won't help)
  AUTHENTICATION = "AUTHENTICATION", // 401, expired token
  AUTHORIZATION = "AUTHORIZATION", // 403, insufficient permissions
  VALIDATION = "VALIDATION", // 422, invalid input
  NOT_FOUND = "NOT_FOUND", // 404, resource doesn't exist

  // Rate limiting (retry with backoff)
  RATE_LIMITED = "RATE_LIMITED", // 403 + X-RateLimit-Remaining: 0
  ABUSE_DETECTED = "ABUSE_DETECTED", // 403 + abuse detection

  // Server errors (retry, may be transient)
  SERVER_ERROR = "SERVER_ERROR", // 5xx
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE", // 503, maintenance

  // Network/Timeout (retry with backoff)
  TIMEOUT = "TIMEOUT",
  NETWORK_ERROR = "NETWORK_ERROR",

  // TerminalX-specific
  TOKEN_ERROR = "TOKEN_ERROR", // Revoked, expired, or invalid
  CONFIGURATION = "CONFIGURATION", // Integration not set up
  UNKNOWN = "UNKNOWN",
}

export function classifyError(response: Response, body?: unknown): ErrorCategory {
  if (response.status === 401) return ErrorCategory.AUTHENTICATION;
  if (response.status === 403) {
    const remaining = response.headers.get("X-RateLimit-Remaining");
    if (remaining === "0") return ErrorCategory.RATE_LIMITED;
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) return ErrorCategory.ABUSE_DETECTED;
    return ErrorCategory.AUTHORIZATION;
  }
  if (response.status === 404) return ErrorCategory.NOT_FOUND;
  if (response.status === 422) return ErrorCategory.VALIDATION;
  if (response.status === 503) return ErrorCategory.SERVICE_UNAVAILABLE;
  if (response.status >= 500) return ErrorCategory.SERVER_ERROR;
  return ErrorCategory.UNKNOWN;
}
```

### 4.2 Error Response Format

```typescript
export interface ErrorResponse {
  code: GitHubErrorCode;
  category: ErrorCategory;
  message: string;
  statusCode: number;

  // For rate limiting
  rateLimitReset?: {
    seconds: number;
    date: Date;
  };

  // For abuse detection
  retryAfter?: {
    seconds: number;
    date: Date;
  };

  // GitHub's error details
  errors?: Array<{
    resource: string;
    field: string;
    code: string;
  }>;

  // For debugging
  requestId?: string;
  documentation?: string;
  timestamp: Date;
}
```

### 4.3 Error Handling in Client Code

```typescript
// Usage example
async function createPRWithErrorHandling(
  api: GitHubAPI,
  owner: string,
  repo: string,
  input: any
): Promise<PullRequest | null> {
  try {
    return await api.pulls.createPullRequest(owner, repo, input);
  } catch (err) {
    const apiError = err as GitHubAPIError;

    switch (apiError.code) {
      case GitHubErrorCode.AUTHENTICATION_FAILED:
        // Token expired or revoked
        // Notify user to re-authenticate
        await tokenVault.validateToken(integrationId);
        throw new Error("GitHub token expired. Please re-authenticate.");

      case GitHubErrorCode.RATE_LIMIT_EXCEEDED:
        // Queue the request and retry after reset
        queue.enqueue(integrationId, "POST", `/repos/${owner}/${repo}/pulls`, {
          body: input,
          priority: QueuePriority.NORMAL,
        });
        throw new Error(`Rate limited until ${apiError.rateLimitReset?.date}. Request queued.`);

      case GitHubErrorCode.VALIDATION_ERROR:
        // User input error, don't retry
        throw new Error(`Invalid input: ${apiError.message}`);

      case GitHubErrorCode.NOT_FOUND:
        // Repository or branch doesn't exist
        throw new Error(`Repository or branch not found. Check repository name and branch.`);

      case GitHubErrorCode.SECONDARY_RATE_LIMIT:
        // Abuse detection - wait longer
        const retryAfter = apiError.retryAfter?.seconds || 60;
        queue.enqueue(integrationId, "POST", `/repos/${owner}/${repo}/pulls`, {
          body: input,
          priority: QueuePriority.NORMAL,
        });
        throw new Error(`Request blocked by abuse detection. Retrying in ${retryAfter} seconds.`);

      default:
        // Server error or timeout - retry
        throw new Error(`GitHub API error: ${apiError.message}`);
    }
  }
}
```

---

## 5. Webhook Support

### 5.1 Webhook Configuration

```typescript
// src/lib/github/webhooks.ts

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
  url: string; // TerminalX endpoint
  events: WebhookEvent[]; // e.g., ["pull_request", "check_run"]
  active: boolean;
  secret: string; // HMAC-SHA256 secret (TerminalX-generated)
  insecureSSL?: boolean; // For testing only
}

export interface WebhookAPI {
  /**
   * Create webhook on repository
   * POST /repos/{owner}/{repo}/hooks
   *
   * Creates webhook that sends events to:
   * https://terminalx.example.com/api/github/webhooks/{repoId}
   */
  createWebhook(
    integrationId: string,
    owner: string,
    repo: string,
    config: WebhookConfig
  ): Promise<{ id: string; url: string; secret: string }>;

  /**
   * Update webhook configuration
   * PATCH /repos/{owner}/{repo}/hooks/{hook_id}
   */
  updateWebhook(
    integrationId: string,
    owner: string,
    repo: string,
    webhookId: string,
    config: Partial<WebhookConfig>
  ): Promise<void>;

  /**
   * Delete webhook
   * DELETE /repos/{owner}/{repo}/hooks/{hook_id}
   */
  deleteWebhook(
    integrationId: string,
    owner: string,
    repo: string,
    webhookId: string
  ): Promise<void>;

  /**
   * Test webhook delivery
   * POST /repos/{owner}/{repo}/hooks/{hook_id}/tests
   * Triggers a test event
   */
  testWebhook(
    integrationId: string,
    owner: string,
    repo: string,
    webhookId: string,
    event?: WebhookEvent
  ): Promise<void>;

  /**
   * Resend recent deliveries
   * GET /repos/{owner}/{repo}/hooks/{hook_id}/deliveries
   */
  listWebhookDeliveries(
    integrationId: string,
    owner: string,
    repo: string,
    webhookId: string,
    options?: { perPage?: number; page?: number }
  ): Promise<WebhookDelivery[]>;
}

export interface WebhookDelivery {
  id: number;
  guid: string;
  url: string;
  action: string;
  status: "OK" | "FAILED";
  statusCode: number;
  request: { headers: Record<string, string>; payload: unknown };
  response: { headers: Record<string, string>; payload: string };
  timestamp: string;
}
```

### 5.2 Webhook Event Handling

```typescript
// src/app/api/github/webhooks/[repoId]/route.ts
// NOTE: Next.js 16 App Router — `params` is a Promise and MUST be awaited
// (verified convention: src/app/api/sessions/[name]/route.ts).
import * as crypto from "crypto"; // codebase convention: src/lib/git-worktree.ts, auth.ts, etc.

export async function POST(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await ctx.params;

  // 1. Validate webhook signature (HMAC-SHA256)
  const signature = req.headers.get("X-Hub-Signature-256");
  const payload = await req.text();
  const isValid = validateWebhookSignature(repoId, payload, signature);

  if (!isValid) {
    return NextResponse.json({ error: GitHubErrorCode.WEBHOOK_VALIDATION_FAILED }, { status: 401 });
  }

  // 2. Parse event
  const event = req.headers.get("X-GitHub-Event");
  const body = JSON.parse(payload);

  // 3. Dispatch to handler
  switch (event) {
    case "pull_request":
      await handlePullRequestEvent(repoId, body);
      break;
    case "check_run":
      await handleCheckRunEvent(repoId, body);
      break;
    case "check_suite":
      await handleCheckSuiteEvent(repoId, body);
      break;
    case "push":
      await handlePushEvent(repoId, body);
      break;
    default:
      console.log(`Unhandled event: ${event}`);
  }

  return NextResponse.json({ success: true });
}

/**
 * Validate webhook signature
 * GitHub sends X-Hub-Signature-256: sha256=hex(HMAC-SHA256(secret, payload))
 */
function validateWebhookSignature(
  repoId: string,
  payload: string,
  signature: string | null
): boolean {
  if (!signature || !signature.startsWith("sha256=")) return false;

  const secret = getWebhookSecret(repoId);
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");

  // Constant-time comparison to prevent timing attacks.
  // NOTE: crypto.timingSafeEqual requires Buffer/TypedArray args (it throws TypeError on
  // strings) and throws RangeError when the two buffers differ in length. Convert both
  // sides to Buffers and length-guard first, so an attacker-controlled signature of a
  // different length returns false instead of throwing.
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

### 5.3 Event Handler Example: Pull Request

```typescript
async function handlePullRequestEvent(
  repoId: string,
  payload: {
    action: "opened" | "closed" | "synchronize" | "review_requested" | "labeled";
    pull_request: PullRequest;
    repository: Repository;
  }
): Promise<void> {
  const { action, pull_request, repository } = payload;

  const pr = {
    id: pull_request.id,
    number: pull_request.number,
    title: pull_request.title,
    url: pull_request.html_url,
    state: pull_request.state,
    action: action,
    author: pull_request.user.login,
    repo: repository.full_name,
    headBranch: pull_request.head.ref,
    baseBranch: pull_request.base.ref,
    createdAt: pull_request.created_at,
    updatedAt: pull_request.updated_at,
  };

  // Store in TerminalX database for audit/history
  await savePullRequestEvent({
    repositoryId: repoId,
    event: action,
    prData: pr,
    receivedAt: new Date(),
  });

  // Trigger any configured handlers
  switch (action) {
    case "opened":
      await notifyPROpened(repoId, pr);
      break;
    case "synchronize":
      // New commit pushed to PR branch
      await notifyPRUpdated(repoId, pr);
      break;
    case "review_requested":
      // PR review was requested
      await notifyReviewRequested(repoId, pr);
      break;
  }
}
```

---

## 6. Configuration Management

### 6.1 Configuration Storage

Config is split by **scope** (mirroring Conductor's User vs Repo tabs, §0.2):

- **User scope (JSON-file store under `data/`, never committed):** a user's integrations +
  encrypted tokens (`data/github-integrations.json` / `data/github-tokens.json`, §1.1),
  keyed by `User.id`. Personal, secret, per-user.
- **Repo scope (committed `.terminalx/settings.toml`):** which integration display-name a
  repo binds to, `webhookEvents`, and `defaultBranch`. This is the TerminalX analog of
  Conductor's committed `.conductor/settings.toml`, surfaced in the UI with an "Edit"
  affordance. **No secrets** go here. The `GitHubRepositoryRecord`
  (`data/github-repositories.json`, §1.1) is the runtime cache of what this file declares.

```toml
# .terminalx/settings.toml  (committed; repo-scoped GitHub binding)
[github]
integration = "GitHub (Personal)"   # matches GitHubIntegrationRecord.displayName (user scope, §1.1)
default_branch = "main"
webhook_events = ["pull_request", "check_run", "check_suite", "push"]
```

Environment variables use the `TERMINALX_*` prefix to match the existing codebase
(e.g. `TERMINALX_WORKTREES_ROOT` in `src/lib/git-worktree.ts`):

```typescript
// Environment variables (user/instance scope — NOT committed)
const GITHUB_SERVER_URL = process.env.TERMINALX_GITHUB_SERVER_URL || "https://github.com"; // GitHub Enterprise support
const TOKEN_MASTER_KEY = process.env.TERMINALX_GITHUB_TOKEN_MASTER_KEY; // 32-byte key for encryption (base64)
const WEBHOOK_BASE_URL = process.env.TERMINALX_GITHUB_WEBHOOK_BASE_URL; // e.g., https://terminalx.example.com

// JSON-file store: data/github-repositories.json (runtime cache of .terminalx/settings.toml).
// RepositoryConfig is the camelCased in-memory view of GitHubRepositoryRecord (§1.1).
export interface RepositoryConfig {
  id: string;
  integrationId: string;
  owner: string;
  name: string;
  fullName: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookId?: string;
  webhookEvents: WebhookEvent[];
  defaultBranch: string;
  isPrivate: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RepositoryConfigManager {
  /**
   * Register a repository with TerminalX
   */
  registerRepository(
    integrationId: string,
    owner: string,
    repo: string,
    config?: {
      webhookEvents?: WebhookEvent[];
    }
  ): Promise<RepositoryConfig>;

  /**
   * Get repository configuration
   */
  getRepository(repoId: string): Promise<RepositoryConfig | null>;

  /**
   * List repositories for integration
   */
  listRepositories(integrationId: string): Promise<RepositoryConfig[]>;

  /**
   * Update repository configuration
   */
  updateRepository(repoId: string, updates: Partial<RepositoryConfig>): Promise<RepositoryConfig>;

  /**
   * Unregister repository (delete webhooks)
   */
  unregisterRepository(repoId: string): Promise<void>;
}
```

### 6.2 Integration Lifecycle

```typescript
// src/app/api/github/integrations/route.ts
import { getUserScoping } from "@/lib/session-scope";
import { getUserByUsername, getUsers } from "@/lib/users";

// Resolve the acting User.id from request headers using the real auth helper.
// getUserScoping (src/lib/session-scope.ts) returns { username, role, shouldScope, hasIdentity }.
// In 'none'/'password' auth modes username is null (single-user / shared instance): we fall
// back to the default admin's id so integrations still get an owner. In 'local' mode we map
// the x-username header to a stable User.id via getUserByUsername (src/lib/users.ts).
function resolveUserId(req: NextRequest): string | null {
  const { username } = getUserScoping(req.headers);
  if (username) return getUserByUsername(username)?.id ?? null;
  // none/password mode: no per-user identity; attribute to the default admin account.
  return getUsers().find((u) => u.role === "admin")?.id ?? null;
}

export async function POST(req: NextRequest) {
  const userId = resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const { authType, token, appId, privateKey, webhookSecret, displayName, serverUrl } =
    await req.json();

  // 1. Validate token/app credentials
  const validation = await validateGitHubCredentials({
    authType,
    token,
    appId,
    privateKey,
    serverUrl: serverUrl || "https://github.com",
  });

  if (!validation.valid) {
    return NextResponse.json(
      { error: "Invalid GitHub credentials", details: validation.errors },
      { status: 400 }
    );
  }

  // 2. Store encrypted token
  const integrationId = await tokenVault.storeToken(
    userId,
    { token, appId, privateKey, webhookSecret },
    {
      displayName,
      githubServerUrl: serverUrl || "https://github.com",
      userAgent: req.headers.get("User-Agent") || "",
      // NextRequest has no `.ip` in the Next.js 16 App Router; derive from headers.
      ipAddress:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "unknown",
    }
  );

  // 3. Test API access (GET /user — §2.5a)
  const api = new GitHubAPI(integrationId, tokenVault);
  const user = await api.users.getAuthenticated();

  return NextResponse.json({
    integrationId,
    authenticatedAs: user.login,
    createdAt: new Date(),
  });
}

export async function GET(req: NextRequest) {
  const userId = resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const integrations = await tokenVault.listIntegrations(userId);

  return NextResponse.json({
    integrations: integrations.map(({ id, displayName, authType, enabled }) => ({
      id,
      displayName,
      authType,
      enabled,
    })),
  });
}

export async function DELETE(req: NextRequest) {
  const userId = resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const { integrationId } = await req.json();

  // Verify ownership against the JSON-store record's userId (== User.id, §1.1).
  const integration = await getIntegration(integrationId);
  if (!integration || integration.userId !== userId) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Remove all webhooks from registered repositories
  const repos = await listRepositories(integrationId);
  const api = new GitHubAPI(integrationId, tokenVault);
  for (const repo of repos) {
    if (repo.webhookId) {
      // WebhookAPI.deleteWebhook signature is (integrationId, owner, repo, webhookId) — §5.1.
      await api.webhooks.deleteWebhook(integrationId, repo.owner, repo.name, repo.webhookId);
    }
  }

  // Revoke token
  await tokenVault.revokeToken(integrationId);

  return NextResponse.json({ success: true });
}
```

---

## 7. Complete Example: PR Creation Flow

### 7.1 High-Level Flow

```
User Request
    ↓
1. Validate input (title, body, head, base)
    ↓
2. Authenticate (get token from vault)
    ↓
3. Verify branches exist
    ↓
4. Create PR (POST /repos/{owner}/{repo}/pulls)
    ├─ Rate limited? → Queue and retry
    ├─ Auth failed? → Notify user
    ├─ Validation error? → Return error details
    ├─ Success? → Continue
    ↓
5. Attach labels, assignees, reviewers
    ↓
6. (OPTIONAL, OFF BY DEFAULT) Post a "Created via TerminalX" PR comment
    ↓
7. Create webhook for status updates
    ↓
8. Return PR details to user
```

### 7.2 Implementation

```typescript
// src/lib/github/pr-workflow.ts

export interface CreatePRRequest {
  integrationId: string;
  owner: string;
  repo: string;
  title: string;
  body?: string;
  headBranch: string;
  baseBranch?: string;
  draft?: boolean;
  labels?: string[];
  assignees?: string[];
  requestReviewers?: string[];
}

export interface CreatePRResult {
  success: boolean;
  pullRequest?: PullRequest;
  error?: {
    code: GitHubErrorCode;
    message: string;
    userMessage: string; // User-friendly message
    nextSteps?: string[]; // Suggested actions
  };
  metadata?: {
    createdAt: Date;
    duration: number; // milliseconds
    retries: number;
  };
}

export async function createPullRequestFlow(
  input: CreatePRRequest,
  options?: {
    timeout?: number;
    enableWebhook?: boolean;
    postTerminalXComment?: boolean; // OFF by default; the review surface (§0.1) does NOT
    // require a bot comment on the PR. Opt-in only.
  }
): Promise<CreatePRResult> {
  const startTime = Date.now();
  let retries = 0;

  try {
    // 1. Validate input
    validateCreatePRInput(input);

    // 2. Get API client
    const api = new GitHubAPI(input.integrationId, tokenVault);

    // 3. Verify branches exist
    const [headBranch, baseBranch] = await Promise.all([
      api.repo
        .listBranches(input.owner, input.repo)
        .then((branches) => branches.find((b) => b.name === input.headBranch)),
      api.repo
        .listBranches(input.owner, input.repo)
        .then((branches) => branches.find((b) => b.name === (input.baseBranch || "main"))),
    ]);

    if (!headBranch) {
      return {
        success: false,
        error: {
          code: GitHubErrorCode.NOT_FOUND,
          message: `Head branch '${input.headBranch}' not found`,
          userMessage: `The branch '${input.headBranch}' does not exist in ${input.owner}/${input.repo}`,
          nextSteps: [
            "Check that you pushed the branch to GitHub",
            "Verify the branch name spelling",
          ],
        },
      };
    }

    if (!baseBranch) {
      return {
        success: false,
        error: {
          code: GitHubErrorCode.NOT_FOUND,
          message: `Base branch '${input.baseBranch || "main"}' not found`,
          userMessage: `The base branch does not exist`,
          nextSteps: ["Specify a different base branch", "Check repository settings"],
        },
      };
    }

    // 4. Create PR with retry logic
    let pullRequest: PullRequest | null = null;

    while (retries < 3 && !pullRequest) {
      try {
        pullRequest = await api.pulls.createPullRequest(input.owner, input.repo, {
          title: input.title,
          body: input.body,
          head: input.headBranch,
          base: input.baseBranch || "main",
          draft: input.draft,
          labels: input.labels,
          assignees: input.assignees,
          reviewers: input.requestReviewers,
        });
      } catch (err) {
        const apiError = err as GitHubAPIError;
        retries++;

        // Check if retryable
        if (!shouldRetry(apiError, retries)) {
          throw err;
        }

        // Calculate backoff
        const backoff = calculateBackoff(retries, {
          initialDelayMs: 2000,
          maxDelayMs: 120000,
          multiplier: 2,
          jitterFraction: 0.2,
        });

        console.log(`Retry ${retries}/3 after ${backoff}ms for PR creation`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    if (!pullRequest) {
      throw new Error("Failed to create PR after 3 retries");
    }

    // 5. Add additional metadata
    if (input.labels && input.labels.length > 0) {
      await api.pulls
        .updatePullRequest(input.owner, input.repo, pullRequest.number, {
          labels: input.labels,
        })
        .catch((err) => {
          console.error("Failed to add labels:", err);
          // Non-critical, continue
        });
    }

    // 6. (Optional, off by default) Post a "Created via TerminalX" PR comment.
    //    NOTE: createComment takes a string body (see §2.3 PullRequestAPI signature).
    if (options?.postTerminalXComment) {
      await api.pulls
        .createComment(
          input.owner,
          input.repo,
          pullRequest.number,
          formatPRComment(input, pullRequest)
        )
        .catch((err) => {
          console.error("Failed to create PR comment:", err);
        });
    }

    // 7. Set up webhook if enabled
    if (options?.enableWebhook) {
      // registerRepository returns a RepositoryConfig (§6.1); pull the string id out of it.
      const { id: repoId } = await registerRepository(input.integrationId, input.owner, input.repo);
      await createWebhookForPR(repoId, pullRequest.number);
    }

    // 8. Audit log
    await audit({
      userId: input.integrationId,
      action: "github.pr.created",
      resourceId: `${input.owner}/${input.repo}#${pullRequest.number}`,
      metadata: { title: input.title, draft: input.draft },
      timestamp: new Date(),
    });

    return {
      success: true,
      pullRequest,
      metadata: {
        createdAt: new Date(),
        duration: Date.now() - startTime,
        retries,
      },
    };
  } catch (err) {
    const apiError = err as GitHubAPIError;

    let userMessage = "Failed to create pull request";
    let nextSteps: string[] = [];

    switch (apiError.code) {
      case GitHubErrorCode.AUTHENTICATION_FAILED:
        userMessage = "GitHub authentication failed. Re-authenticate and try again.";
        nextSteps = ["Re-authenticate with GitHub"];
        break;
      case GitHubErrorCode.VALIDATION_ERROR:
        userMessage = `Validation error: ${apiError.message}`;
        nextSteps = ["Check branch protection rules", "Verify branch exists"];
        break;
      case GitHubErrorCode.RATE_LIMIT_EXCEEDED:
        userMessage = `Rate limited. Try again at ${apiError.rateLimitReset?.date}`;
        nextSteps = ["Request queued for automatic retry"];
        break;
      case GitHubErrorCode.SECONDARY_RATE_LIMIT:
        userMessage = "Too many requests. Request queued for retry.";
        nextSteps = ["Request has been queued and will retry automatically"];
        queue.enqueue(input.integrationId, "POST", `/repos/${input.owner}/${input.repo}/pulls`, {
          body: input,
        });
        break;
    }

    return {
      success: false,
      error: {
        code: apiError.code,
        message: apiError.message,
        userMessage,
        nextSteps,
      },
      metadata: {
        createdAt: new Date(),
        duration: Date.now() - startTime,
        retries,
      },
    };
  }
}

function validateCreatePRInput(input: CreatePRRequest): void {
  if (!input.title || input.title.trim().length === 0) {
    throw new Error("PR title is required");
  }
  if (input.title.length > 256) {
    throw new Error("PR title must be < 256 characters");
  }
  if (!input.headBranch || input.headBranch.trim().length === 0) {
    throw new Error("Head branch is required");
  }
  if (input.headBranch === input.baseBranch) {
    throw new Error("Head and base branches cannot be the same");
  }
}

function formatPRComment(input: CreatePRRequest, pr: PullRequest): string {
  return `
## Created via TerminalX

**Branch:** \`${input.headBranch}\` → \`${input.baseBranch || "main"}\`
**Link:** [View PR](${pr.html_url})

---
*Created at ${new Date().toISOString()} from TerminalX*
  `.trim();
}
```

### 7.3 API Endpoint

```typescript
// src/app/api/github/pull-requests/route.ts
import { getUserScoping } from "@/lib/session-scope";
import { getUserByUsername, getUsers } from "@/lib/users";

export async function POST(req: NextRequest) {
  // Same identity resolution as §6.2: getUserScoping(req.headers) -> username -> User.id,
  // falling back to the default admin in 'none'/'password' auth modes.
  const { username } = getUserScoping(req.headers);
  const userId = username
    ? (getUserByUsername(username)?.id ?? null)
    : (getUsers().find((u) => u.role === "admin")?.id ?? null);
  if (!userId) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const input = await req.json();

  // Validate user owns the integration (record.userId == User.id, §1.1).
  const integration = await getIntegration(input.integrationId);
  if (!integration || integration.userId !== userId) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const result = await createPullRequestFlow(
    { ...input, integrationId: input.integrationId },
    { enableWebhook: true }
  );

  if (!result.success) {
    return NextResponse.json(
      {
        error: result.error?.code,
        message: result.error?.userMessage,
        details: result.error?.message,
        nextSteps: result.error?.nextSteps,
      },
      { status: 400 }
    );
  }

  return NextResponse.json(
    {
      pullRequest: {
        id: result.pullRequest!.id,
        number: result.pullRequest!.number,
        url: result.pullRequest!.html_url,
        state: result.pullRequest!.state,
        createdAt: result.pullRequest!.created_at,
      },
      metadata: result.metadata,
    },
    { status: 201 }
  );
}
```

---

## 8. Summary & Implementation Roadmap

### Phase 1: Core Authentication (Week 1)

- [ ] Design TokenVault with encryption
- [ ] Implement PAT token storage
- [ ] Create auth endpoints (add/list/revoke)
- [ ] Test token rotation

### Phase 2: API Wrapper (Week 2-3)

- [ ] Implement GitHubAPIClient base class
- [ ] Add repository endpoints (list branches, commits)
- [ ] Add PR endpoints (create, get, update, list)
- [ ] Add check runs, statuses, reviews & review comments
- [ ] Add UI-facing aggregates: `derivePullRequestStatus`/`toPullRequestView` (§2.3a),
      `getChecksForSha` (§2.4), `getReviewSummary` (§2.5), `resolvePRForSession` (§2.7)

### Phase 3: Rate Limiting & Queuing (Week 4)

- [ ] Implement RateLimiter class
- [ ] Build RequestQueue with priority
- [ ] Add retry logic with exponential backoff
- [ ] Test rate limit scenarios

### Phase 4: Error Handling (Week 4)

- [ ] Classify all GitHub API errors
- [ ] Implement error recovery strategies
- [ ] Create user-friendly error messages
- [ ] Add audit logging

### Phase 5: Webhooks (Week 5)

- [ ] Design webhook registration
- [ ] Implement signature validation
- [ ] Add event handlers (PR, check-run)
- [ ] Test webhook deliveries

### Phase 6: Integration & Configuration (Week 5-6)

- [ ] Create management UI
- [ ] Add GitHub Enterprise support
- [ ] Implement configuration persistence
- [ ] Write documentation

### Phase 7: PR Workflow Example (Week 6)

- [ ] Complete PR creation flow
- [ ] Add PR commenting
- [ ] Integrate with sessions/logs
- [ ] E2E testing

---

## 9. Security Considerations

1. **Token Storage:**
   - Always encrypt tokens at rest (AES-256-GCM)
   - Use PBKDF2 for key derivation (100k iterations)
   - Rotate master key annually

2. **Webhook Security:**
   - Validate HMAC-SHA256 signature on every webhook
   - Use constant-time comparison to prevent timing attacks
   - Only process events from registered webhooks

3. **Audit Trail:**
   - Log all token access with timestamp, user, IP
   - Log all API calls with endpoint, method, status
   - Alert on suspicious patterns (many 401s, rate limits)

4. **Least Privilege:**
   - GitHub App permissions: `pull_requests:write`, `checks:write`
   - PAT scopes: `repo` (or `public_repo` for public only)
   - Rotate credentials every 90 days

5. **Rate Limit Protection:**
   - Never hammer API during rate limit resets
   - Use exponential backoff with jitter
   - Queue high-priority requests separately

---

## 10. Testing Strategy

```typescript
// src/lib/github/__tests__/api.test.ts

describe("GitHub API Client", () => {
  describe("Rate Limiting", () => {
    it("should queue request if rate limited", () => {});
    it("should wait until reset time before retrying", () => {});
    it("should handle secondary rate limit with Retry-After", () => {});
  });

  describe("Error Handling", () => {
    it("should not retry 401 AUTHENTICATION_FAILED", () => {});
    it("should retry 503 SERVICE_UNAVAILABLE with backoff", () => {});
    it("should provide user-friendly error messages", () => {});
  });

  describe("PR Creation", () => {
    it("should validate input before API call", () => {});
    it("should verify branches exist", () => {});
    it("should retry on transient errors", () => {});
    it("should attach metadata and webhooks", () => {});
  });

  describe("Token Management", () => {
    it("should encrypt tokens before storage", () => {});
    it("should decrypt and validate expiration", () => {});
    it("should rotate PAT tokens", () => {});
  });

  describe("Webhooks", () => {
    it("should validate HMAC-SHA256 signature", () => {});
    it("should reject unsigned webhooks", () => {});
    it("should dispatch to correct handler", () => {});
  });
});
```

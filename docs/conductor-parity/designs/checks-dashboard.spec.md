# TerminalX Checks Tab Specification

> Backs GitHub issue **#6**. This is the **"Checks" tab of the Review panel**, not a
> standalone page. It mirrors Conductor's review surface, where _All files_, _Changes_,
> _Checks_, and _Review_ are tabs of one panel attached to a session/PR.

## Overview

The **Checks tab** surfaces the CI runs, PR status checks, and aggregated status for the
branch attached to a TerminalX session. It lives inside the **Review panel** — the same
right-hand panel that hosts the diff viewer (_All files_ / _Changes_) and PR review
(_Review_). The tab consumes the GitHub status/check-run APIs defined in
`github-integration.spec.md` through a thin **status-aggregation endpoint** with caching so
the panel can poll cheaply without exhausting GitHub's rate limit.

This spec covers: the data model for an aggregated checks view, the aggregation API route
and its caching layer, the component tree of the tab within the Review panel, acceptance
criteria, and edge cases. It does **not** redefine the low-level GitHub client (`CheckRunAPI`,
`StatusAPI`, `PullRequestAPI`, `TokenVault`) — those are owned by `github-integration.spec.md`
and are consumed here.

---

## Conductor UI reference (from screenshots)

These are the authoritative Conductor UI facts this feature depends on. TerminalX mirrors
this surface; any naming/layout below that contradicts these is wrong.

- **The review surface is ONE panel with tabs**, attached to a session/PR:
  - **Top status bar:** `#1 ↗` (links to the PR) · a **status pill** (`Merged`, or
    `Open` / `Draft`) · a **`Continue`** button · a prominent **`Archive`** button.
  - **Tabs:** **`All files`** · **`Changes`** (with a count badge, e.g. `1`) ·
    **`Checks`** · **`Review`** (eye icon).
  - The **Checks tab is one of these tabs** — it is _not_ a separate top-level page and
    _not_ a sidebar entry. The diff viewer (_All files_ / _Changes_), this checks
    dashboard (_Checks_), and PR review (_Review_) are facets of the **same** panel, and
    their specs share the panel shell, status bar, and tab strip.
- **File rows (other tabs)** show a path with the filename emphasized (e.g.
  `.conductor/settings.toml`), an added-lines count (`+19`), and a small file/status icon.
- **Repo config is a committed TOML** (`.conductor/settings.toml`) with an
  _"Edit settings.toml"_ affordance on repo-scoped settings screens. TerminalX's analog is
  a committed repo config (`.terminalx/settings.toml`); see _Workspace config_ spec.
- **Per-workspace injected port** (`CONDUCTOR_PORT`) lets preview/run servers avoid
  collisions. TerminalX's analog is `TERMINALX_PORT` (see _Workspace config_ spec); it is
  relevant here only insofar as a locally-detected run/preview can be one source of status.
- **Code review uses a separate, independently-configured model** (Models settings →
  _Review model_ vs _Default model_). Not consumed by the Checks tab, but it is why the
  _Review_ tab is a distinct facet.

**TerminalX naming note:** where Conductor writes `.conductor/settings.toml` and
`CONDUCTOR_PORT`, TerminalX uses `.terminalx/settings.toml` and `TERMINALX_PORT`. New
artifacts in this spec use `TERMINALX_*` / `.terminalx/`.

---

## 1. Where the Checks tab lives

### 1.1 Panel shell (shared)

The Review panel is the session-attached right-hand panel. Its shell is shared across the
diff-viewer, pr-review, and checks specs:

```
┌──────────────────────────────────────────────────────────────┐
│  #6 ↗   [Open]   [Continue]                      [Archive]    │  ← status bar
├──────────────────────────────────────────────────────────────┤
│  All files | Changes ① | Checks | Review 👁                    │  ← tab strip
├──────────────────────────────────────────────────────────────┤
│                                                              ↻ │
│  (active tab content)                                          │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

- The **status bar** and **tab strip** (`All files | Changes | Checks | Review`) are owned
  by the shared review-surface shell defined in `github-integration.spec.md §0.1`. The
  pr-review spec implements the `Review` tab's content via `PRReviewPanel`
  (`src/components/pr/PRReviewPanel/`) but does **not** own the four-tab shell. This spec
  only owns the **`Checks` tab content** and the small **per-tab refresh control** (`↻`)
  shown top-right of the content area.
- The tab is keyed to the session via `sessionName`; the panel resolves the branch and
  PR from the session's worktree.

### 1.2 Resolving session → repo → branch → PR

The tab derives its target from the active session, reusing existing helpers (no new git
plumbing):

| Step             | Source                                                                                                                   | Notes                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Session metadata | `getMeta(sessionName)` → `SessionMeta` (`src/lib/ai-sessions.ts`)                                                        | `meta.worktree?.{ repoRoot, path, branch }` when the session was created on a worktree; else `meta.cwd`. |
| Repo + branch    | `getGitDirectoryInfo(dir)` (`src/lib/git-worktree.ts`) → `{ isRepo, root, branch, repoName }`                            | `dir` = `meta.worktree?.path ?? meta.cwd`.                                                               |
| owner/repo       | parse `git -C <root> remote get-url origin`                                                                              | Reuse GitHub integration's remote parser; `null` when no GitHub remote.                                  |
| PR               | `PullRequestAPI.listPullRequests(owner, repo, { head: \`${owner}:${branch}\`, state: 'all' })` (github-integration §2.3) | First open PR for the branch, else most-recent any-state. `owner`/`repo` are required positionals.       |

`SessionMeta` confirmed shape (`src/lib/ai-sessions.ts`):

```typescript
export interface SessionMeta {
  name: string;
  kind: SessionKind; // "bash" | "claude" | "codex"
  createdAt: string;
  createdBy?: string;
  managed?: boolean;
  cwd?: string;
  worktree?: { repoRoot: string; path: string; branch: string };
}
```

If `getGitDirectoryInfo(...).isRepo === false`, the tab renders the **"not a git repo"**
empty state and makes **no** API calls.

---

## 2. Data Model

The Checks tab aggregates three layers into a single view model. Low-level types
(`CheckRun`, `CheckStatus`, `CheckConclusion`, `PullRequest`) are **imported** from the
GitHub integration layer (`github-integration.spec.md`); they are re-stated here only for
reference. Legacy commit statuses come back from `StatusAPI.listStatuses` as an anonymous
array (github-integration has no named `CommitStatus` type and no combined-status rollup);
we alias that inline shape locally as `CommitStatus` for readability only.

### 2.1 Imported low-level types (owned by github-integration)

```typescript
// from github-integration.spec.md — DO NOT redefine here.
// (github-integration declares CheckStatus as an enum; the union below is shown for
//  reference only. The only locally-defined alias is `CommitStatus`, which names the
//  anonymous return shape of StatusAPI.listStatuses — see below.)
type CheckStatus = "queued" | "in_progress" | "completed";

enum CheckConclusion {
  SUCCESS = "success",
  FAILURE = "failure",
  NEUTRAL = "neutral",
  CANCELLED = "cancelled",
  TIMED_OUT = "timed_out",
  ACTION_REQUIRED = "action_required",
  SKIPPED = "skipped",
}

interface CheckRun {
  id: number;
  name: string;
  head_sha: string;
  status: CheckStatus;
  conclusion: CheckConclusion | null;
  started_at: string;
  completed_at: string | null;
  output?: { title: string; summary: string; text?: string; annotations?: CheckAnnotation[] };
  html_url: string;
  app?: { id: number; name: string };
}

// CheckRunAPI.listCheckRuns(owner, repo, ref, opts)         → CheckRun[]
// StatusAPI.listStatuses(owner, repo, ref)                  → CommitStatus[]   (legacy CI; inline shape below)
// PullRequestAPI.listPullRequests(owner, repo, options?)    → PullRequest[]   (owner/repo required)
// PullRequestAPI.getPullRequest(owner, repo, prNumber)      → PullRequest
//
// NOTE: github-integration has no `getCombinedStatus`/`CombinedStatus`. The rollup helper
// it actually exposes is `ChecksAggregateAPI.getChecksForSha(owner, repo, headSha)`
// (github-integration §2.4); this spec instead aggregates from the raw lists above (§3.2).
//
// `listStatuses` returns an anonymous array — there is NO named `CommitStatus` type in
// github-integration. We alias that inline shape locally for readability only:
type CommitStatus = {
  state: "pending" | "success" | "failure" | "error";
  description: string;
  context: string; // legacy check name (e.g. "ci/circleci: test")
  created_at: string;
  url: string; // link to the status's target/log
};
```

### 2.2 Aggregated view model (owned by this spec)

```typescript
// src/types/checks.ts

/** Normalized roll-up state used for the tab badge and the per-check rows. */
export type ChecksRollup =
  | "success" // every required check passed (or neutral/skipped)
  | "failure" // at least one check failed / timed_out / action_required
  | "pending" // at least one check queued/in_progress, none failed
  | "none" // no checks reported for the head SHA
  | "error" // we could not fetch (no GitHub token configured / rate-limit / network)
  | "no-repo" // session dir is not a git repo / no GitHub remote
  | "no-pr"; // repo+branch known, but no associated PR
// NOTE: stays in sync with `ChecksOverall` in github-integration §2.4 (same 7 members).
// "no GitHub token configured" is folded into `error` (with a "no-auth" reason + Connect
// hint) rather than a new union member, so the two specs keep one vocabulary.

/** One normalized row in the Checks tab (a check-run OR a legacy commit status). */
export interface ChecksItem {
  /** Stable key: `${kind}:${id}` */
  id: string;
  kind: "check-run" | "status";
  /** e.g. "build", "lint / node-20", "ci/circleci: test" */
  name: string;
  /** Normalized to the same vocabulary as ChecksRollup minus the meta states. */
  state: "success" | "failure" | "pending" | "neutral" | "skipped";
  /** GitHub's raw conclusion/status when available, for tooltips. */
  rawStatus: CheckStatus | "status";
  rawConclusion: CheckConclusion | null;
  /** App/source that produced the check, e.g. "GitHub Actions", "CircleCI". */
  source: string;
  /** Deep link to the run/log (check_run.html_url or commit-status `url`). */
  detailsUrl: string | null;
  /** Short summary line (check_run.output.title or status.description). */
  summary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** ms; null while pending. */
  durationMs: number | null;
}

/** The full payload the tab renders. */
export interface ChecksView {
  sessionName: string;
  repo: { owner: string; name: string } | null;
  branch: string | null;
  /** SHA the checks were evaluated against (PR head, else local HEAD). */
  headSha: string | null;
  pr: {
    number: number;
    title: string;
    state: "open" | "closed";
    isDraft: boolean;
    merged: boolean;
    htmlUrl: string;
  } | null;
  rollup: ChecksRollup;
  counts: { success: number; failure: number; pending: number; neutral: number; skipped: number };
  items: ChecksItem[];
  /**
   * Why rollup is "error"/"none"/etc., for the empty/error states. Stable discriminators
   * the client can switch on for tailored copy — e.g. "no-auth" (no GitHub token
   * configured → "Connect GitHub in Settings → Git"), "rate-limited", "upstream".
   */
  reason?: string;
  /** Cache + freshness metadata. */
  fetchedAt: string; // ISO; when the underlying GitHub calls ran
  cached: boolean;
  stale: boolean; // served from cache past soft-TTL while revalidating
  cachedUntil: string; // ISO; hard expiry
}
```

### 2.3 Normalization rules

- **Rollup precedence:** `error` > `no-repo`/`no-pr`/`none` (mutually exclusive by context)
  > `failure` > `pending` > `success`.
- A `CheckRun` with `status !== "completed"` → `state: "pending"`.
- `conclusion` mapping: `success`→success; `neutral`→neutral; `skipped`→skipped;
  `failure`/`timed_out`/`action_required`→failure; `cancelled`→failure (counts toward red
  badge but labelled "cancelled" in the row).
- Legacy commit statuses (`StatusAPI.listStatuses`, anonymous `CommitStatus` shape): map the
  `state` field — `success`→success, `pending`→pending, `error`/`failure`→failure. Use the
  status's `context` as `ChecksItem.name`, its `description` as `summary`, and its `url` as
  `detailsUrl`. Dedupe against check-runs by `name`/`context` (prefer the check-run).
- `durationMs = completed_at ? Date.parse(completed_at) - Date.parse(started_at) : null`.

---

## 3. API: status-aggregation endpoint

### 3.1 `GET /api/checks`

One endpoint returns the entire `ChecksView` for a session. This keeps the panel's polling
to a **single** request and lets the server own caching + rate-limit protection.

**Route file:** `src/app/api/checks/route.ts`

**Query params:**

| Param         | Required | Default | Meaning                                        |
| ------------- | -------- | ------- | ---------------------------------------------- |
| `sessionName` | yes      | —       | Session whose worktree/branch to evaluate.     |
| `force`       | no       | `false` | Bypass the soft cache and refetch from GitHub. |

**Auth / scoping:** reuse `getUserScoping(req.headers)` from `src/lib/session-scope.ts`
(confirmed signature: returns `{ username, role, shouldScope, hasIdentity }`). A non-admin
(`shouldScope && role !== "admin"`) may only read checks for a session they can access —
gate with `canAccessSession(username, role, sessionName)` from the same module. On failure
return `403`.

> **Response envelope (intentional new shape):** existing TerminalX routes use a flat
> `{ error: string }` (status in the HTTP code) and the files route's `{ type, data }`.
> `/api/checks` **intentionally** introduces a richer `{ status, code, message, data }`
> envelope because a single response must carry (a) a success/error discriminator, (b) a
> machine-readable `code` the client switches on for adaptive polling/backoff (§4.2), and
> (c) the full `ChecksView` payload even on degraded paths (stale cache on 429/502). This
> is the one new convention this spec adds on top of the existing patterns; everything else
> (status codes for auth/scoping, informational 200s) follows the existing routes. The flat
> `{ error }` shape is insufficient for the backoff + stale-serve behavior below.

**Success (200):**

```json
{
  "status": "success",
  "data": {
    "sessionName": "manish-screenshot-feature",
    "repo": { "owner": "terminalx", "name": "terminalx-app-mono" },
    "branch": "screenshot-feature-comparison",
    "headSha": "abc1234def5678",
    "pr": {
      "number": 6,
      "title": "Checks dashboard",
      "state": "open",
      "isDraft": false,
      "merged": false,
      "htmlUrl": "https://github.com/terminalx/terminalx-app-mono/pull/6"
    },
    "rollup": "pending",
    "counts": { "success": 3, "failure": 0, "pending": 1, "neutral": 0, "skipped": 1 },
    "items": [
      {
        "id": "check-run:99001",
        "kind": "check-run",
        "name": "build",
        "state": "success",
        "rawStatus": "completed",
        "rawConclusion": "success",
        "source": "GitHub Actions",
        "detailsUrl": "https://github.com/terminalx/terminalx-app-mono/actions/runs/99001",
        "summary": "Build succeeded",
        "startedAt": "2026-06-25T14:20:00Z",
        "completedAt": "2026-06-25T14:23:10Z",
        "durationMs": 190000
      },
      {
        "id": "check-run:99002",
        "kind": "check-run",
        "name": "e2e",
        "state": "pending",
        "rawStatus": "in_progress",
        "rawConclusion": null,
        "source": "GitHub Actions",
        "detailsUrl": "https://github.com/terminalx/terminalx-app-mono/actions/runs/99002",
        "summary": null,
        "startedAt": "2026-06-25T14:20:05Z",
        "completedAt": null,
        "durationMs": null
      }
    ],
    "fetchedAt": "2026-06-25T14:24:00Z",
    "cached": false,
    "stale": false,
    "cachedUntil": "2026-06-25T14:24:30Z"
  }
}
```

**Non-error informational states** still return `200` with a `data.rollup` of
`no-repo` / `no-pr` / `none` / `error` (with a `reason`). The client renders empty states,
not HTTP errors. **No configured GitHub token is one of these informational states**, not a
401: like a missing repo or a missing PR, it is a _configuration_ condition, not a failed
authentication of the caller's TerminalX session. TerminalX reserves `401` for
unauthenticated _sessions_ (`/api/auth/*`, `/api/telegram/webhook`); data/scoping routes use
`403` for access denial and `200`/`4xx` otherwise. So "no GitHub token" returns a `200`
informational rollup, consistent with the other empty states:

```json
// 200 — no GitHub token configured (TokenVault empty for this repo): informational, not 401
{
  "status": "success",
  "data": {
    "rollup": "error",
    "reason": "no-auth",
    "items": [],
    "counts": { "success": 0, "failure": 0, "pending": 0, "neutral": 0, "skipped": 0 }
    /* ...rest of an empty ChecksView; the client shows the "Connect GitHub in
       Settings → Git" hint from reason === "no-auth" */
  }
}
```

**Error responses** (reserved for genuine failures of _this_ request):

```json
// 400 — missing/invalid session name
{ "status": "error", "code": "INVALID_REQUEST", "message": "sessionName is required" }

// 403 — session not accessible to this user
{ "status": "error", "code": "FORBIDDEN", "message": "Session not accessible" }

// 429 — GitHub rate limit; serve last-known cached view if present
{ "status": "error", "code": "RATE_LIMITED", "retryAfter": 1800,
  "cached": true, "data": { /* last good ChecksView, stale:true */ } }

// 502 — GitHub upstream/network failure; serve stale cache if present
{ "status": "error", "code": "UPSTREAM_ERROR", "cached": true, "data": { /* stale */ } }
```

> Note: a token that was configured but is now **expired/revoked** mid-fetch surfaces as a
> genuine fetch failure on the GitHub call (handled like `502`/`error` with a Connect hint),
> whereas _no token at all_ is the `200` `no-auth` informational state above.

> **Auth model:** credentials come from the GitHub integration's **`TokenVault`**
> (`auth_type: "PAT" | "GITHUB_APP"`), _not_ a bare `GITHUB_TOKEN` env var. The Checks tab
> never sees the token; it calls the server route, which calls the GitHub client. This
> matches `github-integration.spec.md`.

### 3.2 Server flow (`src/app/api/checks/route.ts`)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getUserScoping, canAccessSession } from "@/lib/session-scope";
import { getMeta } from "@/lib/ai-sessions";
import { getGitDirectoryInfo } from "@/lib/git-worktree";
import { buildChecksView } from "@/lib/checks/aggregate";
import { checksCache, cacheKeyFor } from "@/lib/checks/cache";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionName = searchParams.get("sessionName")?.trim();
  const force = searchParams.get("force") === "true";

  if (!sessionName) {
    return NextResponse.json(
      { status: "error", code: "INVALID_REQUEST", message: "sessionName is required" },
      { status: 400 }
    );
  }

  const { username, role, shouldScope } = getUserScoping(req.headers);
  if (shouldScope && role !== "admin" && !canAccessSession(username, role, sessionName)) {
    return NextResponse.json(
      { status: "error", code: "FORBIDDEN", message: "Session not accessible" },
      { status: 403 }
    );
  }

  const meta = getMeta(sessionName);
  const dir = meta?.worktree?.path ?? meta?.cwd;
  const gitInfo = dir ? getGitDirectoryInfo(dir) : { isRepo: false as const };
  if (!gitInfo.isRepo) {
    return NextResponse.json({
      status: "success",
      data: emptyView(sessionName, "no-repo", "Session directory is not a git repository"),
    });
  }

  // No GitHub token for this repo is an *informational* state (like no-repo/no-pr), not a
  // 401 — TerminalX reserves 401 for unauthenticated sessions, not config gaps (§3.1).
  if (!(await hasGitHubToken(gitInfo.root!))) {
    return NextResponse.json({
      status: "success",
      data: emptyView(sessionName, "error", "no-auth"), // reason "no-auth" → Connect hint
    });
  }

  const key = cacheKeyFor(gitInfo.root!, gitInfo.branch ?? "HEAD");
  if (!force) {
    const hit = checksCache.get(key);
    if (hit) return NextResponse.json({ status: "success", data: { ...hit, cached: true } });
  }

  try {
    const view = await buildChecksView({ sessionName, gitInfo }); // calls GitHub client
    checksCache.set(key, view); // see §4 for TTL policy
    return NextResponse.json({ status: "success", data: view });
  } catch (err) {
    return handleChecksError(err, key); // 429 (+stale) / 502 (+stale); expired-token → 502/error
  }
}
```

`buildChecksView` (`src/lib/checks/aggregate.ts`) is the only place that talks to the
GitHub client. It:

1. Parses owner/repo from the origin remote (returns `no-repo` rollup if no GitHub remote).
2. Resolves the PR via
   `PullRequestAPI.listPullRequests(owner, repo, { head: \`${owner}:${branch}\`, state: 'all' })`(the 3-arg signature from github-integration §2.3 —`owner`/`repo`are required);
if none →`headSha`= local`git rev-parse HEAD`, `rollup`may still be`none`/`pending`.
3. Calls `CheckRunAPI.listCheckRuns(owner, repo, headSha)` and
   `StatusAPI.listStatuses(owner, repo, headSha)` **in parallel**.
4. Normalizes (§2.3) into `ChecksView`.

### 3.3 No new GitHub plumbing

This spec adds **no** new GitHub HTTP code. It depends entirely on the client surface in
`github-integration.spec.md`: `CheckRunAPI`, `StatusAPI`, `PullRequestAPI`, and `TokenVault`.
The only new server code is the **aggregation + caching** in `src/lib/checks/`. The
`hasGitHubToken(repoRoot)` check used in §3.2 is a thin lookup against the existing
`TokenVault` (presence of a `PAT`/`GITHUB_APP` credential for the repo's binding) — it adds
no new HTTP, just reads the vault the GitHub client already owns.

---

## 4. Caching strategy

GitHub's REST limits (5000 req/hr authenticated; lower for unauthenticated/secondary
limits) make naïve polling untenable. The Checks tab is read-mostly, so an in-memory,
SHA-keyed cache with stale-while-revalidate is sufficient.

### 4.1 In-memory cache

```typescript
// src/lib/checks/cache.ts
import type { ChecksView } from "@/types/checks";

interface Entry {
  view: ChecksView;
  storedAt: number;
}

const SOFT_TTL_MS = 30_000; // serve fresh within this window
const HARD_TTL_MS = 5 * 60_000; // after this, drop entirely

class ChecksCache {
  private map = new Map<string, Entry>();

  get(key: string): ChecksView | null {
    const e = this.map.get(key);
    if (!e) return null;
    const age = Date.now() - e.storedAt;
    if (age > HARD_TTL_MS) {
      this.map.delete(key);
      return null;
    }
    // Past soft TTL → return but mark stale so caller can revalidate.
    return { ...e.view, stale: age > SOFT_TTL_MS };
  }

  set(key: string, view: ChecksView): void {
    const now = Date.now();
    this.map.set(key, {
      view: {
        ...view,
        cached: false,
        stale: false,
        fetchedAt: new Date(now).toISOString(),
        cachedUntil: new Date(now + SOFT_TTL_MS).toISOString(),
      },
      storedAt: now,
    });
  }

  /** Drop entries for a repo/branch — called on branch change or session delete. */
  invalidate(key: string): void {
    this.map.delete(key);
  }
}

export const checksCache = new ChecksCache();

export function cacheKeyFor(repoRoot: string, branch: string): string {
  return `checks:${repoRoot}@${branch}`;
}
```

### 4.2 Adaptive TTL (pending vs settled)

When the latest view's `rollup === "pending"`, the **client** polls faster (the server's
soft TTL is fixed; the client decides when to ask). Recommended client cadence:

| Rollup                         | Client poll interval                                       | Notes                                               |
| ------------------------------ | ---------------------------------------------------------- | --------------------------------------------------- |
| `pending`                      | 15 s                                                       | A run is in flight; users expect quick transitions. |
| `success` / `failure` / `none` | 60 s                                                       | Settled; reduce noise.                              |
| `error`                        | exponential backoff 30 s → 5 m, max 3 attempts then manual | Avoid hammering on auth/limit errors.               |
| `no-repo` / `no-pr`            | no polling                                                 | Static until session/branch changes.                |

The server's soft TTL (30 s) means even a 15 s client poll mostly hits cache; only every
other pending poll reaches GitHub.

### 4.3 Invalidation triggers

- **Manual:** the per-tab `↻` button sends `force=true`.
- **Branch change:** when the panel detects the session's branch changed (HEAD moved to a
  new branch), it calls the route with `force=true`; the server overwrites the key.
- **Session deletion/termination:** the sessions route already removes worktrees; the
  checks cache entry simply ages out (hard TTL) — no cross-session leakage because keys are
  `repoRoot@branch`-scoped, not session-scoped.

### 4.4 Why not Redis / per-process only

TerminalX runs a single custom Node server (`server/index.ts`) fronting Next.js; there is
no multi-instance deployment in scope. An in-process `Map` is correct and matches existing
patterns (e.g. `log-streamer.ts` keeps streams in module-level maps). A distributed cache is
explicitly **out of scope** to avoid inventing infra the app doesn't have.

---

## 5. UI: the Checks tab content

### 5.1 Anatomy

The tab content is rendered **inside** the shared review-surface shell (status bar + tab
strip owned by `github-integration.spec.md §0.1`). The Checks tab owns only the content
region:

```
┌──────────────────────────────────────────────────────────────┐
│  All files | Changes ① | Checks ⏳ | Review 👁                  │  (shell tab strip)
├──────────────────────────────────────────────────────────────┤
│  Checks for screenshot-feature-comparison @ abc1234        ↻  │  ← header row
│  3 passed · 1 running · 1 skipped                              │  ← rollup summary
├──────────────────────────────────────────────────────────────┤
│  ✓  build            GitHub Actions   3m 10s          ↗        │
│  ⏳  e2e              GitHub Actions   running…        ↗        │
│  ✓  lint             GitHub Actions   42s             ↗        │
│  ✓  typecheck        GitHub Actions   1m 02s          ↗        │
│  ⊘  coverage         GitHub Actions   skipped         ↗        │
└──────────────────────────────────────────────────────────────┘
```

- **Tab label badge:** the tab strip shows a small state glyph next to `Checks`
  (`✓` success, `✗` failure, `⏳` pending, none when `none`/`no-pr`). The shell reads this
  from `ChecksView.rollup` (the panel may prefetch the rollup so the badge is correct even
  before the tab is opened).
- **Header row:** branch + short SHA + the per-tab refresh `↻`. `↻` spins while a forced
  refresh is in flight and shows "stale" styling when `view.stale`.
- **Rollup summary:** humanized counts from `view.counts`.
- **Rows:** one `ChecksRow` per `ChecksItem`, each a deep link (`↗`) to `detailsUrl`.

### 5.2 Status glyphs & colors (TerminalX dark palette)

Reuse the diff-viewer palette for consistency across the panel:

| State   | Glyph         | Color        | Hex       |
| ------- | ------------- | ------------ | --------- |
| success | ✓             | green accent | `#00ff88` |
| failure | ✗             | red accent   | `#ff5050` |
| pending | ⏳ (animated) | cyan accent  | `#5ccfe6` |
| neutral | ◷             | muted        | `#6b7569` |
| skipped | ⊘             | muted        | `#6b7569` |

### 5.3 Component tree

The review-surface shell (status bar + four-tab strip) is the shared surface defined in
`github-integration.spec.md §0.1`; the names of its host components are not yet fixed by a
sibling spec. The `Review` tab's content is implemented by pr-review's `PRReviewPanel`
(`src/components/pr/PRReviewPanel/`). This spec owns only the `ChecksTab` subtree below.

```
<review-surface shell>              (defined by github-integration §0.1 — host TBD)
├─ <status bar>                     (#6 ↗, status pill, Continue, Archive)
├─ <tab strip>                      (All files | Changes | Checks | Review)
│   └─ <badge glyph from ChecksView.rollup on the Checks tab>
└─ <active tab content>
    ├─ (Review tab → PRReviewPanel, owned by pr-review/01-ui-spec.md)
    └─ ChecksTab                    ← THIS SPEC (the Checks tab)
        ├─ ChecksHeader             (branch @ sha, refresh ↻)
        ├─ ChecksRollupSummary      (counts line)
        ├─ ChecksList
        │   └─ ChecksRow (×N)       (glyph, name, source, duration, ↗ link)
        └─ ChecksEmptyState         (no-repo | no-pr | none | error | loading)
```

> **Shell ownership:** if/when a sibling spec introduces concrete shell component names
> (e.g. a `ReviewPanel` / `ReviewTabStrip` host), this spec should plug `ChecksTab` into it.
> Until then, treat the shell as the abstract surface from github-integration §0.1 — do not
> invent shell component names here.

### 5.4 Component contracts

```typescript
// src/components/review/checks/ChecksTab.tsx
interface ChecksTabProps {
  sessionName: string;
  /** Provided by the panel shell so the tab and badge share one fetch. */
  view: ChecksView | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void; // forces force=true refetch
}

// src/components/review/checks/ChecksRow.tsx
interface ChecksRowProps {
  item: ChecksItem;
}

// src/components/review/checks/ChecksEmptyState.tsx
interface ChecksEmptyStateProps {
  rollup: Extract<ChecksRollup, "no-repo" | "no-pr" | "none" | "error">;
  reason?: string;
  onRetry?: () => void;
}
```

### 5.5 Client data hook

```typescript
// src/hooks/useChecks.ts
export function useChecks(sessionName: string | null): {
  view: ChecksView | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void; // force=true
} {
  // - GET /api/checks?sessionName=...
  // - adaptive polling interval per §4.2, keyed off view.rollup
  // - pauses polling when document.hidden (Page Visibility API) or tab not active
  // - cancels in-flight requests on sessionName change
}
```

> The hook is shared with the panel shell so the tab **badge** and tab **content** use one
> request, not two. The shell can call `useChecks` once and pass `view` down (§5.4).

---

## 6. Acceptance criteria

- [ ] The Checks dashboard appears **as the `Checks` tab inside the Review panel**, in the
      tab strip alongside `All files`, `Changes`, and `Review` — not as a sidebar item or a
      standalone route.
- [ ] Opening the Checks tab for a session shows the CI/check-run rows for the branch's head
      SHA, each linking out to the run (`↗ → detailsUrl`).
- [ ] A rollup summary line and a tab badge reflect aggregate state
      (success / failure / pending) derived from `ChecksView.rollup`.
- [ ] When a PR exists, `headSha` is the PR head; when no PR exists, it falls back to local
      `HEAD` and the tab still lists any check-runs/statuses on that SHA (or a `none` state).
- [ ] All GitHub data flows through `GET /api/checks`; the client never holds a token and
      never calls GitHub directly.
- [ ] Responses are cached server-side (soft 30 s / hard 5 m, SHA+branch keyed); a `↻`
      refresh sends `force=true` and bypasses the soft cache.
- [ ] Client polling is adaptive: 15 s while `pending`, 60 s when settled, paused when the
      tab/document is hidden.
- [ ] Rate-limit (429) and upstream (502) failures serve the last-good cached view marked
      `stale`, with a non-blocking "couldn't refresh" affordance — they never blank the tab.
- [ ] Non-admin users cannot read checks for sessions they can't access
      (`canAccessSession` gate returns 403).
- [ ] Empty states are distinct and actionable: `no-repo`, `no-pr`, `none` (no checks
      configured), and `error` (with retry / "Connect GitHub" hint).
- [ ] No GitHub client code is added here; the tab consumes `CheckRunAPI` / `StatusAPI` /
      `PullRequestAPI` / `TokenVault` from `github-integration.spec.md`.

---

## 7. Edge cases

| Case                                                                 | Behavior                                                                                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session has no worktree and no `cwd`                                 | `no-repo` rollup, empty state, zero API calls.                                                                                                           |
| Dir is a git repo but remote is not GitHub (e.g. self-hosted GitLab) | `no-repo` rollup with reason "No GitHub remote"; checks are GitHub-only in v1.                                                                           |
| Repo + branch known, no PR yet                                       | `no-pr` if the branch has no commits/SHA resolvable; otherwise list check-runs on local `HEAD` (rollup `none`/`pending`/etc.).                           |
| PR is merged                                                         | Status pill shows `Merged` (panel shell); Checks tab still shows the head-SHA checks (read-only, historical).                                            |
| PR is a draft                                                        | Pill shows `Draft`; checks behave normally.                                                                                                              |
| Check-run and legacy commit status share a name                      | Dedupe by `name`, prefer the check-run; surface the status only if no matching check-run.                                                                |
| A run is re-run / new commit pushed                                  | `headSha` changes → cache key (`repoRoot@branch`) holds, but the next non-cached fetch sees the new SHA; on branch HEAD move the panel forces a refresh. |
| GitHub returns hundreds of checks                                    | List virtualizes past 80 rows (matching diff-viewer.spec.md's `> 80` threshold; reuse its virtual-scroll approach); counts always reflect the full set.  |
| No GitHub token configured for the repo                              | `200` informational: `rollup: "error"`, `reason: "no-auth"`; empty state with "Connect GitHub in Settings → Git" (NOT a 401 — §3.1).                     |
| Token configured but expired / revoked                               | Genuine fetch failure on the GitHub call → handled like `502`/`error` (stale cache if present), empty state with "Connect GitHub in Settings → Git".     |
| Rate limited mid-poll                                                | Serve stale cache; client backs off (§4.2); `↻` shows "rate limited, retry in N min".                                                                    |
| User switches sessions rapidly                                       | `useChecks` cancels the in-flight request and refetches for the new `sessionName`; cache keys are per repo+branch so no cross-contamination.             |
| Tab hidden in background                                             | Polling paused via Page Visibility API; resumes (and immediately refetches if past soft TTL) on focus.                                                   |
| Network offline                                                      | `502 UPSTREAM_ERROR` path; stale cache served if present, else `error` empty state with retry.                                                           |

---

## 8. Files to add / touch

**New (this spec):**

```
src/types/checks.ts                              # ChecksView, ChecksItem, ChecksRollup
src/lib/checks/aggregate.ts                      # buildChecksView (consumes GitHub client)
src/lib/checks/cache.ts                          # ChecksCache, cacheKeyFor
src/app/api/checks/route.ts                      # GET /api/checks aggregation endpoint
src/hooks/useChecks.ts                           # client fetch + adaptive polling
src/components/review/checks/ChecksTab.tsx
src/components/review/checks/ChecksHeader.tsx
src/components/review/checks/ChecksRollupSummary.tsx
src/components/review/checks/ChecksList.tsx
src/components/review/checks/ChecksRow.tsx
src/components/review/checks/ChecksEmptyState.tsx
```

**Touched (owned by sibling specs — coordinate, don't fork):**

```
Review-surface shell (github-integration §0.1 tab-strip model)  # register the "Checks" tab + rollup badge in the strip
GitHub client (github-integration spec)  # consume CheckRunAPI / StatusAPI / PullRequestAPI / TokenVault
```

**Verified existing references used by this spec:**

| Symbol / path                                              | File                                         | Used for                                                                  |
| ---------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| `SessionMeta`, `getMeta`                                   | `src/lib/ai-sessions.ts`                     | session → worktree/cwd/branch                                             |
| `getGitDirectoryInfo`                                      | `src/lib/git-worktree.ts`                    | dir → `{ isRepo, root, branch, repoName }`                                |
| `getUserScoping`, `canAccessSession`                       | `src/lib/session-scope.ts`                   | auth gating on the route                                                  |
| `getTerminusRoot`, `resolveSafePath`                       | `src/lib/file-service.ts`                    | path safety (via worktree helpers)                                        |
| WS logs surface `/ws/logs/:encodedPath`, `log-streamer.ts` | `server/index.ts`, `src/lib/log-streamer.ts` | precedent for in-process maps; **not** used as a checks data source in v1 |

---

## 9. Out of scope (v1)

- Non-GitHub CI providers as first-class rows (CircleCI/GitLab appear only if they post
  GitHub commit statuses / check-runs).
- Re-running or cancelling checks from the tab (write actions live in pr-review's controls,
  gated on `checks:write`).
- Session-log "error/warning" aggregation. The earlier draft folded local log scraping into
  this tab; that conflates the **Checks** tab (CI/PR status) with terminal logs. Local logs
  remain on the existing logs surface (`/ws/logs/:encodedPath`, `src/app/api/logs`).
- A distributed cache (Redis). Single-process in-memory cache only.
- A separate `/api/checks/health` endpoint and a generic per-source REST fan-out
  (`/api/checks/git|ci|pr|logs`). v1 is one aggregation endpoint.

---

## 10. Relationship to sibling specs

| Spec                              | Shared surface                                                                                                                       | Contract                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `github-integration.spec.md` §0.1 | Review-surface shell: status bar (`#N ↗`, status pill, Continue, Archive) + the `All files \| Changes \| Checks \| Review` tab strip | **Owns the shell + tab-strip model**; this spec registers the `Checks` tab + badge inside it.                                   |
| `pr-review/01-ui-spec.md`         | The `Review` tab's content (`PRReviewPanel`, `src/components/pr/PRReviewPanel/`)                                                     | Owns the Review-tab content/workflow only — not the four-tab shell (that's github-integration §0.1).                            |
| `diff-viewer.spec.md`             | `All files` / `Changes` tabs of the same panel; color palette; virtual scroll                                                        | This tab reuses the palette and virtualization approach.                                                                        |
| `github-integration.spec.md`      | `CheckRunAPI`, `StatusAPI`, `PullRequestAPI`, `CheckRun`/`CheckStatus`/`CheckConclusion`, `TokenVault`                               | This spec **consumes** these; adds no GitHub HTTP code.                                                                         |
| `workspace-config.spec.md`        | `.terminalx/settings.toml`, `TERMINALX_PORT`                                                                                         | Repo-config + injected-port analogs (Conductor's `.conductor/settings.toml` / `CONDUCTOR_PORT`); referenced for grounding only. |

```

```

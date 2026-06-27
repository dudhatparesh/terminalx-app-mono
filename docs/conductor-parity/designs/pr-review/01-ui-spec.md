# TerminalX PR Review & Create Specification (the "Review" tab of the Review panel)

**Version:** 2.0
**Backs:** GitHub issue **#8** (PR review)
**Tech stack:** Next.js 16 App Router + custom Node server (`server/index.ts`), React 19,
shadcn/ui, Tailwind CSS 4, `react-resizable-panels` ^4.11.0, TypeScript

---

## Overview

PR review is **not a standalone page and not a modal**. It is the **"Review" tab (eye icon)
of TerminalX's Review panel** — the same session-attached right-hand panel that hosts the
diff viewer (_All files_ / _Changes_) and the checks dashboard (_Checks_). The panel is a
single tabbed surface with a shared top status bar (PR `#n ↗`, a Merged/Open/Draft/Closed
pill, **Continue**, **Archive**). The PR-review feature owns the **Review** tab: line-anchored
inline comment threads, the per-reviewer approval rollup, and the **Create PR** flow that
fills the status bar's `#n` slot when the session's branch has no PR yet.

This is the TerminalX analog of **Conductor's review/diff panel**. The diff viewer
([`diff-viewer.spec.md`](../diff-viewer.spec.md)), checks dashboard
([`checks-dashboard.spec.md`](../checks-dashboard.spec.md)), PR review (this spec), and
archive ([`archive-cleanup.spec.md`](../archive-cleanup.spec.md)) are **facets of one panel**
and MUST agree on its shell. The panel shell — the tab strip, status bar, and file-row
layout — is defined and owned by [`diff-viewer.spec.md`](../diff-viewer.spec.md) §4
(`ReviewPanel`, `ReviewStatusBar`, `ReviewTabs`); this spec **consumes** that shell and only
adds the **Review** tab body and the Create-PR entry point.

All GitHub data contracts consumed here — `PullRequestView`, `Review`, `ReviewComment`,
`ReviewThread`, `ReviewSummary`, the `ReviewAPI`, and `resolvePRForSession` — are owned by
[`github-integration.spec.md`](../github-integration.spec.md) §2.3–§2.7. This spec does not
redefine them; it renders them.

---

## Conductor UI reference (from screenshots)

The authoritative Conductor UI facts this feature depends on, captured from the Conductor
screenshots. Anything that contradicts these is wrong.

### The Review / Diff panel (right-hand, attached to a session)

- **Top status bar (single row), shared across all tabs:**
  - **`#1 ↗`** — the PR number, linking out to the PR on GitHub (`html_url`). When the
    session's branch has **no** PR yet, this slot shows a **Create PR** affordance instead.
  - A **status pill** — `Merged` in the capture; can also be `Open` / `Draft` / `Closed`.
    This is a single **derived** value, not the raw GitHub `state`
    (`derivePullRequestStatus`, github-integration §2.3a).
  - A **`Continue`** button — returns to the session's chat/terminal.
  - A prominent **`Archive`** button — archives the workspace (see
    [`archive-cleanup.spec.md`](../archive-cleanup.spec.md), issue #9).
- **Tab row** (directly under the status bar):
  - **`All files`** — the full file tree of the workspace.
  - **`Changes`** with a **count badge** (e.g. `1`) — the diff viewer
    ([`diff-viewer.spec.md`](../diff-viewer.spec.md)).
  - **`Checks`** — CI/status dashboard
    ([`checks-dashboard.spec.md`](../checks-dashboard.spec.md)).
  - **`Review`** with an **eye icon** — the PR review surface (**this spec**).
- **File rows** (in `Changes` / `All files`): path with the **filename emphasized** (e.g.
  `.conductor/settings.toml` renders the directory muted and `settings.toml` bright), an
  **added-lines count** styled like **`+19`**, and a small **file/status icon**. The Review
  tab reuses the same file-row presentation for its per-file thread groups.
- The session chat references workspace setup: an **`.env`** copied "if you have one", and a
  per-workspace injected **`CONDUCTOR_PORT`** so preview/run servers don't conflict.

### Settings scope (relevant to repo binding)

Conductor splits settings into **User** vs **Repo** scope tabs; repo-scoped config is a
**committed TOML** (`.conductor/settings.toml`) edited via a top-right **"Edit
settings.toml"** button. The repo↔GitHub binding the Create-PR flow needs (owner/repo,
default base branch) lives there.

### Naming note (Conductor → TerminalX)

| Conductor                  | TerminalX analog                            | Source of truth                        |
| -------------------------- | ------------------------------------------- | -------------------------------------- |
| `.conductor/settings.toml` | `.terminalx/settings.toml`                  | new artifact (workspace-config track)  |
| `CONDUCTOR_PORT`           | `TERMINALX_PORT` (injected per workspace)   | new artifact (workspace-config track)  |
| review/diff panel          | `ReviewPanel` (replaces `RightPanel.tsx`)   | `diff-viewer.spec.md` §4 (shell owner) |
| worktree per workspace     | `git-worktree.ts` (`.terminalx-worktrees/`) | `src/lib/git-worktree.ts` (verified)   |

> **Conductor also exposes review actions to agents** via an MCP `DiffComment` tool (leave a
> comment on a line of the workspace diff) and `GetWorkspaceDiff`. TerminalX's inline-comment
> store (§3) is the same data an equivalent MCP surface would write to; this spec models the
> store so a future agent tool and the human UI share it.

---

## 1. Codebase grounding (verified)

Every reference below was confirmed by reading the repo.

| Symbol / path                                                                                         | Where                                     | Used for                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionMeta` (`.worktree?: { repoRoot, path, branch }`)                                              | `src/lib/ai-sessions.ts:8`                | The review target: a session's worktree branch is the JOIN KEY to a PR (`PullRequest.head.ref`).                                                                                                     |
| `getMeta(name)`                                                                                       | `src/lib/ai-sessions.ts:82`               | Resolve the session's worktree/branch for the active review.                                                                                                                                         |
| `getGitDirectoryInfo(directory)` → `{ isRepo, root, branch, repoName }`                               | `src/lib/git-worktree.ts:72`              | Fallback repo/branch resolution when no worktree is recorded; default-base detection for Create-PR.                                                                                                  |
| `validateGitBranchName(raw)`                                                                          | `src/lib/git-worktree.ts:97`              | Validate `head`/`base` branch names in the Create-PR form before hitting GitHub.                                                                                                                     |
| `getUserScoping(headers)` → `{ username, role, shouldScope, hasIdentity }`                            | `src/lib/session-scope.ts:33`             | Identity/scope gate, matching every existing API route.                                                                                                                                              |
| `canAccessSession(username, role, sessionName)`                                                       | `src/lib/session-scope.ts:7`              | Per-session authorization in multi-user mode.                                                                                                                                                        |
| `RightPanel` (tabs: `All files` / `Logs` / `Snippets`)                                                | `src/components/layout/RightPanel.tsx:15` | The component **replaced** by `ReviewPanel` (owned by `diff-viewer.spec.md`); the Review tab mounts inside it.                                                                                       |
| `AppShell`                                                                                            | `src/components/layout/AppShell.tsx`      | **The host.** Mounts `RightPanel` (line 231) inside a fixed-width right `<aside>` (`w-[360px]`, `2xl:w-[400px]`); `ReviewPanel` replaces it there, scoped to `activeSession` (resolved at line 210). |
| `GET /api/files` (admin gate: `!hasIdentity \|\| role !== 'admin'` → **403 "Admin access required"**) | `src/app/api/files/route.ts:8`            | Reference for sanitized errors; note it is **admin-only**, **not** 401, and does **not** use per-session scoping.                                                                                    |
| `DELETE /api/sessions/[name]` (`getUserScoping` → `shouldScope && canAccessSession` → **403**)        | `src/app/api/sessions/[name]/route.ts:28` | The established **per-session** auth pattern the review routes follow. **No route returns 401.**                                                                                                     |

> **Corrections vs the prior (blind) draft.** The earlier version of this file invented:
> a standalone **`PRCreationModal`** + **`PRReviewPanel`** as a two-pane page with its own
> left file sidebar and right diff; a **`usePRReviewStore` / `usePRCreateStore`** Zustand
> pair with `persist` to **localStorage**; an **IndexedDB** comment database
> (`terminalx-pr-review`, object stores, a `CommentSyncService` with a 30s background
> scheduler and conflict-resolution strategies); a custom **OAuth web flow**
> (`/api/auth/github/callback`, `@octokit/oauth-app`, HttpOnly cookie); a custom **`/api/github/repos/:owner/:repo/...`** route family; and **401** responses throughout. **None of
> that matches the real Conductor UI or the TerminalX repo.** PR review is the **Review tab**
> of the shared `ReviewPanel`; the diff already exists in the **Changes** tab; PR/comment data
> contracts and the GitHub client live in `github-integration.spec.md` (no bespoke OAuth, no
> per-repo route family); auth is the repo's **403-not-401** per-session pattern; and there is
> **no IndexedDB** — draft comments persist server-side per session (§6.2). See
> [`00-corrections.md`](./00-corrections.md) for the full contradiction list across `02`–`05`.

---

## 2. Where the Review tab lives

### 2.1 Panel shell (shared, owned by `diff-viewer.spec.md`)

```
ReviewPanel                          // src/components/review/ReviewPanel.tsx (replaces RightPanel)
├── ReviewStatusBar                  // shared shell — owned by diff-viewer.spec.md §4.1
│   ├── PrLink       "#1 ↗"          //   OR <CreatePrButton/> when link.pr === null  (§5)
│   ├── StatusPill   "Merged"        //   Open | Draft | Merged | Closed
│   ├── ContinueButton "Continue"
│   └── ArchiveButton  "Archive"
├── ReviewTabs                       // shared shell — owned by diff-viewer.spec.md §4.2
│   ├── Tab "All files"              // → FileBrowser (existing)
│   ├── Tab "Changes" + CountBadge   // → ChangesTab        (diff-viewer.spec.md)
│   ├── Tab "Checks"                 // → ChecksTab         (checks-dashboard.spec.md)
│   └── Tab "Review" (Eye icon)      // → ReviewTab         (THIS SPEC)
└── <active tab body>
    └── ReviewTab                    // src/components/review/ReviewTab.tsx  (THIS SPEC)
```

The Review tab renders **inline**, in the same `w-[360px]`/`2xl:w-[400px]` column as the
other tabs — it does **not** open a modal or a routed page. It is intentionally a **narrow,
single-column** surface (no second file sidebar); file grouping is achieved with collapsible
file headers, not a split layout. (Split/side-by-side rendering of the underlying diff lives
in the **Changes** tab; the Review tab shows the relevant hunk inline per thread.)

### 2.2 Tab body states

| state                       | when                                                           | body                                                                                                            |
| --------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **no PR**                   | `link.pr === null`                                             | Empty state: "No pull request for this branch." + **Create PR** button (mirrors the status-bar affordance, §5). |
| **PR, no reviews/comments** | `summary.threads.length === 0 && summary.reviews.length === 0` | "No review activity yet." + a **Start review** composer (§4.4).                                                 |
| **PR with activity**        | otherwise                                                      | Review header (decision rollup) → per-file thread groups → review composer.                                     |
| **loading**                 | fetch in flight                                                | Skeleton rows.                                                                                                  |
| **error**                   | fetch failed                                                   | Inline error + Retry (never leaks paths; see §6).                                                               |

---

## 3. Data model

The **rendered** review data (`Review`, `ReviewComment`, `ReviewThread`, `ReviewSummary`,
`ReviewDecision`) is **owned by `github-integration.spec.md` §2.5** and imported, not
redefined:

```typescript
// from github-integration.spec.md §2.5 — DO NOT redefine here
import type {
  Review, // per-reviewer review (APPROVED | CHANGES_REQUESTED | COMMENTED | ...)
  ReviewComment, // a single line-anchored GitHub PR review comment
  ReviewThread, // grouped (path,line,side) thread: comments[0] is root, rest are replies
  ReviewSummary, // { prNumber, decision, reviews, threads }
  ReviewDecision, // 'approved' | 'changes_requested' | 'review_required' | 'pending'
  PullRequestView, // status-bar projection (#n, htmlUrl, status pill, head/base, counts)
} from "@/lib/github/types";
```

What **this spec adds** is the **TerminalX-local draft layer** — comments composed in the UI
that are not yet posted to GitHub — plus the per-session review session-state. These are the
only new types.

`src/types/pr-review.ts` (new):

```typescript
/** A comment the user is composing/has saved but not yet posted to GitHub. */
export interface DraftComment {
  /** Stable local id: `draft:${sessionName}:${path}:${line}:${nonce}`. */
  id: string;
  sessionName: string; // the session whose review this draft belongs to
  path: string; // repo-relative file path (matches FileDiff.path)
  line: number; // new-side line number being annotated
  side: "LEFT" | "RIGHT"; // which side of the diff the line is on
  /** When set, this draft is a reply to an existing GitHub review-comment thread. */
  inReplyToId?: number; // ReviewComment.id of the thread root
  body: string; // markdown, unposted
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** A draft top-level review not yet submitted (batches drafts into one GitHub review). */
export interface DraftReview {
  sessionName: string;
  body: string; // overall review summary (markdown)
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  drafts: DraftComment[]; // line comments included in this submission
}

/** Merge of GitHub-posted threads + local drafts, for a single (path,line) anchor. */
export interface MergedThread {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  resolved: boolean; // from ReviewThread.resolved (TerminalX-tracked)
  /** Posted comments (from GitHub) followed by any local draft replies, in order. */
  comments: ReviewComment[];
  draftReplies: DraftComment[];
}

/** The full payload the Review tab renders. */
export interface ReviewTabModel {
  pr: PullRequestView | null; // null => Create-PR empty state (§2.2)
  decision: ReviewDecision; // from ReviewSummary.decision
  reviews: Review[]; // per-reviewer rollup
  /** Posted threads grouped by file path, drafts merged in. */
  byFile: Array<{ path: string; filename: string; dir: string; threads: MergedThread[] }>;
  draftCount: number; // total unposted DraftComments for this session
}
```

### 3.1 PR-create form state

```typescript
export interface CreatePrForm {
  sessionName: string;
  base: string; // default: repo default branch (getGitDirectoryInfo / settings.toml)
  head: string; // default: SessionMeta.worktree.branch (read-only, the session's branch)
  title: string; // default: branch-derived; max 256 (GitHub limit), counter at 72
  body: string; // markdown
  draft: boolean; // create as draft PR
  reviewers: string[]; // GitHub logins (optional)
  errors: Partial<Record<"base" | "head" | "title", string>>;
}
```

The Create-PR flow maps directly to `PullRequestAPI.createPullRequest(owner, repo, input)`
in github-integration §2.3 — TerminalX does **not** implement its own `octokit.pulls.create`.

---

## 4. Review tab — component tree

```
ReviewTab                              // src/components/review/ReviewTab.tsx
├── ReviewHeader                       // decision rollup + reviewer avatars
│   ├── DecisionPill   approved | changes_requested | review_required | pending
│   └── ReviewerRow    (avatar + per-reviewer state)
├── DraftBanner                        // shown when draftCount > 0: "N pending comments · Submit review"
├── FileThreadGroup  (per byFile[])    // collapsible, reuses the file-row presentation
│   ├── FileThreadHeader               // muted dir + emphasized filename + thread count
│   └── ThreadCard   (per MergedThread)
│       ├── DiffHunkContext            // the anchored hunk (ReviewComment.diff_hunk), read-only
│       ├── CommentItem  (per comment) // avatar, @login, relative time, markdown body
│       ├── DraftReplyItem (per draft) // same layout + a "Pending" affordance + Edit/Discard
│       ├── ResolveToggle              // resolve/unresolve (TerminalX-tracked, §4.3)
│       └── ReplyComposer              // textarea → adds a DraftComment(inReplyToId=root.id)
└── ReviewComposer                     // overall review body + Approve / Request changes / Comment
```

### 4.1 `ReviewHeader` — decision rollup

Renders `ReviewSummary.decision` (latest review per user wins; rule lives in the data layer):

| decision            | pill label          | tone              |
| ------------------- | ------------------- | ----------------- |
| `approved`          | "Approved"          | success `#00ff88` |
| `changes_requested` | "Changes requested" | danger `#ff5050`  |
| `review_required`   | "Review required"   | muted `#6b7569`   |
| `pending`           | "Pending"           | neutral `#5ccfe6` |

Reviewer avatars come from `Review.user`; a reviewer's pill state is their latest review
`state`. This is read-only — the rollup is computed by the data layer, not the component.

### 4.2 Inline comment store (drafts)

A new comment is composed **against a diff line** and saved as a `DraftComment` keyed by
`(sessionName, path, line, side)`. The store is a thin client-side cache backed by a
**server-persisted** draft list (§6.2) so drafts survive a panel remount or reload without
IndexedDB:

```typescript
// src/hooks/usePrReviewDrafts.ts (new)
export function usePrReviewDrafts(session: string) {
  // GET  /api/sessions/[name]/review/drafts        → DraftComment[] + DraftReview
  // PUT  /api/sessions/[name]/review/drafts/[id]    → upsert a draft
  // DELETE /api/sessions/[name]/review/drafts/[id]  → discard a draft
  // returns { drafts, draftReview, upsert, discard, count, loading, error }
}
```

A draft renders immediately (optimistic), tagged **Pending** (amber `#ffb454`), and is merged
into the matching `MergedThread` (or a new draft-only thread for a fresh line) by
`mergeDrafts(summary, drafts)` in the tab.

### 4.3 Resolve / unresolve

GitHub's REST API does not expose review-thread resolution, so `ReviewThread.resolved` is
**TerminalX-tracked** (noted in github-integration §2.5). The `ResolveToggle` flips a flag
stored alongside the session's review state (§6.2); it is purely a local review-progress aid
and is never posted to GitHub. (A future GraphQL path could sync it; out of scope here.)

### 4.4 `ReviewComposer` — submit a review

Batches the session's `DraftComment[]` into **one** GitHub review via
`ReviewAPI.createReview(owner, repo, prNumber, { body, event, comments })`
(github-integration §2.5). The composer's three buttons map to the `event`:

- **Comment** → `event: "COMMENT"`
- **Approve** → `event: "APPROVE"`
- **Request changes** → `event: "REQUEST_CHANGES"`

`comments` is `drafts.map(d => ({ path: d.path, line: d.line, body: d.body }))`. Drafts that
are **replies** (`inReplyToId` set) are posted separately via
`ReviewAPI.replyToReviewComment(...)` before/after the review, since GitHub's
`createReview.comments` only creates new threads. On success the server clears the submitted
drafts and the tab refetches `ReviewSummary`.

> **Single-comment fast path.** A reply or a lone line comment can be posted immediately
> (skip the review batch) via the reply endpoint or a one-comment `createReview({event:"COMMENT"})`. The composer's "Submit review" is the batch path; the per-thread **Reply**
> button uses the fast path.

---

## 5. Create-PR flow

When `resolvePRForSession(...)` returns `pr: null` (github-integration §2.7), both the status
bar's `#n` slot and the Review tab's empty state show **Create PR**. It opens a **`Dialog`**
(shadcn `Dialog`, dark theme) — this is the _one_ legitimate modal in the feature, and it is
the create form only, **not** the review surface.

```
CreatePrDialog                         // src/components/review/CreatePrDialog.tsx
├── BranchRow      base ⇽ head         // head = session branch (read-only); base = Select(default)
├── TitleField     (counter, soft 72)
├── BodyField      (Textarea, markdown hint)
├── ReviewersField (optional logins)
├── DraftCheckbox  "Create as draft"
└── Footer         [Cancel] [Create pull request]
```

Behavior:

1. `head` is `SessionMeta.worktree.branch` (read-only — you create a PR _for this session's
   branch_). `base` defaults to the repo default branch (`getGitDirectoryInfo(repoRoot).branch`
   of the main checkout, or `.terminalx/settings.toml`'s configured default).
2. Validate `head`/`base` with `validateGitBranchName` and `head !== base` **before** the
   network call; surface errors inline (no GitHub round-trip for trivially invalid input).
3. Submit → `POST /api/sessions/[name]/pr` (§7.3) → server calls
   `createPullRequest(owner, repo, { title, body, head, base, draft, reviewers })`.
4. On success: close the dialog, the status bar paints `#n ↗` + the **Open**/**Draft** pill,
   and the Review tab switches to its "PR, no reviews yet" state. The `owner/repo` binding
   comes from the repo's `.terminalx/settings.toml` (workspace-config track).

---

## 6. API design

All routes are **session-scoped** under `/api/sessions/[name]/...`, following the verified
pattern of `DELETE /api/sessions/[name]` — `getUserScoping(req.headers)` →
`if (shouldScope && (!username || !canAccessSession(username, role, name))) → 403` — with
sanitized errors mirroring `GET /api/files`. **No route returns 401** (the repo uses 403
throughout). The server resolves `owner/repo` + the session's PR via
`resolvePRForSession(...)` and delegates all GitHub calls to the `GitHubAPI` client from
`github-integration.spec.md`; these routes are the **thin TerminalX-side wrapper**, not a
re-implementation of the GitHub REST surface.

### 6.1 `GET /api/sessions/[name]/review` — the Review tab payload

Resolves the session's PR (§2.7), then composes `ReviewAggregateAPI.getReviewSummary(...)`
with the session's local drafts/resolution state into a `ReviewTabModel`.

**200:**

```json
{
  "pr": {
    "number": 1,
    "htmlUrl": "https://github.com/o/r/pull/1",
    "title": "Add settings",
    "status": "open",
    "headBranch": "feature-x",
    "headSha": "9f2c…",
    "baseBranch": "main",
    "changedFiles": 1,
    "additions": 19,
    "deletions": 0
  },
  "decision": "review_required",
  "reviews": [
    {
      "id": 55,
      "user": { "login": "alice", "avatar_url": "…" },
      "state": "CHANGES_REQUESTED",
      "submitted_at": "…",
      "commit_id": "9f2c…"
    }
  ],
  "byFile": [
    {
      "path": ".terminalx/settings.toml",
      "filename": "settings.toml",
      "dir": ".terminalx/",
      "threads": [
        {
          "path": ".terminalx/settings.toml",
          "line": 12,
          "side": "RIGHT",
          "resolved": false,
          "comments": [
            {
              "id": 901,
              "user": { "login": "alice" },
              "body": "Port should be configurable",
              "path": ".terminalx/settings.toml",
              "line": 12,
              "side": "RIGHT",
              "diff_hunk": "@@ -10,3 +10,6 @@",
              "in_reply_to_id": null
            }
          ],
          "draftReplies": []
        }
      ]
    }
  ],
  "draftCount": 0
}
```

When the branch has no PR: `{ "pr": null, "decision": "pending", "reviews": [], "byFile": [], "draftCount": 0 }` (drives the Create-PR empty state).

### 6.2 Draft routes (local, server-persisted)

| route                                      | method   | body              | effect                                                         |
| ------------------------------------------ | -------- | ----------------- | -------------------------------------------------------------- |
| `/api/sessions/[name]/review/drafts`       | `GET`    | —                 | `{ drafts: DraftComment[], draftReview: DraftReview \| null }` |
| `/api/sessions/[name]/review/drafts/[id]`  | `PUT`    | `DraftComment`    | upsert a draft comment/reply                                   |
| `/api/sessions/[name]/review/drafts/[id]`  | `DELETE` | —                 | discard a draft                                                |
| `/api/sessions/[name]/review/draft-review` | `PUT`    | `{ body, event }` | set the pending review summary/event                           |

Drafts are stored per session in `data/pr-review/<session>.json` (same `data/` + locked-write
convention as `src/lib/ai-sessions.ts`), **not** IndexedDB. No GitHub call is made by these
routes.

### 6.3 `POST /api/sessions/[name]/pr` — create the PR

Body: `{ title, body, base, head, draft, reviewers }`. Validates branch names server-side,
then calls `createPullRequest(...)`. Returns the new `PullRequestView`. Errors map to the
sanitized shape (validation/branch-protection → 422 surfaced as a user message; missing branch
→ 404; auth/scope → 403).

### 6.4 `POST /api/sessions/[name]/review/submit` — submit the batched review

Body: `{ event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES", body }`. Reads the session's
drafts, posts new-thread comments + the review via `createReview(...)`, posts reply drafts via
`replyToReviewComment(...)`, clears submitted drafts, and returns the refreshed
`ReviewSummary`.

### 6.5 Implementation sketch

`src/app/api/sessions/[name]/review/route.ts` (new):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getMeta } from "@/lib/ai-sessions";
import { getUserScoping, canAccessSession } from "@/lib/session-scope";
import { resolvePRForSession } from "@/lib/github/session-link"; // github-integration §2.7
import { getGitHubApiForRepo, resolveRepoBinding } from "@/lib/github/api"; // §2.6 / settings.toml
import { getSessionDrafts, mergeIntoModel } from "@/lib/pr-review/drafts";

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { username, role, shouldScope } = getUserScoping(req.headers);
  // Same guard as DELETE /api/sessions/[name]. 403, never 401.
  if (shouldScope && (!username || !canAccessSession(username, role, name))) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const meta = getMeta(name);
  if (!meta?.worktree) {
    return NextResponse.json({ error: "Session has no worktree" }, { status: 404 });
  }

  const binding = await resolveRepoBinding(meta.worktree.repoRoot); // .terminalx/settings.toml
  if (!binding) {
    // Repo isn't bound to a GitHub integration → no PR is possible yet.
    return NextResponse.json({
      pr: null,
      decision: "pending",
      reviews: [],
      byFile: [],
      draftCount: 0,
    });
  }

  try {
    const api = await getGitHubApiForRepo(binding, username);
    const link = await resolvePRForSession(api, binding.owner, binding.repo, meta);
    if (!link.pr) {
      const drafts = getSessionDrafts(name);
      return NextResponse.json({
        pr: null,
        decision: "pending",
        reviews: [],
        byFile: [],
        draftCount: drafts.length,
      });
    }
    const summary = await api.reviews.getReviewSummary(binding.owner, binding.repo, link.pr.number);
    const model = mergeIntoModel(link.pr, summary, getSessionDrafts(name)); // → ReviewTabModel
    return NextResponse.json(model);
  } catch (err) {
    return sanitizeGitHubError(err); // map to 403/404/422/500; never leak tokens or paths
  }
}
```

Notes:

- The route never instantiates `Octokit` directly — `getGitHubApiForRepo` returns the
  `GitHubAPI` from github-integration, which owns token retrieval, retry/backoff, and rate
  limiting. This spec's routes only orchestrate.
- `sanitizeGitHubError` reuses the error taxonomy in github-integration §3 and the
  path-sanitizing posture of `src/app/api/files/route.ts`.

---

## 7. Create-PR + comment-sync design (kept from the prior draft, re-grounded)

The two ideas worth keeping from the blind draft are **(a)** a first-class PR-create flow and
**(b)** a local-first comment layer that syncs to GitHub. Both survive — but corrected:

| Prior (blind)                                                                               | Corrected (this spec)                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRCreationModal` as a full page route                                                      | `CreatePrDialog` — a small shadcn `Dialog`; the only modal, just the form (§5).                                                                                                                            |
| `usePRCreateStore` Zustand + localStorage persist                                           | `CreatePrForm` local component state; submit → `POST /api/sessions/[name]/pr` (§6.3).                                                                                                                      |
| Local comments in **IndexedDB** + `CommentSyncService` (30s scheduler, conflict strategies) | `DraftComment` persisted **server-side per session** (`data/pr-review/<session>.json`, §6.2); explicit **Submit review** batches them (§4.4). No background scheduler, no IndexedDB, no conflict resolver. |
| Custom GitHub **OAuth** flow + `/api/auth/github/callback`                                  | Auth owned by github-integration (token vault, §1); this spec consumes the resolved client.                                                                                                                |
| `octokit.pulls.create` / `createReviewComment` in this layer                                | `createPullRequest` / `createReview` / `replyToReviewComment` on the shared `GitHubAPI`.                                                                                                                   |
| **401** on unauthenticated                                                                  | **403** per the repo's `getUserScoping`/`canAccessSession` pattern (never 401).                                                                                                                            |

The "sync" is therefore **explicit and batched**: compose drafts → **Submit review** posts
them as one GitHub review (plus replies). This matches GitHub's own "pending review" model and
avoids the partial-sync and conflict problems the IndexedDB scheduler introduced.

---

## 8. Color & theming (dark)

Reuse the TerminalX palette (matches `RightPanel.tsx` / `diff-viewer.spec.md` §8):

```css
--bg: #0a0b10; /* panel */
--bg-raised: #0f1117; /* header bars */
--bg-line: #14161e; /* thread card / hunk context */
--border: #1a1d24;
```

Accents:

| element                       | token                 |
| ----------------------------- | --------------------- |
| approved / additions          | `#00ff88`             |
| changes requested / deletions | `#ff5050`             |
| pending draft ("Pending")     | `#ffb454` (amber)     |
| review required / modified    | `#5ccfe6` (cyan)      |
| reviewer/info, neutral pill   | `#d58fff` / `#6b7569` |

Status-bar pill colors are owned by `diff-viewer.spec.md` §4.1 (shared shell) and reused
verbatim — this tab does not define its own status pill.

---

## 9. Acceptance criteria

- [ ] PR review renders as the **Review** tab (eye icon) **inside `ReviewPanel`**, in the
      fixed-width right `<aside>` — **not** as a modal or routed page; it shares the status bar
      (`#n ↗`, Merged/Open/Draft/Closed pill, Continue, Archive) and tab strip with All
      files / Changes / Checks.
- [ ] With no PR for the session's branch, both the status bar's `#n` slot and the Review tab
      show **Create PR**; the dialog defaults `head` to the session's worktree branch
      (read-only) and `base` to the repo default branch.
- [ ] **Create PR** posts to `POST /api/sessions/[name]/pr` → `createPullRequest(...)`; on
      success the status bar paints `#n ↗` + the Open/Draft pill and the tab switches state.
- [ ] The Review tab shows the per-reviewer **decision rollup** (`approved` /
      `changes_requested` / `review_required` / `pending`) and groups line-anchored threads by
      file using the muted-dir + emphasized-filename row.
- [ ] Adding an inline comment creates a **`DraftComment`** (tagged **Pending**, amber),
      persisted server-side per session (`data/pr-review/<session>.json`) — **no IndexedDB**.
- [ ] **Submit review** (Comment / Approve / Request changes) batches drafts into **one**
      GitHub review via `createReview(...)`, posts reply drafts via
      `replyToReviewComment(...)`, clears submitted drafts, and refetches `ReviewSummary`.
- [ ] `resolve`/`unresolve` flips a TerminalX-tracked flag only (never posted to GitHub).
- [ ] All routes are session-scoped via `getUserScoping` + `canAccessSession`, return **403**
      (never 401) when scope denies, and sanitize errors (no token/path leakage).
- [ ] The route layer never instantiates `Octokit` directly — it delegates to the
      `GitHubAPI` client owned by `github-integration.spec.md`.

---

## 10. Edge cases

| Case                                                        | Behavior                                                                                                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session has no worktree                                     | `GET …/review` → 404 "Session has no worktree"; tab shows an explanatory empty state (you can't review a non-worktree session).                                                        |
| Repo not bound to a GitHub integration                      | `pr: null` payload; Review tab shows "Connect this repo" hint → links to GitHub integration settings (`.terminalx/settings.toml`).                                                     |
| Branch has commits but no PR                                | Create-PR empty state + status-bar Create-PR affordance.                                                                                                                               |
| `head === base` in Create-PR                                | Inline validation error; no network call.                                                                                                                                              |
| Invalid branch name                                         | `validateGitBranchName` throws → inline error.                                                                                                                                         |
| PR is **Merged** / **Closed**                               | Review tab is read-only for new line comments on closed PRs? No — GitHub allows comments on closed PRs; composer stays enabled but Approve/Request-changes are disabled on merged PRs. |
| Comment anchored to an outdated line (`line === null`)      | Thread rendered under its file with an "Outdated" tag; reply still allowed (posts against the original position).                                                                      |
| Reviewer reviewed multiple times                            | Rollup uses the **latest** review per user (rule in the data layer).                                                                                                                   |
| Draft exists for a line that no longer appears in the diff  | Draft kept and shown under its file with a "Line moved" note; still submittable (GitHub re-anchors or rejects → surfaced as a per-draft error).                                        |
| `createReview` partial failure (some comments rejected)     | Submitted-successfully drafts cleared; rejected drafts kept with a per-draft error badge; tab shows "N of M posted".                                                                   |
| Non-admin in multi-user mode hitting another user's session | 403 via `canAccessSession`.                                                                                                                                                            |
| GitHub rate-limited / 5xx                                   | Surfaced via github-integration's retry/backoff; if exhausted, tab shows a retry banner (no path/token leak).                                                                          |
| Token missing/expired                                       | 403 with "Reconnect GitHub in settings"; never 401.                                                                                                                                    |

---

## 11. Testing

- **Routing/auth:** every `/api/sessions/[name]/review*` and `…/pr` route returns 403 (never 401) when `shouldScope && !canAccessSession`; admin/local mode passes through; errors are
  sanitized.
- **Resolution:** `resolvePRForSession` join (session `worktree.branch` → PR `head.ref`);
  `pr: null` path emits the Create-PR payload.
- **Drafts:** upsert/discard round-trip through `data/pr-review/<session>.json`; merge of
  drafts into `ReviewSummary.threads` (`mergeIntoModel`); draft for a vanished line is kept.
- **Submit:** `event` mapping (Comment/Approve/Request changes); reply drafts use
  `replyToReviewComment`; partial-failure leaves rejected drafts with error badges.
- **Components:** `ReviewTab` empty/loading/error/active states; decision rollup colors;
  file-thread grouping (muted dir + emphasized filename); Pending (amber) draft tag;
  `CreatePrDialog` validation (head===base, invalid branch).
- **Shell:** Review tab mounts inside `ReviewPanel`, not as a modal/page; consumes the shared
  `ReviewStatusBar` (`diff-viewer.spec.md` §4.1) without redefining the pill.

---

## Summary

| Aspect              | Decision                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Surface**         | The **Review** tab (eye icon) of the session-attached `ReviewPanel` — **not** a modal or routed page; shares the shell with All files / Changes / Checks.                                               |
| **Shell**           | Top status bar (`#n ↗`, Merged/Open/Draft/Closed pill, Continue, Archive) + tab strip, **owned by `diff-viewer.spec.md` §4** and consumed here.                                                         |
| **Data**            | `Review` / `ReviewComment` / `ReviewThread` / `ReviewSummary` from `github-integration.spec.md` §2.5; this spec adds only the local `DraftComment` / `DraftReview` / `ReviewTabModel`.                  |
| **Create PR**       | A small shadcn `Dialog` (`CreatePrDialog`) → `POST /api/sessions/[name]/pr` → `createPullRequest(...)`. `head` = session branch (read-only).                                                            |
| **Inline comments** | `DraftComment` store persisted **server-side per session** (`data/pr-review/<session>.json`) — **no IndexedDB**, no background scheduler.                                                               |
| **Comment sync**    | Explicit, batched **Submit review** → one `createReview(...)` (+ `replyToReviewComment` for replies); matches GitHub's pending-review model.                                                            |
| **API**             | Session-scoped `/api/sessions/[name]/review`, `…/review/drafts`, `…/review/submit`, `…/pr`; **403 never 401**; delegates to the shared `GitHubAPI`.                                                     |
| **Grounding**       | `ai-sessions.ts`, `git-worktree.ts`, `session-scope.ts`, `files`/`sessions/[name]` route auth, `RightPanel.tsx`, `AppShell.tsx` mount (all verified); data contracts from `github-integration.spec.md`. |

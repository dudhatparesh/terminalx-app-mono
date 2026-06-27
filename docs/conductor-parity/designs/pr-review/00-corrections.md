# Corrections — pr-review design set

**Date:** 2026-06-25
**Backs:** GitHub issue **#8**
**Authoritative sources:** the Conductor screenshots (the review/diff panel — `#1 ↗` status
bar with a `Merged` pill, `Continue`/`Archive`, and the **All files / Changes(1) / Checks /
Review(eye)** tab strip; the file row `.conductor/settings.toml … +19`) and the real TerminalX
repo (`src/lib/ai-sessions.ts`, `src/lib/git-worktree.ts`, `src/lib/session-scope.ts`,
`src/app/api/files/route.ts`, `src/app/api/sessions/[name]/route.ts`,
`src/components/layout/RightPanel.tsx`, `src/components/layout/AppShell.tsx`). The shared panel
shell is owned by [`../diff-viewer.spec.md`](../diff-viewer.spec.md) §4 and the GitHub data
contracts by [`../github-integration.spec.md`](../github-integration.spec.md) §2.

`01-ui-spec.md` has been **rewritten from scratch** to match all of the above. Documents
`02`–`05` were drafted **blind** (without the screenshots) and contradict ground truth in the
ways below. They are **superseded by `01-ui-spec.md`** and should be deleted or rewritten to
follow it.

---

## Cross-cutting errors (present in 02, 03, 04, 05)

1. **PR review modeled as a standalone page/panel + a separate modal, not the "Review" tab of
   one shared panel.** The docs build a `PRReviewPanel` (a two-pane page: left file sidebar +
   right diff + top metadata bar) and a separate `PRCreationModal`, with routes like
   `/workspace/pr/create` and `/workspace/pr/:number/review`. **Ground truth:** the review
   surface is a **single tabbed right-hand panel attached to a session** — **All files /
   Changes(n) / Checks / Review(eye)** under one status bar (`#n ↗`, Merged/Open/Draft pill,
   Continue, Archive). PR review is the **Review** tab; the diff already lives in the
   **Changes** tab. The diff viewer, checks, PR review, and archive are **facets of one
   panel** (`diff-viewer.spec.md` §4 owns the shell). `01-ui-spec.md` re-grounds PR review as
   `ReviewTab` inside `ReviewPanel`.

2. **Re-invents the diff viewer / file list / split view that another tab already owns.** `01`
   (old) §3.2.3–§3.2.4, §8.2–§8.3 and `02` §1.3–§1.4 specify a full `DiffViewer` /
   `DiffLine` / unified-vs-split / hunk-collapsing / Prism syntax highlighting / `react-window`
   virtualization stack. That is the **Changes tab** (`diff-viewer.spec.md`), not PR review.
   The Review tab only shows the _anchored hunk_ per comment thread inline; it does not
   re-render the whole diff or own a split layout.

3. **Custom GitHub OAuth web flow.** `02` §3, `04`, and `05` §1/§5 build
   `GET/POST /api/auth/github`, `/api/auth/github/callback`, `@octokit/oauth-app`,
   `createSessionCookie`, an HttpOnly auth cookie, and a redirect dance. **Ground truth:**
   authentication is owned by `github-integration.spec.md` (token vault, §1); TerminalX has no
   such auth routes today and the integration layer — not this feature — owns "who am I"
   (`GET /user`, github-integration §2.5a). `01-ui-spec.md` consumes the resolved `GitHubAPI`
   client and adds no auth routes.

4. **Invented `/api/github/repos/:owner/:repo/...` route family + direct Octokit in the app
   layer.** `02` §3 and `05` §5 define `POST /api/github/repos/:owner/:repo/pulls`,
   `…/pulls/:number/comments`, `…/comments/:id`, etc., each `new Octokit({ auth })` inline.
   **Ground truth:** every existing route is session-scoped under `/api/sessions/[name]/…`, and
   the GitHub REST surface (`PullRequestAPI`, `ReviewAPI`, retry/backoff, rate limiting) is
   owned by `github-integration.spec.md` §2. `01-ui-spec.md` exposes thin session-scoped
   wrappers (`/api/sessions/[name]/review`, `…/review/drafts`, `…/review/submit`, `…/pr`) that
   delegate to the shared `GitHubAPI` and never instantiate `Octokit` directly.

5. **`401 Unauthorized` everywhere.** `02` returns `401` in the PR-create, PR-list, and
   comment routes (`02:1094`, `02:1160`, `02:1213`); `05`'s error matrix lists `401` for
   "Auth expired". **Ground truth:** **no TerminalX route returns 401.** `/api/files` is
   admin-gated with **403 "Admin access required"** (`src/app/api/files/route.ts:8`) and
   `/api/sessions/[name]` uses `getUserScoping` → `shouldScope && canAccessSession` → **403**
   (`src/app/api/sessions/[name]/route.ts:28`). `01-ui-spec.md` uses 403 throughout.

6. **IndexedDB comment database + background sync scheduler + conflict resolution.** `01`
   (old) §5 and `02` §4 build a `terminalx-pr-review` IndexedDB with object stores
   (`comments`, `reviewState`, `drafts`, `syncLog`), a `CommentSyncService` with a 30-second
   auto-sync scheduler, exponential-backoff retry, and a `ConflictResolutionStrategy`
   (KEEP_LOCAL / KEEP_REMOTE / MERGE / MANUAL) with a conflict dialog. **Ground truth:** none of
   this matches Conductor (whose review comments are just GitHub PR review comments) or the
   repo (which persists session state in `data/*.json` with a write lock, e.g.
   `src/lib/ai-sessions.ts`). `01-ui-spec.md` replaces it with `DraftComment`s persisted
   **server-side per session** (`data/pr-review/<session>.json`) and an **explicit, batched
   "Submit review"** that posts one GitHub review (`createReview`) plus replies
   (`replyToReviewComment`) — matching GitHub's native pending-review model, with no scheduler
   and no conflict resolver.

7. **`zustand` + `persist` to `localStorage` for PR/review state.** `01` (old) §2.2/§6, `02`
   §2, and `05` §4 define `usePRReviewStore` / `usePRCreateStore` persisted to `localStorage`
   (`pr-review-storage`, `pr-create-storage`). **Ground truth:** TerminalX uses React hooks +
   server state; the only `localStorage` convention in-repo is small UI prefs
   (`terminalx:open-tabs`, `terminalx:diff-prefs`). `01-ui-spec.md` uses local component state
   for the create form and a server-backed hook (`usePrReviewDrafts`) for drafts — no global
   PR store, no PR data in `localStorage`.

8. **Wrong mount/host and missing the shared status bar.** The docs render PR review as its own
   page with a bespoke `PR #123 … [Open] [Merge▼]` header. **Ground truth:** the right panel is
   mounted by **`AppShell`** in a fixed-width `<aside>` (`w-[360px]`, `2xl:w-[400px]`,
   `src/components/layout/AppShell.tsx:229–231`) — not a routed page, not `WorkspaceView`. The
   status bar (`#n ↗`, **Merged/Open/Draft/Closed** pill, **Continue**, **Archive**) is the
   **shared** `ReviewStatusBar` owned by `diff-viewer.spec.md` §4.1, and the PR pill is a
   **derived** value (`derivePullRequestStatus`, github-integration §2.3a) — not the raw GitHub
   `state`, and not a `[Merge▼]` dropdown. The docs never show Continue or Archive.

9. **Redefines GitHub data shapes the integration layer owns.** `01` (old) §2.1 and `02`/`05`
   define their own `PullRequest`, `FileDiff`, `DiffComment`, `CommentReply`, `Commit`, etc.
   **Ground truth:** `PullRequest` / `PullRequestView` / `Review` / `ReviewComment` /
   `ReviewThread` / `ReviewSummary` are owned by `github-integration.spec.md` §2.3–§2.5.
   `01-ui-spec.md` imports those and adds only the genuinely new local layer
   (`DraftComment`, `DraftReview`, `MergedThread`, `ReviewTabModel`, `CreatePrForm`).

10. **No session/worktree grounding.** The docs treat a PR as a free-floating GitHub object
    keyed by `owner/repo/number` from `window.__REPO_CONTEXT`. **Ground truth:** the panel is
    **attached to a session**, and a PR is resolved by joining `SessionMeta.worktree.branch`
    (`src/lib/ai-sessions.ts:15`) to `PullRequest.head.ref` via `resolvePRForSession`
    (github-integration §2.7). `01-ui-spec.md` keys everything off the session.

---

## Per-document notes

### 02-implementation.md

- §1.1 `PRCreationModal.tsx` and §1.3–§1.4 `DiffViewer.tsx` / `DiffLine.tsx`: the modal is a
  full create page and the diff viewer duplicates the **Changes** tab (Prism highlighting,
  unified/split, hunk collapse). Replace with `CreatePrDialog` (form-only shadcn `Dialog`,
  `01` §5) and drop the diff viewer (owned by `diff-viewer.spec.md`).
- §2.1 `usePRCreateStore` (Zustand): replaced by `CreatePrForm` local state + `POST
/api/sessions/[name]/pr`. The `window.__REPO_CONTEXT?.split('/')` owner/repo hack is wrong —
  the binding comes from `.terminalx/settings.toml` resolved server-side.
- §3 route handlers: wrong path family (`/api/github/repos/[owner]/[repo]/pulls`), wrong auth
  (`next-auth` `getServerSession`, which the repo does not use), and **401** responses. Replace
  with session-scoped routes using `getUserScoping`/`canAccessSession` → 403.
- §3.2 comment route calls `octokit.pulls.createReviewComment` / `createReplyForReviewComment`
  inline; these belong to the shared `ReviewAPI` (github-integration §2.5).
- §4 IndexedDB schema (`StoredComment`, `StoredReviewState`, object stores): removed — drafts
  live in `data/pr-review/<session>.json`.

### 03-advanced-features.md

- This file is "future features"; most is out of scope, but it inherits the wrong base model
  (a `DiffViewer`/`DiffLine` it extends, a `PRReviewPanel` header it injects CI status into).
  CI/checks belong to the **Checks** tab (`checks-dashboard.spec.md`), not a PR-review header
  block (§1.5).
- §1.1 AI code review uses a stale model id `claude-3-5-sonnet-20241022` and reads
  `process.env.ANTHROPIC_API_KEY` directly in a client component — both wrong for current
  TerminalX (which is harness/CLI-driven; see custom-providers). If kept, route model calls
  server-side and use a current model id.
- §1.2 real-time collaboration (`ws://your-server.com/ws/pr-review/:n`), §3 webhook handler,
  §4 Elasticsearch PR search, §7 Slack/Jira: all speculative infra with no repo grounding;
  TerminalX's WS is the terminal upgrade in `server/index.ts`, not a PR-review socket.
  Acceptable as a clearly-labeled "future" appendix only once §1–§5 are corrected.

### 04-readme.md

- The index describes the blind architecture as the deliverable: "side-by-side diff viewer",
  "OAuth flow", "IndexedDB local-first comments", "CommentSyncService", "react-window
  virtualization", a 4-file doc set keyed to `PR_CREATION_REVIEW_UI_SPEC.md` etc. Rewrite the
  overview to: PR review = the **Review** tab of `ReviewPanel`; diff = the **Changes** tab;
  data + auth from `github-integration.spec.md`; drafts server-side; 403-not-401.
- "Key Design Decisions" #1 (Local-First IndexedDB), #3 (OAuth + Octokit in-app), and the
  `File Organization` tree (`src/store/prReviewStore.ts`, `src/lib/sync/commentSyncService.ts`,
  `src/lib/db/schema.ts`, `src/app/api/auth/github/route.ts`,
  `src/app/api/github/repos/...`) all reference files that should not exist. The real new files
  are `src/components/review/ReviewTab.tsx` + `CreatePrDialog.tsx`,
  `src/hooks/usePrReviewDrafts.ts`, `src/types/pr-review.ts`, and the session-scoped routes in
  `01` §6.
- FAQ "How do offline comments work? … saved to IndexedDB … sync automatically" contradicts
  the explicit batched-submit model.

### 05-quick-reference.md

- §1 architecture diagram centers on `prCreateStore` / `prReviewStore` / `CommentSyncService` /
  IndexedDB / a custom `/auth` + `/api/github/repos/*` API and direct `oauth.github.com`. All
  wrong per cross-cutting #3–#7.
- §2.3 "Local Comment Persistence" (Zustand → IndexedDB → GitHub, 30s auto-sync, 50MB quota):
  replaced by server-side drafts + explicit submit.
- §5 "API Endpoint Reference" lists the entire `/api/auth/*` and `/api/github/repos/*` family —
  none of which exist or should. Replace with the session-scoped routes in `01` §6.
- §6 "Error Handling Matrix" lists **401** for auth-expired; must be **403** ("Reconnect
  GitHub in settings"). 403 is also the correct code for insufficient permissions (the matrix's
  separate 401/403 split does not apply here).
- §3 component hierarchy and §4 state-management flow describe the standalone two-pane
  `PRReviewPanel` + persisted stores; replace with the `ReviewTab`-inside-`ReviewPanel` tree
  (`01` §4) and the server-backed draft hook.

---

## What `01-ui-spec.md` fixed (summary)

- Re-grounded PR review as the **Review** tab (eye icon) of the session-attached
  **`ReviewPanel`**, sharing the status bar (`#n ↗`, Merged/Open/Draft/Closed pill, Continue,
  Archive) and tab strip with All files / Changes / Checks — **not** a modal or routed page,
  and **not** a re-implementation of the diff viewer.
- Removed the custom **OAuth** flow, the **`/api/github/repos/*`** route family, and all direct
  in-app **Octokit**; the feature now consumes the `GitHubAPI` + data contracts owned by
  `github-integration.spec.md`, and exposes only thin **session-scoped** routes.
- Replaced **401** with the repo's **403** `getUserScoping`/`canAccessSession` pattern.
- Replaced the **IndexedDB** comment DB + 30s **sync scheduler** + **conflict resolver** with
  `DraftComment`s persisted **server-side per session** and an explicit, batched **Submit
  review** (`createReview` + `replyToReviewComment`) that mirrors GitHub's pending-review model.
- Dropped the `zustand`+`localStorage` PR stores in favor of local form state + a server-backed
  `usePrReviewDrafts` hook.
- Kept the two worthwhile ideas — a first-class **Create-PR** flow (now a single small
  `Dialog` → `createPullRequest`) and a **local-first comment layer that syncs to GitHub** (now
  server-persisted drafts + batched submit) — corrected to match ground truth.
- Anchored everything to the **session/worktree** (`SessionMeta.worktree.branch` →
  `PullRequest.head.ref` via `resolvePRForSession`), and to the verified mount host
  (`AppShell` `<aside>`).

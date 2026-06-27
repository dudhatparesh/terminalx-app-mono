# TerminalX Diff Viewer Specification (the "Changes" tab of the Review panel)

**Version:** 2.0
**Issue:** [#2](https://github.com/manish05/terminalx-app-mono/issues/2)
**Tech stack:** Next.js 16 App Router + custom Node server, React 19, shadcn/ui, Tailwind 4, `react-resizable-panels` ^4.11.0, TypeScript

---

## Overview

The Diff Viewer is **not a standalone surface**. It is the **"Changes" tab of TerminalX's
Review panel** — the right-hand panel that attaches to a session/workspace. The Review panel
is a single tabbed surface (**All files / Changes(n) / Checks / Review**) with a top status bar
(PR link, merged/open/draft status, **Continue**, **Archive**). The diff viewer owns the
**Changes** tab: it renders the file list and the per-file unified/side-by-side diff for the
workspace's branch against its base.

This is the TerminalX analog of **Conductor's review/diff panel**. The diff viewer, checks
dashboard ([`checks-dashboard.spec.md`](./checks-dashboard.spec.md)), and PR review
([`pr-review/`](./pr-review/)) are **facets of this one panel** and must agree on its shell:
the tab set, file-row layout, and status bar described below are shared, owned here, and
referenced by the sibling specs.

---

## Conductor UI reference (from screenshots)

The authoritative UI facts this feature depends on, captured from the Conductor screenshots.
Anything that contradicts these is wrong.

### The Review / Diff panel (right-hand, attached to a session)

- **Top status bar (single row):**
  - **`#1 ↗`** — the PR number, linking out to the PR on GitHub.
  - A **status pill** — `Merged` in the capture; can also be `Open` / `Draft` / `Closed`.
  - A **`Continue`** button (resume/return to the session's chat).
  - A prominent **`Archive`** button (archive the workspace; see Archive & Cleanup, issue #9).
- **Tab row** (directly under the status bar):
  - **`All files`** — the full file tree of the workspace.
  - **`Changes`** with a **count badge** (e.g. `1`) — the diff viewer (this spec).
  - **`Checks`** — CI/status dashboard ([`checks-dashboard.spec.md`](./checks-dashboard.spec.md)).
  - **`Review`** with an **eye icon** — PR review surface ([`pr-review/`](./pr-review/)).
- **File rows (inside `Changes`):**
  - The **path** is shown with the **filename emphasized** (e.g. `.conductor/settings.toml`
    renders the directory muted and `settings.toml` bright).
  - An **added/removed lines count** styled like **`+19`** (and `-N` when present).
  - A small **file/status icon** (added / modified / deleted / renamed).

### Cross-cutting facts that inform this spec

- **Repo config lives in a committed TOML** (Conductor: `.conductor/settings.toml`). TerminalX's
  analog is a committed repo config under **`.terminalx/`** (e.g. `.terminalx/settings.toml`).
  This file shows up in the diff like any other tracked file — the file-row example above is
  literally a settings TOML.
- **Per-workspace injected port** (Conductor: `CONDUCTOR_PORT`). TerminalX injects a
  per-workspace port so preview/run servers don't collide; relevant here only because the
  diff is computed **per workspace/worktree**, not against a global checkout.
- **Code review uses a separate, independently-configurable model** from authoring. The diff
  viewer is the read surface that review and checks decorate; it does not itself call a model,
  but the **Review** tab it shares the shell with does.

### Naming note (Conductor → TerminalX)

| Conductor                  | TerminalX analog                            | Source of truth                      |
| -------------------------- | ------------------------------------------- | ------------------------------------ |
| `.conductor/settings.toml` | `.terminalx/settings.toml`                  | new artifact (this track)            |
| `CONDUCTOR_PORT`           | `TERMINALX_PORT` (injected per workspace)   | new artifact (this track)            |
| worktree per workspace     | `git-worktree.ts` (`.terminalx-worktrees/`) | `src/lib/git-worktree.ts` (verified) |

---

## 1. Codebase grounding (verified)

Every reference below was confirmed by reading the repo.

| Symbol / path                                                                              | Where                                        | Used for                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionMeta` (`.worktree?: { repoRoot, path, branch }`)                                   | `src/lib/ai-sessions.ts`                     | The diff target: a session's worktree, its `repoRoot` and `branch`.                                                                                                                               |
| `getMeta(name)`                                                                            | `src/lib/ai-sessions.ts`                     | Look up the session's worktree for the diff.                                                                                                                                                      |
| `GitDirectoryInfo` (`isRepo`, `root`, `branch`, `repoName`)                                | `src/lib/git-worktree.ts`                    | Resolve repo/branch when no worktree is recorded.                                                                                                                                                 |
| `getGitDirectoryInfo(directory)`                                                           | `src/lib/git-worktree.ts`                    | Detect repo root + branch for a `cwd`.                                                                                                                                                            |
| `CreatedGitWorktree` (`repoRoot`, `worktreePath`, `startDir`, `branch`)                    | `src/lib/git-worktree.ts`                    | The worktree shape created per session.                                                                                                                                                           |
| `getTerminusRoot()`                                                                        | `src/lib/file-service.ts`                    | Root sandbox (`TERMINUS_ROOT`), all paths confined to it.                                                                                                                                         |
| `resolveSafePath(p)`, `assertNotSensitivePath(p)`                                          | `src/lib/file-service.ts`                    | Confine `repoPath` to the sandbox; reject sensitive paths.                                                                                                                                        |
| `getUserScoping(headers)` → `{ username, role, hasIdentity }`                              | `src/lib/session-scope.ts`                   | Admin/identity gate, matching every existing API route.                                                                                                                                           |
| `canAccessSession(username, role, sessionName)`                                            | `src/lib/session-scope.ts`                   | Per-session authorization in multi-user mode.                                                                                                                                                     |
| `RightPanel` (tabs: `All files` / `Logs` / `Snippets`)                                     | `src/components/layout/RightPanel.tsx`       | **The component we extend** with `Changes` / `Checks` / `Review`.                                                                                                                                 |
| `AppShell`                                                                                 | `src/components/layout/AppShell.tsx`         | **The host.** Mounts `RightPanel` (line 231) inside a fixed-width right `<aside>` (`w-[360px]`); this is where `ReviewPanel` replaces it.                                                         |
| `WorkspaceView`                                                                            | `src/components/workspace/WorkspaceView.tsx` | Renders only the session terminal (the routed `children`); does **not** import or render `RightPanel`.                                                                                            |
| `useOpenTabs()` → `{ tabs: string[], openTab, closeTab }`                                  | `src/hooks/useOpenTabs.ts`                   | **Session** tabs only (array of names). NOT a generic tab system.                                                                                                                                 |
| `GET /api/files` (`getUserScoping` → admin gate, `resolveSafePath`, sanitized errors)      | `src/app/api/files/route.ts`                 | Reference for `resolveSafePath`/sandbox confinement + sanitized error mapping (note: it is **admin-only** — `!hasIdentity \|\| role !== 'admin'` → 403; it does **not** use per-session scoping). |
| `DELETE /api/sessions/[name]` (`getUserScoping` → `shouldScope && canAccessSession` → 403) | `src/app/api/sessions/[name]/route.ts`       | The established **per-session** auth pattern the diff route follows.                                                                                                                              |

> **Correction vs the prior draft.** The earlier spec invented a generic tab system
> (`useOpenTabs` storing `{ id, type: "diff", label, data }`) and a standalone `DiffViewer`
> opened as a tab. Neither exists: `useOpenTabs` persists a `string[]` of **session names**,
> and `RightPanel` is a fixed tabbed panel. The diff viewer is therefore implemented as the
> **`Changes` tab of `RightPanel`**, not as a new tab type.

---

## 2. Data model

`src/types/diff.ts` (new).

```typescript
/** A diff line. `+`/`-` markers are stripped; `type` carries the marker. */
export interface DiffLine {
  /** Stable id: `${fileId}:${hunkIndex}:${lineIndex}` */
  id: string;
  type: "context" | "addition" | "deletion";
  content: string;
  /** Original-file line number; null on additions. */
  oldLineNum: number | null;
  /** New-file line number; null on deletions. */
  newLineNum: number | null;
}

/** A contiguous `@@ ... @@` block plus its context. */
export interface DiffHunk {
  /** e.g. "@@ -10,5 +12,8 @@ export function foo() {" */
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  index: number;
  lines: DiffLine[];
}

export type FileStatus = "added" | "deleted" | "modified" | "renamed" | "copied" | "mode-change";

/** One changed file. The Changes-tab file row is rendered from this. */
export interface FileDiff {
  /** Stable id (hash of path+oldPath). */
  id: string;
  /** Repo-relative path, e.g. ".terminalx/settings.toml". */
  path: string;
  /** Trailing filename, emphasized in the row, e.g. "settings.toml". */
  filename: string;
  /** Directory prefix, muted in the row, e.g. ".terminalx/". */
  dir: string;
  /** Extension (no dot), for the file/status icon + highlighting hint. */
  extension: string;
  status: FileStatus;
  /** Previous path when status === "renamed" | "copied". */
  oldPath?: string;
  additions: number; // "+N" in the row
  deletions: number; // "-N" in the row
  isBinary: boolean;
  /** Absent until the file is expanded (lazy diff). */
  hunks?: DiffHunk[];
  /** Similarity 0–100 for renames. */
  similarity?: number;
  /** Set when the file was truncated for size. */
  truncated?: boolean;
  oldMode?: string;
  newMode?: string;
}

/** The whole Changes payload for a workspace's branch vs base. */
export interface DiffResponse {
  request: {
    /** Session whose worktree was diffed (when applicable). */
    session?: string;
    repoPath: string;
    base: string; // the ref we diffed against (e.g. "main")
    head: string; // the workspace branch (e.g. "feature/x" or "HEAD")
    timestamp: number;
  };
  files: FileDiff[];
  summary: {
    filesChanged: number;
    additions: number;
    deletions: number;
    byStatus: Record<FileStatus, number>;
  };
  /** False while streaming. */
  isComplete: boolean;
}
```

### 2.1 View-only UI state (not persisted server-side)

```typescript
export interface DiffViewPrefs {
  layout: "unified" | "split"; // a.k.a. side-by-side; persisted to localStorage
  wordWrap: boolean;
  /** Files whose diff is collapsed in the Changes tab. */
  collapsed: Set<string>; // FileDiff.id
}
```

Persisted under `localStorage["terminalx:diff-prefs"]`, mirroring the `terminalx:open-tabs`
convention in `useOpenTabs.ts`.

---

## 3. API design

The diff is computed **per session worktree**. The route follows the established **per-session**
auth pattern from `DELETE /api/sessions/[name]` — `getUserScoping` → guard with
`shouldScope && canAccessSession(...)` → 403 — and reuses the sandbox confinement
(`resolveSafePath`/`getTerminusRoot`) and sanitized error shape from `GET /api/files`. (Unlike
`/api/files`, the diff route is **not** admin-only; it is scoped to the requesting user's own
sessions. No session route returns 401, so neither does this one.)

### 3.1 `GET /api/sessions/[name]/diff` — file list (no hunks)

Resolves the session's worktree from `getMeta(name).worktree`; falls back to
`getGitDirectoryInfo(cwd)` when no worktree is recorded. Diffs `base..head`.

**Query:**

| param      | default                                          | meaning             |
| ---------- | ------------------------------------------------ | ------------------- |
| `base`     | merge-base of `head` and the repo default branch | ref to diff against |
| `head`     | the worktree's branch (or `HEAD`)                | ref being reviewed  |
| `maxFiles` | `300`                                            | cap on file rows    |

**200:**

```json
{
  "request": {
    "session": "feature-x",
    "repoPath": "/root/.terminalx-worktrees/...",
    "base": "main",
    "head": "feature-x",
    "timestamp": 1719345600000
  },
  "files": [
    {
      "id": "a1b2",
      "path": ".terminalx/settings.toml",
      "filename": "settings.toml",
      "dir": ".terminalx/",
      "extension": "toml",
      "status": "added",
      "additions": 19,
      "deletions": 0,
      "isBinary": false
    }
  ],
  "summary": {
    "filesChanged": 1,
    "additions": 19,
    "deletions": 0,
    "byStatus": {
      "added": 1,
      "deleted": 0,
      "modified": 0,
      "renamed": 0,
      "copied": 0,
      "mode-change": 0
    }
  },
  "isComplete": true
}
```

The list omits `hunks` so the panel paints rows immediately; bodies load on expand (§3.3).
This is what produces the screenshot's `.conductor/settings.toml … +19` row (TerminalX:
`.terminalx/settings.toml`).

### 3.2 `GET /api/sessions/[name]/diff?stream=1` — streamed list

When `stream=1`, respond `application/x-ndjson`, one JSON object per line, so large branches
paint progressively (same pattern as the log stream surfaces in the repo):

```
{"type":"meta","data":{ "base":"main","head":"feature-x","timestamp":1719345600000 }}
{"type":"file","data":{ "id":"a1b2","path":".terminalx/settings.toml","filename":"settings.toml","status":"added","additions":19,"deletions":0,"isBinary":false }}
{"type":"summary","data":{ "filesChanged":1,"additions":19,"deletions":0 }}
```

### 3.3 `GET /api/sessions/[name]/diff/file` — single-file hunks (lazy)

| param          | default             | meaning                 |
| -------------- | ------------------- | ----------------------- |
| `path`         | — (required)        | repo-relative file path |
| `base`, `head` | as resolved by §3.1 | refs                    |
| `context`      | `3`                 | unified context lines   |

Returns one `FileDiff` **with** `hunks`. Called when a row is expanded, so a 300-file branch
never parses 300 patches up front.

### 3.4 Implementation sketch

`src/app/api/sessions/[name]/diff/route.ts` (new). Uses `git` via the existing
`execFileSync` pattern from `git-worktree.ts` (argument array, no shell, timeout, `maxBuffer`).

```typescript
import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { getMeta } from "@/lib/ai-sessions";
import { getGitDirectoryInfo } from "@/lib/git-worktree";
import { resolveSafePath, assertNotSensitivePath } from "@/lib/file-service";
import { getUserScoping, canAccessSession } from "@/lib/session-scope";

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { username, role, shouldScope } = getUserScoping(req.headers);
  // Same guard as DELETE /api/sessions/[name]: scope only when multi-user mode
  // requires it; admins/local mode pass through. No 401 — the API uses 403 throughout.
  if (shouldScope && (!username || !canAccessSession(username, role, name))) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const meta = getMeta(name);
    // Prefer the recorded worktree; else detect from the session cwd.
    const repoRoot =
      meta?.worktree?.repoRoot ?? getGitDirectoryInfo(meta?.cwd ?? process.cwd()).root;
    if (!repoRoot) {
      return NextResponse.json({ error: "Not a git repository" }, { status: 404 });
    }
    const safeRoot = resolveSafePath(repoRoot);
    assertNotSensitivePath(safeRoot);

    const sp = req.nextUrl.searchParams;
    const head = sp.get("head") ?? meta?.worktree?.branch ?? "HEAD";
    const base = sp.get("base") ?? mergeBase(safeRoot, head); // git merge-base head <default>

    const nameStatus = git(safeRoot, [
      "diff",
      "--name-status",
      "--find-renames",
      `${base}...${head}`,
    ]);
    const numStat = git(safeRoot, ["diff", "--numstat", `${base}...${head}`]);

    const files = mergeNameStatusAndNumstat(nameStatus, numStat); // → FileDiff[] (no hunks)
    return NextResponse.json(
      buildResponse({ session: name, repoPath: safeRoot, base, head, files })
    );
  } catch (err) {
    return sanitizeError(err); // mirrors src/app/api/files/route.ts mapping
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}
```

Notes:

- Uses the **three-dot** range `base...head` so the diff is against the merge-base — this is
  what the workspace's PR would show, matching the panel's PR link.
- `sanitizeError` reuses the mapping in `src/app/api/files/route.ts` ("outside the allowed
  root" → 403, `ENOENT` → 404, etc.). Never leak filesystem paths.
- Hunk parsing for §3.3 runs `git diff --unified=<context> base...head -- <path>` and parses
  the unified patch into `DiffHunk[]`.

---

## 4. Component tree

The Review panel **replaces** today's `RightPanel` tab set
(`All files` / `Logs` / `Snippets`) with the screenshot's
(`All files` / `Changes(n)` / `Checks` / `Review`). The diff viewer owns `Changes`.

```
ReviewPanel                         // src/components/review/ReviewPanel.tsx — extends RightPanel.tsx
├── ReviewStatusBar                 // shared shell, owned here
│   ├── PrLink            "#1 ↗"     // links to PR; hidden until a PR exists
│   ├── StatusPill        "Merged"  // Open | Draft | Merged | Closed
│   ├── ContinueButton    "Continue"
│   └── ArchiveButton     "Archive"
├── ReviewTabs                       // shared shell, owned here
│   ├── Tab "All files"              // → existing FileBrowser
│   ├── Tab "Changes" + CountBadge   // → ChangesTab  (THIS SPEC)
│   ├── Tab "Checks"                 // → checks-dashboard.spec.md
│   └── Tab "Review" (eye icon)      // → pr-review/
└── <active tab body>
    └── ChangesTab                   // src/components/review/ChangesTab.tsx
        ├── ChangesToolbar
        │   ├── SummaryStat   "1 file +19 -0"
        │   └── LayoutToggle  unified ⇄ split
        └── FileDiffList                       // virtualized when files > 80
            └── FileDiffRow  (per FileDiff)     // the screenshot's file row
                ├── ChevronToggle               // collapse/expand the body
                ├── StatusIcon                  // added/modified/deleted/renamed
                ├── PathLabel    dir muted + filename emphasized
                ├── DeltaBadge   "+19" / "-N"
                └── FileDiffBody (when expanded, lazy via §3.3)
                    └── HunkView (per DiffHunk)
                        ├── HunkHeader  "@@ ... @@"  (collapsible)
                        └── LineRow (per DiffLine)   // unified or split
```

### 4.1 `ReviewStatusBar` (shared shell)

Renders the screenshot's top bar. `Continue` returns focus to the session terminal in
`WorkspaceView`; `Archive` calls the archive flow (issue #9). PR data comes from the GitHub
integration layer ([`github-integration.spec.md`](./github-integration.spec.md)); when there is
no PR, `PrLink` and `StatusPill` are hidden and only `Continue`/`Archive` show.

`ReviewStatusBar` consumes the shared `ReviewStatusBarPr` type exported by
[`github-integration.spec.md`](./github-integration.spec.md) §2.3a (a `Pick<>` of
`PullRequestView`). Use its field names verbatim — `htmlUrl` (the `↗` target) and `status`
(the derived pill, §2.3a `PullRequestStatus`) — do NOT reintroduce an inline `url`/`state`
shape; that is what keeps these UI shapes agreeing across the two specs.

```typescript
import type { ReviewStatusBarPr } from "./github-integration"; // = Pick<PullRequestView, "number" | "htmlUrl" | "status">

interface ReviewStatusBarProps {
  pr?: ReviewStatusBarPr; // { number; htmlUrl; status: "open" | "draft" | "merged" | "closed" }
  onContinue: () => void;
  onArchive: () => void;
}
```

Status-pill colors (dark theme, TerminalX palette), keyed by `pr.status`:

| status   | classes                                        |
| -------- | ---------------------------------------------- |
| `open`   | `bg-[#002a17] text-[#00ff88] border-[#00cc6e]` |
| `draft`  | `bg-[#14161e] text-[#6b7569] border-[#1a1d24]` |
| `merged` | `bg-[#1e1430] text-[#d58fff] border-[#7a4fb8]` |
| `closed` | `bg-[#2a0a0a] text-[#ff5050] border-[#a13d3d]` |

### 4.2 `ReviewTabs` (shared shell)

Same construction as today's `RightPanel` tab row (`h-12`, `border-b border-[#1a1d24]`,
`bg-[#0f1117]`), but with the four screenshot tabs. The `Changes` tab carries a count badge
(`summary.filesChanged`) and the `Review` tab uses the `Eye` icon from `lucide-react`.

```typescript
type ReviewTab = "files" | "changes" | "checks" | "review";

const TABS = [
  { id: "files", label: "All files", icon: Files },
  { id: "changes", label: "Changes", icon: GitCompare, badge: summary?.filesChanged },
  { id: "checks", label: "Checks", icon: CircleCheck },
  { id: "review", label: "Review", icon: Eye },
] as const;
```

### 4.3 `FileDiffRow` — the screenshot file row

Path with the **filename emphasized**, the directory **muted**, a **`+N`/`-N`** delta badge,
and a status icon — exactly the `.terminalx/settings.toml … +19` row.

```tsx
function FileDiffRow({ file, collapsed, onToggle }: FileDiffRowProps) {
  return (
    <div className="border-b border-[#1a1d24]">
      <button
        onClick={onToggle}
        className="flex h-9 w-full items-center gap-2 px-3 text-[12px] hover:bg-[#14161e]"
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <StatusIcon status={file.status} />
        <span className="truncate">
          <span className="text-[#6b7569]">{file.dir}</span>
          <span className="font-medium text-[#e6f0e4]">{file.filename}</span>
        </span>
        <span className="flex-1" />
        {file.additions > 0 && <span className="text-[#00ff88]">+{file.additions}</span>}
        {file.deletions > 0 && <span className="text-[#ff5050]">-{file.deletions}</span>}
      </button>
      {!collapsed && <FileDiffBody fileId={file.id} path={file.path} /* lazy §3.3 */ />}
    </div>
  );
}
```

`StatusIcon` mapping (`lucide-react`): added → `FilePlus` (green), modified → `FilePen`
(cyan `#5ccfe6`), deleted → `FileMinus` (red), renamed → `FileSymlink` (purple `#d58fff`).

### 4.4 `ChangesTab`

Owns prefs, fetches the file list from §3.1 (or §3.2 stream when the row count is unknown),
and renders `FileDiffList`. Collapsed-by-default for large files (`> 600` changed lines), so
the panel stays responsive.

```typescript
function ChangesTab({ session }: { session: string }) {
  const { data, loading, error } = useSessionDiff(session); // GET /api/sessions/[name]/diff
  const [prefs, setPrefs] = useDiffPrefs(); // localStorage "terminalx:diff-prefs"
  // ... renders ChangesToolbar + FileDiffList(data.files, prefs)
}
```

---

## 5. Unified vs side-by-side

Owned per-file by `HunkView`, toggled globally from `ChangesToolbar` (`prefs.layout`).

### Unified

```
@@ -10,5 +12,8 @@ export function foo() {
 10  12   const x = 1
     13  +const y = 2          ← addition
 11      -console.log(x)       ← deletion
 12  14   return x
```

### Side-by-side (split)

```
┌ old ─────────────────────┬ new ─────────────────────┐
│ 10 │ const x = 1          │ 12 │ const x = 1          │
│    │                      │ 13 │ const y = 2          │ ← addition (right only)
│ 11 │ console.log(x)       │    │                      │ ← deletion (left only)
│ 12 │ return x             │ 14 │ return x             │
└──────────────────────────┴──────────────────────────┘
```

`HunkView` pairs lines for split mode: a deletion pairs with an empty right cell, an addition
with an empty left cell, context aligns on both sides.

```typescript
function pairLines(lines: DiffLine[]): Array<[DiffLine | null, DiffLine | null]> {
  const pairs: Array<[DiffLine | null, DiffLine | null]> = [];
  const dels: DiffLine[] = [],
    adds: DiffLine[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) pairs.push([dels[i] ?? null, adds[i] ?? null]);
    dels.length = 0;
    adds.length = 0;
  };
  for (const l of lines) {
    if (l.type === "deletion") dels.push(l);
    else if (l.type === "addition") adds.push(l);
    else {
      flush();
      pairs.push([l, l]);
    }
  }
  flush();
  return pairs;
}
```

**Responsive:** split needs width; below `~900px` panel width the toggle is disabled and the
view falls back to unified. Width is observed via a `ResizeObserver` on the panel body. (Note
the current right panel is a fixed-width `<aside>` — `w-[360px]`, `2xl:w-[400px]` — so split is
effectively never available at today's widths; it becomes meaningful only if the panel is made
resizable per §9.1.)

---

## 6. Virtualization & large diffs

- **File list:** when `files.length > 80`, virtualize `FileDiffList` (only the visible rows +
  a small overscan render). Each row is fixed-height (`h-9`), so a simple windowed list
  suffices — no measurement pass.
- **Hunk bodies:** loaded lazily (§3.3) only when a row expands, so collapsed files cost one
  DOM row each.
- **Large files:** files over `maxFileSize` (default 512 KB) come back with `truncated: true`
  and no `hunks`; the body shows "File too large to display — open externally" with a button
  to open it in the `All files` browser.
- **Long expanded files:** within a single expanded `FileDiffBody`, if line count `> 1500`,
  virtualize the line rows too (windowed, fixed line height).
- **Binary files:** `isBinary` rows render "Binary file changed" with the delta badge omitted.

---

## 7. Hunk collapsing

- Each `HunkHeader` (`@@ … @@`) is a toggle; collapsing hides that hunk's lines but keeps the
  header visible (so context is navigable).
- A per-file **"Expand all / Collapse all"** affordance sits in the `FileDiffBody` header.
- Large unchanged gaps between hunks render an **"Expand N lines"** stub; clicking it requests
  more context for that file via §3.3 with a larger `context`, or a dedicated
  `&expand=<oldStart>:<count>` extension.
- Collapsed **file** state lives in `prefs.collapsed` (persisted); collapsed **hunk** state is
  ephemeral component state.

---

## 8. Color & theming (dark)

Reuse the existing TerminalX palette (matches `RightPanel.tsx` / `WorkspaceView.tsx`):

```css
/* surfaces */
--bg: #0a0b10; /* panel */
--bg-raised: #0f1117; /* tab/header bars */
--bg-line: #14161e; /* hunk header, line gutter */
--border: #1a1d24;

/* diff lines */
.line-add {
  background: rgba(0, 255, 136, 0.08);
}
.line-add .txt {
  color: #00ff88;
}
.line-del {
  background: rgba(255, 80, 80, 0.08);
}
.line-del .txt {
  color: #ff5050;
}
.line-ctx .txt {
  color: #e6f0e4;
}
.gutter {
  color: #6b7569;
}
.hunk-header {
  background: #14161e;
  color: #5ccfe6;
  border-left: 2px solid #5ccfe6;
}
```

Status / delta accents: additions `#00ff88`, deletions `#ff5050`, modified/cyan `#5ccfe6`,
renamed/purple `#d58fff` — consistent with the status pill table in §4.1.

---

## 9. Integration

### 9.1 Replacing `RightPanel`

`ReviewPanel` supersedes `src/components/layout/RightPanel.tsx`. The migration keeps the
existing `All files` tab pointing at `FileBrowser`, folds `Logs`/`Snippets` into a secondary
menu (or the `Checks` tab where appropriate), and adds `Changes` / `Checks` / `Review`.
`RightPanel` is mounted by **`AppShell`** (`src/components/layout/AppShell.tsx`, line 231),
inside a fixed-width right `<aside>` (`hidden h-full w-[360px] … xl:flex 2xl:w-[400px]`) —
**not** by `WorkspaceView`, which renders only the terminal. So `ReviewPanel` replaces
`RightPanel` at that mount point and is scoped to `activeSession` (already resolved in
`AppShell`).

```tsx
// src/components/layout/AppShell.tsx — replace <RightPanel /> at the aside mount (line ~231)
<aside className="hidden h-full w-[360px] shrink-0 flex-col bg-[#0a0b10] xl:flex 2xl:w-[400px]">
  <div className="min-h-0 flex-1">
    <ReviewPanel session={activeSession} />
  </div>
  <InspectorTerminal activeSession={activeSession} />
</aside>
```

> **Current layout is a fixed-width aside, not a resizable panel.** The right panel today is a
> static `w-[360px]` (`2xl:w-[400px]`) `<aside>` in `AppShell`, not a `react-resizable-panels`
> `Panel`. Making it user-resizable is **optional/out of scope here**; if pursued, wrap the
> center `<section>` and the right `<aside>` in a `Group`/`Panel`/`Separator` layout in
> `AppShell` (not `WorkspaceView`):
>
> ```tsx
> import { Group, Panel, Separator } from "react-resizable-panels";
> // …
> <Group orientation="horizontal">
>   <Panel minSize={30}>{/* center <section> (TopNav + terminal + StatusBar) */}</Panel>
>   <Separator />
>   <Panel minSize={20} defaultSize={38}>
>     <ReviewPanel session={activeSession} />
>   </Panel>
> </Group>;
> ```
>
> `react-resizable-panels` ^4.11.0 exports `Group` / `Panel` / `Separator` (verified in
> `node_modules/react-resizable-panels/dist/react-resizable-panels.d.ts`) — there is no
> `PanelGroup` or `PanelResizeHandle` in this version.

### 9.2 Data hook

```typescript
// src/hooks/useSessionDiff.ts (new)
export function useSessionDiff(session: string) {
  // GET /api/sessions/[encodeURIComponent(session)]/diff
  // returns { data: DiffResponse | null, loading, error, refresh }
}
```

Refetch triggers: explicit refresh button, and the existing `terminalx:session-ended` /
session-change events that `useOpenTabs` and `WorkspaceView` already dispatch.

---

## 10. Acceptance criteria

- [ ] The Review panel shows the four tabs **All files / Changes(n) / Checks / Review** with
      the `Changes` count badge bound to `summary.filesChanged` and the `Review` tab using the
      eye icon.
- [ ] The top status bar shows the PR link **`#n ↗`**, a **Merged/Open/Draft/Closed** pill,
      **Continue**, and **Archive**; PR link + pill hide when there is no PR.
- [ ] File rows render **muted dir + emphasized filename**, a **`+N`/`-N`** delta badge, and a
      status icon — verified against `.terminalx/settings.toml … +19`.
- [ ] `GET /api/sessions/[name]/diff` returns the file list (no hunks) for the session's
      worktree branch vs its merge-base, gated by the `shouldScope && canAccessSession`
      per-session pattern (403, never 401), with sandbox confinement and sanitized errors
      reusing the `/api/files` mapping.
- [ ] Expanding a row lazily fetches hunks via `…/diff/file?path=…`.
- [ ] Unified ⇄ split toggle works; split falls back to unified below ~900px panel width.
- [ ] File list virtualizes past 80 files; truncated/binary files render placeholders, not
      content.
- [ ] Hunk headers collapse/expand; per-file expand-all/collapse-all works; "Expand N lines"
      stubs fetch more context.
- [ ] Layout/word-wrap/collapsed-file prefs persist to `localStorage["terminalx:diff-prefs"]`.

---

## 11. Edge cases

| Case                                                          | Behavior                                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Session has no worktree                                       | Fall back to `getGitDirectoryInfo(cwd)`; if not a repo → 404 "Not a git repository".                |
| `base` unresolvable (e.g. detached, no default branch)        | Diff `head` against its parent (`head~1`); surface a banner "No base branch — showing last commit". |
| No changes                                                    | `files: []`, `Changes(0)`; empty state "No changes in this workspace."                              |
| `repoPath` outside `TERMINUS_ROOT`                            | 403 "Access denied" (via `resolveSafePath`).                                                        |
| Sensitive path (`.git`, dotfiles deny-list)                   | 403 (via `assertNotSensitivePath`).                                                                 |
| Non-admin in multi-user mode accessing another user's session | 403 (via `canAccessSession`).                                                                       |
| Very large branch (1000s of files)                            | `maxFiles` cap + stream (§3.2); list paints progressively.                                          |
| Binary / image file                                           | Row shows status + name, no delta, "Binary file changed" body.                                      |
| Renamed file                                                  | `oldPath` shown as `old → new`; `similarity` in the body header.                                    |
| Mode-only change (e.g. `100644 → 100755`)                     | `mode-change` status; body shows the mode delta, no line hunks.                                     |
| CRLF / mixed EOL                                              | Diff computed by `git` as-is; renderer does not normalize.                                          |
| `git` timeout / `maxBuffer` exceeded                          | 500 with generic "Failed to compute diff" (no path leakage).                                        |

---

## 12. Testing

- **API:** worktree resolution from `SessionMeta.worktree` vs `getGitDirectoryInfo` fallback;
  three-dot range correctness; path-confinement (outside-root → 403, sensitive → 403); auth
  gate (`shouldScope` + wrong user → 403; admin/local mode passes through; never 401);
  name-status/numstat merge into `FileDiff[]`.
- **Components:** `FileDiffRow` emphasis + delta + status icon; `pairLines` for split mode;
  hunk collapse; virtualization above 80 files; truncated/binary placeholders.
- **Shell:** `ReviewTabs` renders the four tabs with the count badge; `ReviewStatusBar` hides
  PR link/pill when `pr` is undefined and shows Continue/Archive always.
- **Prefs:** layout/word-wrap/collapsed persistence round-trips through localStorage.

---

## Summary

| Aspect         | Decision                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Surface**    | The **Changes** tab of the Review panel (not standalone), sharing the shell with All files / Checks / Review.                                                   |
| **Shell**      | Top status bar (`#n ↗`, Merged/Open/Draft pill, Continue, Archive) + tab row, owned in `ReviewPanel`, replacing `RightPanel.tsx`.                               |
| **File row**   | muted dir + emphasized filename + `+N`/`-N` + status icon (`.terminalx/settings.toml … +19`).                                                                   |
| **Data model** | `DiffResponse → FileDiff → DiffHunk → DiffLine`; hunks lazy.                                                                                                    |
| **API**        | `GET /api/sessions/[name]/diff` (list, optional `stream=1`) + `…/diff/file` (lazy hunks), diffing the worktree branch vs merge-base.                            |
| **Layouts**    | Unified / split, split degrades to unified under ~900px.                                                                                                        |
| **Perf**       | Virtualized list (>80 files) + lazy hunks + truncation for large/binary files.                                                                                  |
| **Grounding**  | `ai-sessions.ts`, `git-worktree.ts`, `file-service.ts`, `session-scope.ts`, `RightPanel.tsx`, `AppShell.tsx` (the mount host), `useOpenTabs.ts` (all verified). |

</content>
</invoke>

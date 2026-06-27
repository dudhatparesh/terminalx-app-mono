# #12 — Workspaces & Worktrees (CORRECTED model)

> **Authoritative model (from the user's Conductor screenshot).** Earlier drafts INVERTED this — do not
> repeat that. The hierarchy is **Workspace → many Worktrees**.

## Concept

- **Workspace** = a project / repo container (e.g. `terminalx-app-mono`). It maps to one git repository.
  The sidebar shows the workspace as a header (avatar + name) with a **`+`** button that creates a **new
  worktree** inside it. A workspace is **DELETED** (removed entirely) — it is never "archived".
- **Worktree** = one task running inside a workspace = a **git worktree + branch + agent session**. This
  is exactly what TerminalX already creates today (issue #10 / `createGitWorktreeForSession` + a session).
  A workspace contains MANY worktrees. Worktrees are what get **collapsed** and **archived** (issue #9),
  individually.

So the existing "session with a git worktree" IS a worktree. #12 adds the **Workspace layer on top** that
groups worktrees, plus the rich sidebar.

## Sidebar (in `src/components/layout/AppShell.tsx`, left rail)

```
▸ ⬚ terminalx-app-mono                              +     ← workspace header (name + add-worktree)
    ⋮  Conductor parity…                    +32k  -79     ← worktree: ⋮ menu, name, diff stat
    ⎇  Symlink skills and agents md          +217  -2     ← worktree: status icon, name, diff stat
    ⤬  chore(conductor): add settings…             +19    ← worktree: merged-PR icon (purple), diff stat
```

Each **worktree row** shows:

- A **status icon** derived from git + PR state: in-progress (branch `⎇`), open PR, **loading** (spinner
  while diff/PR status resolves), **merged** (purple PR icon), "open to merge". Reuse the GitHub layer
  (#7) PR status (merged/open/draft) + local git state.
- The worktree **name** (its branch / task title), truncated.
- Its **git diff stat** `+additions −deletions` vs the workspace base branch — reuse the diff API from #2
  (`src/lib/git-diff.ts` numstat) so the sidebar and the Changes tab agree.
- A **`⋮` menu** with **Collapse** and **Archive** (archive = issue #9, operates on this worktree).

The **workspace header** has the `+` (new worktree) and a context menu with **Delete workspace** (removes
the project registration and all its worktrees — distinct from archiving a worktree).

## Data model

- New `Workspace { id; repoRoot; name; createdAt }` persisted like other metadata (JSON file under `data/`
  via `withLock`/atomic write, mode 0600), keyed by `repoRoot`.
- A **worktree is an existing session** that has `SessionMeta.worktree` (added in #10). Group worktrees
  under a workspace by matching `SessionMeta.worktree.repoRoot === Workspace.repoRoot`. No separate
  worktree store is needed — derive the worktree list from sessions + their worktree metadata.
- Per-worktree derived view: `{ session, branch, diffStat:{additions,deletions}, status, collapsed,
archived }`. `archived`/`collapsed` are stored on the session meta (see #9).

## API

- `GET /api/workspaces` → workspaces, each with its worktrees (derived from sessions) incl. diff stat +
  status. Diff stat via the existing git-diff numstat; PR status via the GitHub layer (#7), best-effort
  and cached (don't block the sidebar — return `status:"loading"` then refresh).
- `POST /api/workspaces` → register a workspace for a selected repo directory (validates it's a git repo
  via `getGitDirectoryInfo`, confined to `TERMINUS_ROOT`).
- `DELETE /api/workspaces/[id]` → delete the workspace + remove its worktrees (calls `removeGitWorktree`
  for each, per #9 semantics) — distinct from archive.
- Creating a worktree reuses the existing session-create flow (`POST /api/sessions` with a worktree),
  associated to the workspace by `repoRoot`. The `+` button opens the existing new-session dialog
  pre-scoped to the workspace's repo.

## Acceptance criteria

- [ ] Sidebar groups worktrees under workspace headers; a workspace with N worktrees shows them nested.
- [ ] Workspace header `+` creates a new worktree (branch + git worktree + session) inside that workspace.
- [ ] Each worktree row shows status icon + name + diff stat (`+N/−N`), matching the Changes tab.
- [ ] `⋮` menu on a worktree offers Collapse and Archive (archive per #9).
- [ ] Merged worktrees show the merged (purple) icon; in-progress show the branch icon; loading shows a spinner.
- [ ] Workspace context menu offers **Delete workspace** (removes project + its worktrees), separate from archive.
- [ ] `data-testid`s on the workspace header, `+`, each worktree row, the diff stat, and the `⋮` menu.

## Out of scope (handled elsewhere)

- Archiving/restoring a worktree → issue #9 (`archive-cleanup.spec.md`).
- The diff/Changes content → #2. PR status → #7.

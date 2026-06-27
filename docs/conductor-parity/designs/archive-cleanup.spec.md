# #9 — Archive & Cleanup (CORRECTED model)

> **Authoritative model (from the user's Conductor screenshot + correction).** Archive and Delete operate
> at DIFFERENT levels. See `multi-workspace.spec.md` for the Workspace → Worktree hierarchy.

## What archives vs. what deletes

- **Archive operates on a WORKTREE** (= a git worktree + branch + session inside a workspace). Archiving a
  worktree: marks it `archived` (and removes it from the active sidebar list / collapses it), optionally
  removes the on-disk git worktree via `removeGitWorktree` while **keeping the branch** so it can be
  restored. The **Archive** button in the review panel (top bar, shown in the Wave-1 screenshots) archives
  the **current worktree**.
- **Delete operates on a WORKSPACE** (= the project/repo container). Deleting a workspace removes the
  project registration **and all its worktrees** (each via `removeGitWorktree`). Workspaces are never
  "archived"; worktrees are never "deleted" as a primary action (archive is the worktree analog).

## Worktree archive

- `SessionMeta` gains `archived?: boolean`, `archivedAt?: string`, `collapsed?: boolean`. Archived
  worktrees drop out of the default sidebar/session lists but remain queryable.
- `POST /api/sessions/[name]/archive` → set `archived`, optionally `removeWorktree` (default true): call
  `removeGitWorktree(worktreePath, repoRoot, linkedPaths)` — which already unlinks symlinks without
  touching the shared source (#10) — but DO NOT delete the branch (restore needs it).
- **Auto-archive policy**: archive a worktree automatically when its PR is **merged** (detected via the
  GitHub layer #7 PR status → `merged`), and optionally an age-based sweep (configurable, off by default).
- **Restore**: `POST /api/sessions/[name]/restore` → recreate the git worktree from the preserved branch
  (`git worktree add <path> <branch>`), clear `archived`, re-link shared paths (#10).

## Workspace delete

- `DELETE /api/workspaces/[id]` (defined in #12): for each worktree under the workspace call
  `removeGitWorktree`, delete their session metadata, then remove the workspace registration. Irreversible
  (unlike worktree archive). Confirm in the UI.

## Cleanup

- Removing a worktree cleans its session recording(s) under `data/recordings/` (best-effort) on a
  confirmed delete; archived (not deleted) worktrees keep their recordings until purged.
- A periodic best-effort sweep prunes orphaned worktree dirs under the worktrees root whose sessions no
  longer exist (reuse `worktreesBaseDir`, validate via `assertNotSensitivePath`).

## UI

- The worktree `⋮` menu (sidebar, from #12) and the review-panel **Archive** button trigger worktree
  archive. An **Archived** filter/section lets the user view + **Restore** archived worktrees.
- The workspace context menu's **Delete workspace** triggers the workspace delete (with confirm).

## Acceptance criteria

- [ ] Archive a worktree: marked archived, git worktree removed (symlinks unlinked, source untouched),
      branch preserved; it leaves the active list.
- [ ] Restore an archived worktree recreates its git worktree from the branch and re-links shared paths.
- [ ] Auto-archive a worktree when its PR merges.
- [ ] Delete a workspace removes the project + all its worktrees (each via `removeGitWorktree`); confirmed.
- [ ] Archived-worktrees view with Restore; cleanup removes recordings only on delete, not on archive.
- [ ] `data-testid`s on archive/restore/delete controls.

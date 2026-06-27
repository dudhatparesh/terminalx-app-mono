# #9 — Archive & Cleanup (CORRECTED model)

> **Authoritative model (from the user's Conductor screenshot + correction).** Archive and Delete operate
> at DIFFERENT levels. See `projects-workspaces.spec.md` for the Project → Workspace hierarchy.

## What archives vs. what deletes

- **Archive operates on a WORKSPACE** (= a git worktree + branch + session inside a project). Archiving a
  workspace: marks it `archived` (and removes it from the active sidebar list / collapses it), optionally
  removes the on-disk git worktree via `removeGitWorktree` while **keeping the branch** so it can be
  restored. The **Archive** button in the review panel (top bar, shown in the Wave-1 screenshots) archives
  the **current workspace**.
- **Delete operates on a PROJECT** (= the repo container). Deleting a project removes the project
  registration **and all its workspaces** (each via `removeGitWorktree`). Projects are never "archived";
  workspaces are never "deleted" as a primary action (archive is the workspace analog).

## Workspace archive

- `SessionMeta` gains `archived?: boolean`, `archivedAt?: string`, `collapsed?: boolean`. Archived
  workspaces drop out of the default sidebar/session lists but remain queryable.
- `POST /api/sessions/[name]/archive` → set `archived`, optionally `removeWorktree` (default true): call
  `removeGitWorktree(worktreePath, repoRoot, linkedPaths)` — which already unlinks symlinks without
  touching the shared source (#10) — but DO NOT delete the branch (restore needs it).
- **Auto-archive policy**: archive a workspace automatically when its PR is **merged** (detected via the
  GitHub layer #7 PR status → `merged`), and optionally an age-based sweep (configurable, off by default).
- **Restore**: `POST /api/sessions/[name]/restore` → recreate the git worktree from the preserved branch
  (`git worktree add <path> <branch>`), clear `archived`, re-link shared paths (#10).

## Project delete

- `DELETE /api/projects/[id]` (defined in #12): for each workspace under the project call
  `removeGitWorktree`, delete their session metadata, then remove the project registration. Irreversible
  (unlike workspace archive). Confirm in the UI.

## Cleanup

- Removing a workspace cleans its session recording(s) under `data/recordings/` (best-effort) on a
  confirmed delete; archived (not deleted) workspaces keep their recordings until purged.
- A periodic best-effort sweep prunes orphaned worktree dirs under the worktrees root whose sessions no
  longer exist (reuse `worktreesBaseDir`, validate via `assertNotSensitivePath`).

## UI

- The workspace `⋮` menu (sidebar, from #12) and the review-panel **Archive** button trigger workspace
  archive. An **Archived** filter/section lets the user view + **Restore** archived workspaces.
- The project context menu's **Delete project** triggers the project delete (with confirm).

## Acceptance criteria

- [ ] Archive a workspace: marked archived, git worktree removed (symlinks unlinked, source untouched),
      branch preserved; it leaves the active list.
- [ ] Restore an archived workspace recreates its git worktree from the branch and re-links shared paths.
- [ ] Auto-archive a workspace when its PR merges.
- [ ] Delete a project removes the project + all its workspaces (each via `removeGitWorktree`); confirmed.
- [ ] Archived-workspaces view with Restore; cleanup removes recordings only on delete, not on archive.
- [ ] `data-testid`s on archive/restore/delete controls.

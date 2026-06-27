# #12 — Projects & Workspaces (CORRECTED model)

> **Authoritative model (from the user's Conductor screenshot).** Earlier drafts INVERTED this — do not
> repeat that. The hierarchy is **Project → many Workspaces**.

## Concept

- **Project** = a repo container (e.g. `terminalx-app-mono`). It maps to one git repository. The sidebar
  shows the project as a header (avatar + name) with a **`+`** button that creates a **new workspace**
  inside it. A project is **DELETED** (removed entirely) — it is never "archived".
- **Workspace** = one task running inside a project = a **git worktree + branch + agent session**. This is
  exactly what TerminalX already creates today (issue #10 / `createGitWorktreeForSession` + a session). A
  project contains MANY workspaces. Workspaces are what get **collapsed** and **archived** (issue #9),
  individually.

So the existing "session with a git worktree" IS a workspace. #12 adds the **Project layer on top** that
groups workspaces, plus the rich sidebar.

## Sidebar (in `src/components/layout/AppShell.tsx`, left rail)

```
▸ ⬚ terminalx-app-mono                              +     ← project header (name + add-workspace)
    ⋮  Conductor parity…                    +32k  -79     ← workspace: ⋮ menu, name, diff stat
    ⎇  Symlink skills and agents md          +217  -2     ← workspace: status icon, name, diff stat
    ⤬  chore(conductor): add settings…             +19    ← workspace: merged-PR icon (purple), diff stat
```

Each **workspace row** shows:

- A **status icon** derived from git + PR state: in-progress (branch `⎇`), open PR, **loading** (spinner
  while diff/PR status resolves), **merged** (purple PR icon), "open to merge". Reuse the GitHub layer
  (#7) PR status (merged/open/draft) + local git state.
- The workspace **name** (its branch / task title), truncated.
- Its **git diff stat** `+additions −deletions` vs the project base branch — reuse the diff API from #2
  (`src/lib/git-diff.ts` numstat) so the sidebar and the Changes tab agree.
- A **`⋮` menu** with **Collapse** and **Archive** (archive = issue #9, operates on this workspace).

The **project header** has the `+` (new workspace) and a context menu with **Delete project** (removes the
project registration and all its workspaces — distinct from archiving a workspace).

## Data model

- New `Project { id; repoRoot; name; createdAt }` persisted like other metadata (JSON file under `data/`
  via `withLock`/atomic write, mode 0600), keyed by `repoRoot`.
- A **workspace is an existing session** that has `SessionMeta.worktree` (added in #10). Group workspaces
  under a project by matching `SessionMeta.worktree.repoRoot === Project.repoRoot`. No separate workspace
  store is needed — derive the workspace list from sessions + their worktree metadata.
- Per-workspace derived view: `{ session, branch, diffStat:{additions,deletions}, status, collapsed,
archived }`. `archived`/`collapsed` are stored on the session meta (see #9).

## API

- `GET /api/projects` → projects, each with its workspaces (derived from sessions) incl. diff stat +
  status. Diff stat via the existing git-diff numstat; PR status via the GitHub layer (#7), best-effort
  and cached (don't block the sidebar — return `status:"loading"` then refresh).
- `POST /api/projects` → register a project for a selected repo directory (validates it's a git repo via
  `getGitDirectoryInfo`, confined to `TERMINUS_ROOT`).
- `DELETE /api/projects/[id]` → delete the project + remove its workspaces (calls `removeGitWorktree` for
  each, per #9 semantics) — distinct from archive.
- Creating a workspace reuses the existing session-create flow (`POST /api/sessions` with a worktree),
  associated to the project by `repoRoot`. The `+` button opens the existing new-session dialog pre-scoped
  to the project's repo.

## Acceptance criteria

- [ ] Sidebar groups workspaces under project headers; a project with N workspaces shows them nested.
- [ ] Project header `+` creates a new workspace (branch + git worktree + session) inside that project.
- [ ] Each workspace row shows status icon + name + diff stat (`+N/−N`), matching the Changes tab.
- [ ] `⋮` menu on a workspace offers Collapse and Archive (archive per #9).
- [ ] Merged workspaces show the merged (purple) icon; in-progress show the branch icon; loading shows a spinner.
- [ ] Project context menu offers **Delete project** (removes project + its workspaces), separate from archive.
- [ ] `data-testid`s on the project header, `+`, each workspace row, the diff stat, and the `⋮` menu.

## Out of scope (handled elsewhere)

- Archiving/restoring a workspace → issue #9 (`archive-cleanup.spec.md`).
- The diff/Changes content → #2. PR status → #7.

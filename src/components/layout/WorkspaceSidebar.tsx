"use client";

// Multi-workspace sidebar (issue #12, corrected Workspace → Worktree model).
//
// A Workspace is a PROJECT/REPO container rendered as a HEADER (name + "+"
// add-worktree + a context menu with "Delete workspace"). Its worktrees are
// nested rows: status icon + branch name + diff stat + a "⋮" menu (Collapse,
// Archive). Collapse/expand toggles the whole group.
//
// CLIENT/SERVER BOUNDARY: this file imports ONLY browser-safe modules
// (@/types/workspace formatters + the useWorkspaces hook, which fetches the
// API). It never imports the workspace store / resolve / git / github server
// modules — those use Node builtins and would break the client bundle.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Loader2,
  MoreVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { formatDiffStat, statusIcon } from "@/types/workspace";
import type { WorktreeStatus, WorktreeView, WorkspaceView } from "@/types/workspace";

function StatusIcon({ status }: { status: WorktreeStatus }) {
  const kind = statusIcon(status);
  if (kind === "spinner") {
    return (
      <Loader2 size={13} className="shrink-0 animate-spin text-[#6b7569]" data-testid="wt-icon-loading" />
    );
  }
  if (kind === "pr-merged") {
    return <GitMerge size={13} className="shrink-0 text-[#d58fff]" data-testid="wt-icon-merged" />;
  }
  if (kind === "pr-open") {
    return (
      <GitPullRequest size={13} className="shrink-0 text-[#00ff88]" data-testid="wt-icon-open" />
    );
  }
  return (
    <GitBranch size={13} className="shrink-0 text-[#6b7569]" data-testid="wt-icon-in-progress" />
  );
}

/** Lightweight popover menu anchored to its trigger; closes on outside click / Esc. */
function Menu({
  open,
  onClose,
  children,
  testid,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  testid: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      data-testid={testid}
      role="menu"
      className="absolute right-0 top-6 z-20 min-w-[150px] rounded border border-[#252933] bg-[#14161e] py-1 shadow-lg shadow-black/40"
    >
      {children}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
  danger,
  testid,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  testid?: string;
}) {
  return (
    <button
      role="menuitem"
      data-testid={testid}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[#1a1d24] ${
        danger ? "text-[#ff6b6b]" : "text-[#a8b3a6]"
      }`}
    >
      {children}
    </button>
  );
}

function WorktreeRow({
  worktree,
  activeSession,
  onOpen,
  onCollapse,
  onArchive,
}: {
  worktree: WorktreeView;
  activeSession: string | null;
  onOpen: (sessionName: string) => void;
  onCollapse: (sessionName: string, collapsed: boolean) => void;
  onArchive: (sessionName: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const active = worktree.sessionName === activeSession;
  const stat = formatDiffStat(worktree.diffStat);

  return (
    <div
      data-testid="worktree-row"
      data-session={worktree.sessionName}
      data-status={worktree.status}
      className={`group relative flex h-8 w-full items-center gap-2 rounded px-2 text-[12px] transition-colors ${
        active ? "bg-[#14161e] text-[#e6f0e4]" : "text-[#a8b3a6] hover:bg-[#14161e]"
      }`}
    >
      <button
        onClick={() => onOpen(worktree.sessionName)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        data-testid="worktree-open"
      >
        <StatusIcon status={worktree.status} />
        <span className="min-w-0 flex-1 truncate" data-testid="worktree-name">
          {worktree.branch}
        </span>
      </button>

      {stat && (
        <span
          data-testid="worktree-diffstat"
          className="shrink-0 font-mono text-[10px] tabular-nums text-[#6b7569]"
        >
          {worktree.diffStat.additions > 0 && (
            <span className="text-[#00cc6e]">+{worktree.diffStat.additions}</span>
          )}
          {worktree.diffStat.additions > 0 && worktree.diffStat.deletions > 0 && " "}
          {worktree.diffStat.deletions > 0 && (
            <span className="text-[#ff6b6b]">−{worktree.diffStat.deletions}</span>
          )}
        </span>
      )}

      <div className="relative shrink-0">
        <button
          data-testid="worktree-menu-trigger"
          aria-label="worktree menu"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-5 w-5 items-center justify-center rounded text-[#6b7569] opacity-0 transition-colors hover:bg-[#1a1d24] hover:text-[#e6f0e4] group-hover:opacity-100 data-[open=true]:opacity-100"
          data-open={menuOpen}
        >
          <MoreVertical size={13} />
        </button>
        <Menu open={menuOpen} onClose={() => setMenuOpen(false)} testid="worktree-menu">
          <MenuItem
            testid="worktree-menu-collapse"
            onClick={() => {
              onCollapse(worktree.sessionName, !worktree.collapsed);
              setMenuOpen(false);
            }}
          >
            <ChevronRight size={13} /> Collapse
          </MenuItem>
          <MenuItem
            testid="worktree-menu-archive"
            onClick={() => {
              onArchive(worktree.sessionName);
              setMenuOpen(false);
            }}
          >
            <Trash2 size={13} /> Archive
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
}

function WorkspaceGroup({
  workspace,
  activeSession,
  onOpenWorktree,
  onAddWorktree,
  onDelete,
  onCollapseWorktree,
  onArchiveWorktree,
}: {
  workspace: WorkspaceView;
  activeSession: string | null;
  onOpenWorktree: (sessionName: string) => void;
  onAddWorktree: (repoRoot: string) => void;
  onDelete: (id: string) => void;
  onCollapseWorktree: (sessionName: string, collapsed: boolean) => void;
  onArchiveWorktree: (sessionName: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  // Collapsed worktrees are hidden from the group (issue #9 keeps them in archive).
  const visible = workspace.worktrees.filter((w) => !w.collapsed && !w.archived);

  return (
    <div data-testid="workspace-group" data-workspace-id={workspace.id} className="mb-2">
      <div className="relative flex items-center gap-1.5 rounded px-1 py-1.5 text-[13px] text-[#e6f0e4]">
        <button
          data-testid="workspace-toggle"
          aria-label={expanded ? "collapse workspace" : "expand workspace"}
          onClick={() => setExpanded((e) => !e)}
          className="flex h-4 w-4 items-center justify-center rounded text-[#6b7569] hover:text-[#e6f0e4]"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className="flex h-5 w-5 items-center justify-center rounded bg-[#002a17] text-[10px] text-[#00ff88]">
          {workspace.name.slice(0, 2).toLowerCase()}
        </span>
        <span
          data-testid="workspace-name"
          className="min-w-0 flex-1 truncate font-medium"
          title={workspace.repoRoot}
        >
          {workspace.name}
        </span>
        <button
          data-testid="workspace-add-worktree"
          aria-label="new worktree"
          onClick={() => onAddWorktree(workspace.repoRoot)}
          className="flex h-5 w-5 items-center justify-center rounded text-[#6b7569] transition-colors hover:bg-[#14161e] hover:text-[#e6f0e4]"
        >
          <Plus size={13} />
        </button>
        <div className="relative shrink-0">
          <button
            data-testid="workspace-menu-trigger"
            aria-label="workspace menu"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-5 w-5 items-center justify-center rounded text-[#6b7569] transition-colors hover:bg-[#14161e] hover:text-[#e6f0e4]"
          >
            <MoreVertical size={13} />
          </button>
          <Menu open={menuOpen} onClose={() => setMenuOpen(false)} testid="workspace-menu">
            <MenuItem
              testid="workspace-menu-delete"
              danger
              onClick={() => {
                onDelete(workspace.id);
                setMenuOpen(false);
              }}
            >
              <Trash2 size={13} /> Delete workspace
            </MenuItem>
          </Menu>
        </div>
      </div>

      {expanded && (
        <div className="mt-0.5 space-y-0.5 pl-3" data-testid="workspace-worktrees">
          {visible.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] text-[#6b7569]">no worktrees</div>
          ) : (
            visible.map((wt) => (
              <WorktreeRow
                key={wt.sessionName}
                worktree={wt}
                activeSession={activeSession}
                onOpen={onOpenWorktree}
                onCollapse={onCollapseWorktree}
                onArchive={onArchiveWorktree}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function WorkspaceSidebar({ activeSession }: { activeSession: string | null }) {
  const router = useRouter();
  const { workspaces, isLoading, deleteWorkspace, setWorktreeCollapsed, archiveWorktree } =
    useWorkspaces();

  const openWorktree = (sessionName: string) => {
    router.push(`/workspace/${encodeURIComponent(sessionName)}`);
  };

  // The "+" opens the existing new-session dialog pre-scoped to this repo so a
  // new worktree lands inside the workspace's project (#12).
  const addWorktree = (repoRoot: string) => {
    router.push(`/dashboard?newWorktree=${encodeURIComponent(repoRoot)}`);
  };

  const handleDelete = (id: string) => {
    void deleteWorkspace(id);
  };

  return (
    <div className="mt-1 space-y-1" data-testid="workspace-sidebar">
      {isLoading && workspaces.length === 0 ? (
        <div className="px-2 py-3 text-[11px] text-[#6b7569]">loading workspaces…</div>
      ) : workspaces.length === 0 ? (
        <div className="px-2 py-3 text-[11px] text-[#6b7569]" data-testid="workspace-empty">
          no workspaces yet
        </div>
      ) : (
        workspaces.map((ws) => (
          <WorkspaceGroup
            key={ws.id}
            workspace={ws}
            activeSession={activeSession}
            onOpenWorktree={openWorktree}
            onAddWorktree={addWorktree}
            onDelete={handleDelete}
            onCollapseWorktree={(name, collapsed) => void setWorktreeCollapsed(name, collapsed)}
            onArchiveWorktree={(name) => void archiveWorktree(name)}
          />
        ))
      )}
    </div>
  );
}

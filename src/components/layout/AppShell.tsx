"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { ChevronRight, History, Plus, Settings } from "lucide-react";
import { TopNav } from "./TopNav";
import { StatusBar } from "./StatusBar";
// Multi-workspace sidebar (#12): the left rail groups worktrees under their
// workspace (project/repo) header. WorkspaceSidebar is boundary-clean (it only
// imports browser-safe types + the fetch hook, never the server store/git).
import { WorkspaceSidebar } from "./WorkspaceSidebar";
// feature #2 (diff viewer): the right aside now hosts the Review panel, whose
// "Changes" tab is the diff viewer. ReviewPanel supersedes RightPanel (spec §9.1).
import { ReviewPanel } from "@/components/review/ReviewPanel";
import { CommandPalette } from "./CommandPalette";
import { useOpenTabs } from "@/hooks/useOpenTabs";

function LeftSidebar({
  activeSession,
  onOpenPalette,
}: {
  activeSession: string | null;
  onOpenPalette?: () => void;
}) {
  const router = useRouter();
  const path = usePathname();

  return (
    <aside className="hidden lg:flex h-full w-[286px] shrink-0 flex-col border-r border-[#1a1d24] bg-[#0f1117]">
      <div className="flex h-12 items-center gap-3 border-b border-[#1a1d24] px-3">
        <Link
          href="/dashboard"
          className="flex h-6 w-6 items-center justify-center rounded border border-[#252933] bg-[#002a17] text-[10px] font-medium text-[#00ff88] transition-colors hover:border-[#00cc6e] hover:text-[#e6f0e4]"
          aria-label="open dashboard"
        >
          tx
        </Link>
        <div className="flex-1" />
        <button
          onClick={onOpenPalette}
          className="flex h-6 w-6 items-center justify-center rounded text-[#6b7569] transition-colors hover:bg-[#14161e] hover:text-[#e6f0e4]"
          aria-label="open command palette"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto contain-scroll px-2 py-3">
        <Link
          href="/dashboard"
          className={`flex h-9 items-center gap-2 rounded px-2 text-[13px] transition-colors ${
            path.startsWith("/dashboard")
              ? "bg-[#14161e] text-[#e6f0e4]"
              : "text-[#a8b3a6] hover:bg-[#14161e] hover:text-[#e6f0e4]"
          }`}
        >
          <History size={14} className="text-[#6b7569]" />
          <span>History</span>
        </Link>

        <div className="mt-5 flex items-center px-1 text-[10px] uppercase tracking-wider text-[#6b7569]">
          <span>Workspaces</span>
          <span className="flex-1" />
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded p-1 text-[#6b7569] transition-colors hover:bg-[#14161e] hover:text-[#e6f0e4]"
            aria-label="new workspace"
            data-testid="sidebar-new-workspace"
          >
            <Plus size={12} />
          </button>
        </div>

        {/* #12: workspace (project) headers, each grouping its worktrees. */}
        <WorkspaceSidebar activeSession={activeSession} />
      </div>

      <div className="flex h-12 items-center gap-2 border-t border-[#1a1d24] px-3 text-[#6b7569]">
        <Link
          href="/settings"
          className="rounded p-1.5 transition-colors hover:bg-[#14161e] hover:text-[#e6f0e4]"
          aria-label="settings"
        >
          <Settings size={14} />
        </Link>
      </div>
    </aside>
  );
}

function InspectorTerminal({ activeSession }: { activeSession: string | null }) {
  return (
    <div className="h-[260px] shrink-0 border-t border-[#1a1d24] bg-[#0a0b10]">
      <div className="p-4 font-mono text-[12px] leading-6 text-[#a8b3a6]">
        <div className="text-[#6b7569]">
          terminalx <ChevronRight size={12} className="inline align-[-2px]" />{" "}
          {activeSession ?? "no-session"}
        </div>
        <div className="mt-3">
          <span className="text-[#00ff88]">$</span>{" "}
          <span className="text-[#e6f0e4]">
            {activeSession ? `tmux attach -t ${activeSession}` : "open a session"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hostname, setHostname] = useState("…");
  const params = useParams();
  const path = usePathname();
  const { tabs } = useOpenTabs();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setHostname(d.hostname ?? "localhost");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeSession =
    typeof params?.session === "string"
      ? params.session
      : path.startsWith("/workspace/")
        ? decodeURIComponent(path.split("/")[2] ?? "")
        : null;

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-[#05060a] text-[#e6f0e4]">
      <LeftSidebar activeSession={activeSession} onOpenPalette={() => setPaletteOpen(true)} />
      <section className="flex min-w-0 flex-1 flex-col border-r border-[#1a1d24] bg-[#0a0b10]">
        <TopNav
          hostname={hostname}
          activeSession={activeSession}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        <StatusBar hostname={hostname} session={activeSession} tabCount={tabs.length} />
      </section>
      <aside className="hidden h-full w-[360px] shrink-0 flex-col bg-[#0a0b10] xl:flex 2xl:w-[400px]">
        <div className="min-h-0 flex-1">
          {/* feature #2: ReviewPanel (All files / Changes / Checks / Review),
              scoped to the active session. The Changes tab is the diff viewer. */}
          <ReviewPanel session={activeSession} />
        </div>
        <InspectorTerminal activeSession={activeSession} />
      </aside>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

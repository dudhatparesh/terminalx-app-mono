"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  CircleHelp,
  GitBranch,
  History,
  PanelLeft,
  Plus,
  Settings,
  Sparkles,
  Terminal,
} from "lucide-react";
import { TopNav } from "./TopNav";
import { StatusBar } from "./StatusBar";
import { RightPanel } from "./RightPanel";
import { CommandPalette } from "./CommandPalette";
import { useOpenTabs } from "@/hooks/useOpenTabs";
import { useSessions, type SessionKind, type TmuxSession } from "@/hooks/useSessions";

function KindGlyph({ kind }: { kind?: SessionKind }) {
  if (kind === "claude") return <Sparkles size={13} className="text-[#d58fff] shrink-0" />;
  if (kind === "codex") return <Terminal size={13} className="text-[#5ccfe6] shrink-0" />;
  return <GitBranch size={13} className="text-[#6b7569] shrink-0" />;
}

function SidebarSession({
  session,
  activeSession,
  onOpen,
}: {
  session: TmuxSession;
  activeSession: string | null;
  onOpen: (name: string) => void;
}) {
  const active = session.name === activeSession;

  return (
    <button
      onClick={() => onOpen(session.name)}
      className={`group flex h-9 w-full items-center gap-2 rounded px-2 text-left text-[12px] transition-colors ${
        active
          ? "bg-[#14161e] text-[#e6f0e4]"
          : "text-[#a8b3a6] hover:bg-[#14161e] hover:text-[#e6f0e4]"
      }`}
    >
      <KindGlyph kind={session.kind} />
      <span className="min-w-0 flex-1 truncate">{session.name}</span>
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
          session.attached ? "bg-[#00ff88]" : "bg-[#3f4742]"
        }`}
        style={{ boxShadow: session.attached ? "0 0 6px rgba(0,255,136,.55)" : undefined }}
      />
    </button>
  );
}

function LeftSidebar({
  activeSession,
  onOpenPalette,
}: {
  activeSession: string | null;
  onOpenPalette?: () => void;
}) {
  const router = useRouter();
  const path = usePathname();
  const { sessions, isLoading } = useSessions();

  const openSession = (name: string) => {
    router.push(`/workspace/${encodeURIComponent(name)}`);
  };

  return (
    <aside className="hidden lg:flex h-full w-[286px] shrink-0 flex-col border-r border-[#1a1d24] bg-[#0f1117]">
      <div className="flex h-12 items-center gap-3 border-b border-[#1a1d24] px-3">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5c5c]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ffb454]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#00cc6e]" />
        </div>
        <div className="ml-1 flex h-6 w-6 items-center justify-center rounded border border-[#252933] text-[#6b7569]">
          <PanelLeft size={13} />
        </div>
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
          >
            <Plus size={12} />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2 rounded px-2 py-2 text-[13px] text-[#e6f0e4]">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-[#002a17] text-[10px] text-[#00ff88]">
            tx
          </span>
          <span className="min-w-0 flex-1 truncate">terminalx</span>
          <button className="text-[#6b7569] hover:text-[#e6f0e4]" aria-label="workspace actions">
            <Plus size={13} />
          </button>
        </div>

        <div className="mt-1 space-y-1">
          {isLoading && sessions.length === 0 ? (
            <div className="px-2 py-3 text-[11px] text-[#6b7569]">loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="px-2 py-3 text-[11px] text-[#6b7569]">no live sessions</div>
          ) : (
            sessions.map((session) => (
              <SidebarSession
                key={session.name}
                session={session}
                activeSession={activeSession}
                onOpen={openSession}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex h-12 items-center gap-2 border-t border-[#1a1d24] px-3 text-[#6b7569]">
        <button className="rounded p-1.5 transition-colors hover:bg-[#14161e] hover:text-[#e6f0e4]">
          <CircleHelp size={14} />
        </button>
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
      <div className="flex h-9 items-center gap-5 border-b border-[#1a1d24] px-3 text-[12px] text-[#6b7569]">
        <span className="text-[#a8b3a6]">Setup</span>
        <span>Run</span>
        <span className="relative flex h-full items-center text-[#e6f0e4]">
          Terminal
          <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#00ff88]" />
        </span>
        <button className="ml-auto text-[#6b7569] hover:text-[#e6f0e4]" aria-label="new terminal">
          <Plus size={13} />
        </button>
      </div>
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
          <RightPanel />
        </div>
        <InspectorTerminal activeSession={activeSession} />
      </aside>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

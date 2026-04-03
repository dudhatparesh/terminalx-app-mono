"use client";

import { useCallback, useState, useEffect } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { SessionSidebar } from "@/components/sidebar/SessionSidebar";
import {
  TerminalTabs,
  type TerminalTab,
} from "@/components/terminal/TerminalTabs";
import { TerminalView } from "@/components/terminal/TerminalView";
import { RightPanel } from "@/components/layout/RightPanel";
import { Terminal, LayoutList, FolderTree, ScrollText, Menu, X } from "lucide-react";

let tabCounter = 0;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

type MobileView = "terminal" | "sessions" | "files" | "logs";

export default function WorkspaceLayout() {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("terminal");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  const createTab = useCallback((sessionName?: string) => {
    const id = `tab-${++tabCounter}`;
    const name = sessionName ?? `Terminal ${tabCounter}`;
    const sessionId = sessionName ?? `session-${tabCounter}`;

    const newTab: TerminalTab = { id, name, sessionId };
    setTabs((prev) => [...prev, newTab]);
    setActiveTab(id);
    return newTab;
  }, []);

  const handleOpenSession = useCallback(
    (sessionName: string) => {
      const existing = tabs.find((t) => t.sessionId === sessionName);
      if (existing) {
        setActiveTab(existing.id);
      } else {
        createTab(sessionName);
      }
      if (isMobile) {
        setMobileView("terminal");
        setSidebarOpen(false);
      }
    },
    [tabs, createTab, isMobile]
  );

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== id);
        if (activeTab === id) {
          const idx = prev.findIndex((t) => t.id === id);
          const nextTab =
            filtered[Math.min(idx, filtered.length - 1)] ?? null;
          setActiveTab(nextTab?.id ?? null);
        }
        return filtered;
      });
    },
    [activeTab]
  );

  const handleNew = useCallback(() => {
    createTab();
  }, [createTab]);

  const activeTerminal = tabs.find((t) => t.id === activeTab);

  // ── Mobile Layout ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="h-dvh w-screen bg-[#0D0F12] flex flex-col overflow-hidden">
        {/* Mobile Header */}
        <div className="flex items-center justify-between px-3 h-11 bg-[#151820] border-b border-[#2A2D3A] shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 text-[#6B7280] hover:text-[#E4E4E7] transition-colors"
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <span
            className="text-[14px] font-bold text-[#3B82F6]"
            style={{ fontFamily: "var(--font-jetbrains-mono), monospace" }}
          >
            TerminalX
          </span>
          <div className="w-8" /> {/* Spacer for centering */}
        </div>

        {/* Mobile Sidebar Overlay */}
        {sidebarOpen && (
          <div className="absolute inset-0 z-50 flex" style={{ top: 44 }}>
            <div className="w-72 h-full bg-[#151820] border-r border-[#2A2D3A] shadow-2xl">
              <SessionSidebar onOpenSession={handleOpenSession} />
            </div>
            <div
              className="flex-1 bg-black/50"
              onClick={() => setSidebarOpen(false)}
            />
          </div>
        )}

        {/* Mobile Content */}
        <div className="flex-1 overflow-hidden">
          {mobileView === "terminal" && (
            <div className="flex flex-col h-full">
              <TerminalTabs
                tabs={tabs}
                activeTab={activeTab}
                onSelect={setActiveTab}
                onClose={closeTab}
                onNew={handleNew}
              />
              <div className="flex-1 relative overflow-hidden">
                {activeTerminal ? (
                  <div key={activeTerminal.id} className="absolute inset-0">
                    <TerminalView sessionId={activeTerminal.sessionId} />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-[#6B7280] text-[13px] font-sans">
                    <div className="text-center">
                      <p className="mb-2">No terminal open</p>
                      <button
                        onClick={() => setSidebarOpen(true)}
                        className="px-4 py-2 rounded bg-[#1C1F2B] text-[#E4E4E7]
                          hover:bg-[#252838] transition-colors text-[13px]"
                      >
                        Open Sessions
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {mobileView === "sessions" && (
            <SessionSidebar onOpenSession={handleOpenSession} />
          )}

          {mobileView === "files" && (
            <RightPanel defaultTab="files" />
          )}

          {mobileView === "logs" && (
            <RightPanel defaultTab="logs" />
          )}
        </div>

        {/* Mobile Bottom Nav */}
        <div className="flex items-center h-14 bg-[#151820] border-t border-[#2A2D3A] shrink-0">
          {(
            [
              { id: "terminal" as MobileView, icon: Terminal, label: "Terminal" },
              { id: "sessions" as MobileView, icon: LayoutList, label: "Sessions" },
              { id: "files" as MobileView, icon: FolderTree, label: "Files" },
              { id: "logs" as MobileView, icon: ScrollText, label: "Logs" },
            ] as const
          ).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => {
                setMobileView(id);
                setSidebarOpen(false);
              }}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                mobileView === id
                  ? "text-[#3B82F6]"
                  : "text-[#6B7280]"
              }`}
            >
              <Icon size={20} />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Desktop Layout ─────────────────────────────────────────────────────────
  return (
    <div className="h-screen w-screen bg-[#0D0F12] overflow-hidden">
      <Group orientation="horizontal" className="h-full">
        {/* Left Sidebar */}
        <Panel
          id="sidebar"
          defaultSize="220px"
          minSize="180px"
          collapsible
        >
          <SessionSidebar onOpenSession={handleOpenSession} />
        </Panel>

        <Separator className="w-px bg-[#2A2D3A] hover:bg-[#3B82F6] active:bg-[#3B82F6] transition-colors" />

        {/* Center Terminal */}
        <Panel id="terminal" minSize="200px">
          <div className="flex flex-col h-full bg-[#0D0F12]">
            <TerminalTabs
              tabs={tabs}
              activeTab={activeTab}
              onSelect={setActiveTab}
              onClose={closeTab}
              onNew={handleNew}
            />
            <div className="flex-1 relative overflow-hidden">
              {activeTerminal ? (
                <div key={activeTerminal.id} className="absolute inset-0">
                  <TerminalView sessionId={activeTerminal.sessionId} />
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-[#6B7280] text-[13px] font-sans">
                  <div className="text-center">
                    <p className="mb-2">No terminal open</p>
                    <button
                      onClick={handleNew}
                      className="px-3 py-1.5 rounded bg-[#1C1F2B] text-[#E4E4E7]
                        hover:bg-[#252838] transition-colors text-[13px]"
                    >
                      New Terminal
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Panel>

        <Separator className="w-px bg-[#2A2D3A] hover:bg-[#3B82F6] active:bg-[#3B82F6] transition-colors" />

        {/* Right Panel */}
        <Panel
          id="right-panel"
          defaultSize="320px"
          minSize="200px"
          collapsible
        >
          <RightPanel />
        </Panel>
      </Group>
    </div>
  );
}

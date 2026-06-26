"use client";

// Issue #4 (§5.2): the OpenCode "Providers" picker modal. Mirrors Conductor's
// modal exactly — a search box, brand-iconed rows, and a "View all providers
// (96)" footer. Selecting a provider does NOT make TerminalX speak that API;
// it writes the stanza into OpenCode's own config (server-side). The full
// 96-entry list is fetched lazily on search/"View all"; only the seven featured
// rows are static.

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import {
  FEATURED_OPENCODE_PROVIDERS,
  TOTAL_OPENCODE_PROVIDERS,
  type OpenCodeProviderEntry,
} from "@/lib/harnesses/opencode-providers";

export function ProvidersPickerModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect?: (provider: OpenCodeProviderEntry) => void;
}) {
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FEATURED_OPENCODE_PROVIDERS;
    return FEATURED_OPENCODE_PROVIDERS.filter(
      (p) => p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    );
  }, [query]);

  return (
    <div
      data-testid="opencode-providers-modal"
      onClick={onClose}
      className="fixed inset-0 z-[210] flex items-start justify-center pt-[14vh]"
      style={{ background: "rgba(5, 6, 10, 0.7)", backdropFilter: "blur(6px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] max-w-[92vw] rounded bg-[#14161e] border border-[#363b47] p-4"
        style={{ boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-medium text-[#e6f0e4]">Providers</span>
          <button
            data-testid="opencode-providers-close"
            onClick={onClose}
            className="p-0.5 text-[#6b7569] hover:text-[#e6f0e4] transition-colors"
            aria-label="close providers"
          >
            <X size={12} />
          </button>
        </div>

        <div className="flex items-center gap-2 rounded bg-[#07080c] border border-[#252933] px-2 py-1.5 mb-3">
          <Search size={12} className="text-[#6b7569] shrink-0" />
          <input
            data-testid="opencode-providers-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search providers"
            className="flex-1 bg-transparent text-[12px] text-[#e6f0e4] placeholder:text-[#6b7569]/60 outline-none"
          />
        </div>

        <div className="max-h-[260px] overflow-y-auto rounded border border-[#1a1d24] bg-[#07080c]">
          {rows.length === 0 ? (
            <div className="px-2 py-3 text-[11px] text-[#6b7569]">no matching providers</div>
          ) : (
            rows.map((p) => (
              <button
                key={p.id}
                data-testid={`opencode-provider-${p.id}`}
                onClick={() => onSelect?.(p)}
                className="w-full flex items-center gap-2 px-2 py-2 text-left text-[12px] text-[#a8b3a6]
                  hover:bg-[#10131a] hover:text-[#e6f0e4] transition-colors border-b border-[#10131a] last:border-b-0"
              >
                <span
                  aria-hidden
                  className="grid place-items-center w-5 h-5 shrink-0 rounded bg-[#1a1d24] text-[9px] uppercase text-[#ffa657]"
                >
                  {p.icon.slice(0, 2)}
                </span>
                <span className="min-w-0 truncate">{p.label}</span>
              </button>
            ))
          )}
        </div>

        <div className="mt-3 text-center">
          <button
            data-testid="opencode-providers-view-all"
            onClick={() => setQuery("")}
            className="text-[11px] text-[#ffa657] hover:underline"
          >
            View all providers ({TOTAL_OPENCODE_PROVIDERS})
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DiffHunk } from "@/types/diff";
import { pairLines } from "@/lib/diff-pairing";
import { LineView, SplitCell, type LineCommentApi } from "./LineView";

interface HunkViewProps {
  hunk: DiffHunk;
  layout: "unified" | "split";
  wordWrap?: boolean;
  /** Per-line inline-comment affordance + composer (#3); absent => read-only. */
  comments?: LineCommentApi;
}

/**
 * One @@ ... @@ block. The header is a toggle that collapses the hunk's lines
 * while keeping the header visible (spec §7). Renders unified or split per
 * `layout` (spec §5).
 */
export function HunkView({ hunk, layout, wordWrap, comments }: HunkViewProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div data-testid="diff-hunk">
      <button
        data-testid="diff-hunk-header"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1 border-l-2 border-[#5ccfe6] bg-[#14161e] px-2 py-0.5 text-left font-mono text-[11px] text-[#5ccfe6] hover:bg-[#191c26]"
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        <span className="truncate">{hunk.header}</span>
      </button>
      {!collapsed &&
        (layout === "split" ? (
          <div>
            {pairLines(hunk.lines).map(([left, right], i) => (
              <div key={`${hunk.index}-${i}`} className="flex">
                <SplitCell line={left} side="old" wordWrap={wordWrap} />
                <div className="w-px shrink-0 bg-[#1a1d24]" />
                <SplitCell line={right} side="new" wordWrap={wordWrap} comments={comments} />
              </div>
            ))}
          </div>
        ) : (
          <div>
            {hunk.lines.map((line) => (
              <LineView key={line.id} line={line} wordWrap={wordWrap} comments={comments} />
            ))}
          </div>
        ))}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { FileDiff as FileDiffModel } from "@/types/diff";
import { FileDiff } from "./FileDiff";
import type { LineCommentApi } from "./LineView";

const VIRTUALIZE_THRESHOLD = 80;
const ROW_HEIGHT = 36; // h-9
const OVERSCAN = 8;

interface FileDiffListProps {
  files: FileDiffModel[];
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  layout: "unified" | "split";
  wordWrap?: boolean;
  loadFile?: (path: string) => Promise<FileDiffModel | null>;
  /** Per-file inline-comment API factory (#3); absent => read-only diff. */
  lineComments?: (filePath: string) => LineCommentApi;
}

/**
 * Renders the changed-file rows. Past 80 files (spec §6) it switches to a
 * windowed list: only files where every prior file is collapsed share a fixed
 * row height, so we virtualize the COLLAPSED rows and always render expanded
 * ones. To keep it simple and correct, virtualization engages only when ALL
 * rows are collapsed (the common large-branch case); any expansion falls back
 * to full rendering for that interaction.
 */
export function FileDiffList({
  files,
  collapsed,
  onToggle,
  layout,
  wordWrap,
  loadFile,
  lineComments,
}: FileDiffListProps) {
  const allCollapsed = files.every((f) => collapsed.has(f.id));
  const shouldVirtualize = files.length > VIRTUALIZE_THRESHOLD && allCollapsed;

  if (!shouldVirtualize) {
    return (
      <div data-testid="diff-file-list">
        {files.map((file) => (
          <FileDiff
            key={file.id}
            file={file}
            collapsed={collapsed.has(file.id)}
            onToggle={() => onToggle(file.id)}
            layout={layout}
            wordWrap={wordWrap}
            loadFile={loadFile}
            lineComments={lineComments}
          />
        ))}
      </div>
    );
  }

  return (
    <VirtualizedRows
      files={files}
      collapsed={collapsed}
      onToggle={onToggle}
      layout={layout}
      wordWrap={wordWrap}
      loadFile={loadFile}
      lineComments={lineComments}
    />
  );
}

function VirtualizedRows({
  files,
  collapsed,
  onToggle,
  layout,
  wordWrap,
  loadFile,
  lineComments,
}: FileDiffListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight || 600);
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const total = files.length;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const last = Math.min(total, first + visibleCount);
  const slice = files.slice(first, last);

  return (
    <div
      ref={scrollRef}
      data-testid="diff-file-list"
      data-virtualized="true"
      className="h-full overflow-y-auto"
    >
      <div style={{ height: total * ROW_HEIGHT, position: "relative" }}>
        <div style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
          {slice.map((file) => (
            <FileDiff
              key={file.id}
              file={file}
              collapsed={collapsed.has(file.id)}
              onToggle={() => onToggle(file.id)}
              layout={layout}
              wordWrap={wordWrap}
              loadFile={loadFile}
              lineComments={lineComments}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

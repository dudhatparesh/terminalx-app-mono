"use client";

import type { ChecksCounts } from "@/types/checks";
import { summarizeCounts } from "./presentation";

interface ChecksRollupSummaryProps {
  counts: ChecksCounts;
}

/** Humanized counts line, e.g. "3 passed · 1 running · 1 skipped" (§5.1). */
export function ChecksRollupSummary({ counts }: ChecksRollupSummaryProps) {
  return (
    <div data-testid="checks-rollup-summary" className="px-3 pb-2 text-[11px] text-[#a8b3a6]">
      {summarizeCounts(counts)}
    </div>
  );
}

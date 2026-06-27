import type { DiffLine } from "@/types/diff";

/**
 * Pair diff lines for split (side-by-side) rendering: deletions align with
 * empty right cells, additions with empty left cells, context aligns on both.
 * spec §5.
 *
 * Browser-safe (no Node imports) so client components can use it without
 * pulling the server-only git-diff module (child_process/crypto) into the
 * browser bundle.
 */
export function pairLines(lines: DiffLine[]): Array<[DiffLine | null, DiffLine | null]> {
  const pairs: Array<[DiffLine | null, DiffLine | null]> = [];
  const dels: DiffLine[] = [];
  const adds: DiffLine[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) pairs.push([dels[i] ?? null, adds[i] ?? null]);
    dels.length = 0;
    adds.length = 0;
  };
  for (const l of lines) {
    if (l.type === "deletion") dels.push(l);
    else if (l.type === "addition") adds.push(l);
    else {
      flush();
      pairs.push([l, l]);
    }
  }
  flush();
  return pairs;
}

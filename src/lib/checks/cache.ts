// In-memory, SHA/branch-keyed checks cache with stale-while-revalidate
// (checks-dashboard.spec.md §4.1). Single-process Map — TerminalX runs one custom
// Node server fronting Next.js, so a distributed cache is explicitly out of scope.
//
// No Node builtins are imported here, but this module IS server-only by intent
// (the route owns it). It never crosses the client boundary.
import type { ChecksView } from "@/types/checks";

interface Entry {
  view: ChecksView;
  storedAt: number;
}

export const SOFT_TTL_MS = 30_000; // serve fresh within this window
export const HARD_TTL_MS = 5 * 60_000; // after this, drop entirely

export class ChecksCache {
  private map = new Map<string, Entry>();

  /**
   * Returns the cached view (or null if missing/hard-expired). Past the soft TTL
   * the returned view is marked `stale` so the caller can revalidate.
   */
  get(key: string, now: number = Date.now()): ChecksView | null {
    const e = this.map.get(key);
    if (!e) return null;
    const age = now - e.storedAt;
    if (age > HARD_TTL_MS) {
      this.map.delete(key);
      return null;
    }
    return { ...e.view, cached: true, stale: age > SOFT_TTL_MS };
  }

  set(key: string, view: ChecksView, now: number = Date.now()): void {
    this.map.set(key, {
      view: {
        ...view,
        cached: false,
        stale: false,
        fetchedAt: new Date(now).toISOString(),
        cachedUntil: new Date(now + SOFT_TTL_MS).toISOString(),
      },
      storedAt: now,
    });
  }

  /**
   * Read the entry even if stale, WITHOUT dropping it on hard-expiry — used to
   * serve a last-good view on 429/502 degraded paths. Always marks `stale: true`.
   */
  peekStale(key: string): ChecksView | null {
    const e = this.map.get(key);
    if (!e) return null;
    return { ...e.view, cached: true, stale: true };
  }

  /** Drop the entry for a repo/branch — called on branch change or session delete. */
  invalidate(key: string): void {
    this.map.delete(key);
  }

  /** Test/maintenance helper: clear everything. */
  clear(): void {
    this.map.clear();
  }
}

export const checksCache = new ChecksCache();

/** Cache key is repo+branch scoped (NOT session-scoped) — no cross-session leak. */
export function cacheKeyFor(repoRoot: string, branch: string): string {
  return `checks:${repoRoot}@${branch}`;
}

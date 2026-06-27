"use client";

import { useCallback, useEffect, useState } from "react";
import type { DiffViewPrefs } from "@/types/diff";

const STORAGE_KEY = "terminalx:diff-prefs";

const DEFAULT_PREFS: DiffViewPrefs = {
  layout: "unified",
  wordWrap: false,
  collapsed: [],
};

function read(): DiffViewPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<DiffViewPrefs>;
    return {
      layout: parsed.layout === "split" ? "split" : "unified",
      wordWrap: Boolean(parsed.wordWrap),
      collapsed: Array.isArray(parsed.collapsed)
        ? parsed.collapsed.filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function write(prefs: DiffViewPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota / serialization failures — prefs are best-effort.
  }
}

/**
 * View-only diff prefs persisted to localStorage["terminalx:diff-prefs"],
 * mirroring the useOpenTabs convention. spec §2.1.
 */
export function useDiffPrefs(): [DiffViewPrefs, (next: Partial<DiffViewPrefs>) => void] {
  const [prefs, setPrefs] = useState<DiffViewPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    setPrefs(read());
  }, []);

  const update = useCallback((next: Partial<DiffViewPrefs>) => {
    setPrefs((prev) => {
      const merged = { ...prev, ...next };
      write(merged);
      return merged;
    });
  }, []);

  return [prefs, update];
}

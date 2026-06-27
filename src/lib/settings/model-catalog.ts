// Model catalog (issue #11, spec §2.3 + §3.3).
//
// Until the full provider/model registry (#4/#8) lands, the model dropdowns are
// populated from a small curated catalog keyed off the harness registry. Each
// entry is a provider-qualified `<harness>:<model>` id. This module is
// client-safe (registry + pure data only — no Node built-ins) so the API route
// AND the settings page can derive options from the same source of truth.

import { listHarnesses } from "@/lib/harnesses/registry";
import { EFFORT_LEVELS, type EffortLevel, type ModelOption } from "./types";

/** A model row in the curated catalog, before availability is computed. */
interface CatalogModel {
  /** model slug, qualified at runtime as `<harness>:<slug>` */
  slug: string;
  label: string;
  supportedEfforts?: EffortLevel[];
}

/**
 * Curated per-harness models. Keyed by harness id from the registry. When the
 * real registry arrives this map is replaced by `AIProviderConfig.metadata
 * .supportedModels`; the option shape stays identical.
 */
const CATALOG: Record<string, CatalogModel[]> = {
  claude: [
    { slug: "opus-4-8-1m", label: "Opus 4.8 1M" },
    { slug: "sonnet-4-8", label: "Sonnet 4.8" },
    { slug: "haiku-4-8", label: "Haiku 4.8" },
  ],
  codex: [
    { slug: "gpt-5-codex", label: "GPT-5 Codex" },
    { slug: "gpt-5", label: "GPT-5" },
  ],
  cursor: [{ slug: "cursor-default", label: "Cursor (auto)" }],
  opencode: [{ slug: "anthropic/claude-sonnet", label: "OpenCode · Claude Sonnet" }],
};

/** The fully-qualified model id for a catalog entry. */
export function modelIdFor(harness: string, slug: string): string {
  return `${harness}:${slug}`;
}

/**
 * Build the dropdown option list from the harness registry + curated catalog.
 * `availability` maps harness id → installed/configured; entries for which the
 * harness is unavailable are still listed (disabled) so a default can be picked
 * before the CLI is installed (spec §2.3).
 */
export function buildModelOptions(availability: Record<string, boolean> = {}): ModelOption[] {
  const options: ModelOption[] = [];
  for (const harness of listHarnesses()) {
    // bash has no models.
    if (harness.command.bin === null) continue;
    const models = CATALOG[harness.id] ?? [];
    const available = availability[harness.id] ?? true;
    for (const m of models) {
      options.push({
        id: modelIdFor(harness.id, m.slug),
        label: m.label,
        harness: harness.id,
        available,
        unavailableReason: available ? undefined : `${harness.label} is not installed`,
        supportedEfforts: m.supportedEfforts ?? [...EFFORT_LEVELS],
      });
    }
  }
  return options;
}

/** Flat list of every known model id (used to validate PUT payloads). */
export function knownModelIds(): Set<string> {
  return new Set(buildModelOptions().map((o) => o.id));
}

/**
 * The registry default model — first model of the first non-bash harness, at
 * effort "high" (spec §3.3). Returns null only if the catalog is empty.
 */
export function registryDefaultModel(): { modelId: string; effort: EffortLevel } | null {
  for (const harness of listHarnesses()) {
    if (harness.command.bin === null) continue;
    const first = (CATALOG[harness.id] ?? [])[0];
    if (first) return { modelId: modelIdFor(harness.id, first.slug), effort: "high" };
  }
  return null;
}

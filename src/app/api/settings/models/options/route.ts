import { NextResponse } from "next/server";
// Issue #11 (§2.3): model dropdown options from the harness registry + curated
// catalog, with per-harness availability from the status probe. Read-only.
import { listHarnesses } from "@/lib/harnesses/registry";
import { probeHarness } from "@/lib/harnesses/status";
import { buildModelOptions } from "@/lib/settings/model-catalog";
import { CODEX_PERSONALITIES, EFFORT_LEVELS } from "@/lib/settings/types";

export async function GET() {
  try {
    // Probe each harness once (short-TTL cached) to mark models available.
    const availability: Record<string, boolean> = {};
    for (const h of listHarnesses()) {
      if (h.command.bin === null) continue;
      availability[h.id] = probeHarness(h.id).installed;
    }

    return NextResponse.json({
      models: buildModelOptions(availability),
      efforts: EFFORT_LEVELS,
      codexPersonalities: CODEX_PERSONALITIES,
    });
  } catch (err) {
    console.error("[api/settings/models/options GET]", err);
    return NextResponse.json({ error: "Failed to list model options" }, { status: 500 });
  }
}

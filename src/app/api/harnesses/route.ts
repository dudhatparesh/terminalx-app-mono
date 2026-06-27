import { NextResponse } from "next/server";
// Issue #4: GET /api/harnesses — registry-driven harness list + per-harness
// status probe (installed/version/connected/account/loginCommand) that the
// Harnesses settings surface reads. Read-only; mirrors the route conventions in
// src/app/api/sessions/route.ts (NextResponse + try/catch → 500).
import { listHarnesses } from "@/lib/harnesses/registry";
import { probeHarness } from "@/lib/harnesses/status";

export async function GET() {
  try {
    const harnesses = listHarnesses().map((h) => ({
      id: h.id,
      label: h.label,
      badge: h.badge,
      color: h.color,
      auth: h.auth,
      hostsProviders: Boolean(h.hostsProviders),
      docsUrl: h.docsUrl,
      // probeHarness is best-effort + short-TTL cached, so the settings poll
      // doesn't re-run version/command-v shellouts on every request.
      status: probeHarness(h.id),
    }));
    return NextResponse.json({ harnesses });
  } catch (err) {
    console.error("[api/harnesses GET]", err);
    return NextResponse.json({ error: "Failed to list harnesses" }, { status: 500 });
  }
}

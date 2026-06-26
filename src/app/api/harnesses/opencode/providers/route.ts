import { NextResponse } from "next/server";
// Issue #4: GET /api/harnesses/opencode/providers — featured rows + total for
// the Providers picker modal. The full 96-entry list is fetched lazily (search
// / "View all") rather than hard-coded; only the seven featured rows are static.
import {
  FEATURED_OPENCODE_PROVIDERS,
  TOTAL_OPENCODE_PROVIDERS,
} from "@/lib/harnesses/opencode-providers";

export async function GET() {
  try {
    return NextResponse.json({
      featured: FEATURED_OPENCODE_PROVIDERS,
      total: TOTAL_OPENCODE_PROVIDERS,
    });
  } catch (err) {
    console.error("[api/harnesses/opencode/providers GET]", err);
    return NextResponse.json({ error: "Failed to list providers" }, { status: 500 });
  }
}

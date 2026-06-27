import { NextRequest, NextResponse } from "next/server";

/**
 * Test-only GitHub REST mock.
 *
 * The secure GitHub layer validates a connecting PAT by calling GitHub's
 * `GET /user` server-side (src/lib/github/client.ts). In e2e we have no real
 * token and run offline, so playwright.config points GITHUB_API_BASE_URL at this
 * in-process mock. It returns a fixed viewer for `/user` so the connect flow can
 * be exercised end to end without touching the network.
 *
 * HARD GATE: this only ever responds when the no-auth test escape hatch is
 * explicitly enabled (TERMINALX_ALLOW_AUTH_NONE=true + TERMINALX_AUTH_MODE=none).
 * In any normal deployment it returns 404, so it cannot leak fake credentials.
 */
function testModeEnabled(): boolean {
  return (
    process.env.TERMINALX_ALLOW_AUTH_NONE === "true" && process.env.TERMINALX_AUTH_MODE === "none"
  );
}

const FAKE_VIEWER = {
  login: "octocat",
  id: 1,
  node_id: "MDQ6VXNlcjE=",
  avatar_url: "",
  url: "https://api.github.com/users/octocat",
  html_url: "https://github.com/octocat",
  type: "User",
  name: "The Octocat",
};

async function handle(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!testModeEnabled()) {
    return NextResponse.json({ message: "Not Found" }, { status: 404 });
  }
  const { path } = await ctx.params;
  const endpoint = (path ?? []).join("/");

  if (endpoint === "user") {
    return NextResponse.json(FAKE_VIEWER, { status: 200 });
  }

  // Unmocked endpoints behave like GitHub's 404 so callers fail cleanly.
  return NextResponse.json({ message: "Not Found" }, { status: 404 });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;

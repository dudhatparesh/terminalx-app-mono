import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Next.js edge middleware cannot use Node.js APIs, so we inline the secret
// logic here (reads env var only; file-based fallback is server-side only).

function getJwtSecretEdge(): Uint8Array | null {
  const secret = process.env.TERMINALX_JWT_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

function getAuthModeEdge(): "none" | "password" | "local" {
  const mode = process.env.TERMINALX_AUTH_MODE || "none";
  if (mode === "password" || mode === "local") {
    return mode;
  }
  return "none";
}

const PUBLIC_PATHS = ["/login", "/api/auth/", "/_next/", "/favicon.ico"];

/**
 * Strip user identity headers to prevent spoofing from untrusted clients.
 * These headers are only set by the middleware itself after JWT verification.
 */
function stripUserHeaders(response: NextResponse): NextResponse {
  response.headers.set("x-user-id", "");
  response.headers.set("x-user-role", "");
  response.headers.set("x-username", "");
  return response;
}

export async function middleware(req: NextRequest) {
  const authMode = getAuthModeEdge();

  // No auth required
  if (authMode === "none") {
    return stripUserHeaders(NextResponse.next());
  }

  const { pathname } = req.nextUrl;

  // Skip auth for public paths
  for (const p of PUBLIC_PATHS) {
    if (pathname === p || pathname.startsWith(p)) {
      return stripUserHeaders(NextResponse.next());
    }
  }

  // Parse JWT from cookie
  const token = req.cookies.get("terminalx-session")?.value;
  if (!token) {
    return stripUserHeaders(NextResponse.redirect(new URL("/login", req.url)));
  }

  const secret = getJwtSecretEdge();
  if (!secret) {
    // No secret configured — cannot verify tokens.
    // Redirect to login rather than passing through unauthenticated,
    // to prevent auth bypass when TERMINALX_JWT_SECRET env var is not set.
    return stripUserHeaders(NextResponse.redirect(new URL("/login", req.url)));
  }

  try {
    const { payload } = await jwtVerify(token, secret);
    const response = NextResponse.next();
    response.headers.set("x-user-id", (payload.userId as string) || "");
    response.headers.set("x-user-role", (payload.role as string) || "");
    response.headers.set("x-username", (payload.username as string) || "");
    return response;
  } catch {
    // Invalid or expired token
    const response = NextResponse.redirect(new URL("/login", req.url));
    response.cookies.delete("terminalx-session");
    return stripUserHeaders(response);
  }
}

export const config = {
  matcher: [
    /*
     * Match all paths except static files.
     * _next/static and _next/image are handled by Next.js.
     */
    "/((?!_next/static|_next/image).*)",
  ],
};

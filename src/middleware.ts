import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Next.js edge middleware cannot use Node.js APIs, so we inline the secret
// logic here (reads env var only; file-based fallback is server-side only).

function getJwtSecretEdge(): Uint8Array | null {
  const secret = process.env.TERMINALX_JWT_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

function getAuthModeEdge(): "none" | "password" | "local" | "oauth" {
  const mode = process.env.TERMINALX_AUTH_MODE || "none";
  if (mode === "password" || mode === "local" || mode === "oauth") {
    return mode;
  }
  return "none";
}

const PUBLIC_PATHS = ["/login", "/api/auth/", "/_next/", "/favicon.ico"];

export async function middleware(req: NextRequest) {
  const authMode = getAuthModeEdge();

  // No auth required
  if (authMode === "none") {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;

  // Skip auth for public paths
  for (const p of PUBLIC_PATHS) {
    if (pathname === p || pathname.startsWith(p)) {
      return NextResponse.next();
    }
  }

  // Parse JWT from cookie
  const token = req.cookies.get("terminalx-session")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const secret = getJwtSecretEdge();
  if (!secret) {
    // No secret configured — cannot verify tokens.
    // In file-based secret mode, middleware can't read the file,
    // so we pass through and let the API routes handle auth.
    const response = NextResponse.next();
    return response;
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
    return response;
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

import { NextRequest, NextResponse } from "next/server";
import { signJwt, comparePassword } from "@/lib/auth";
import { getAuthMode, getSinglePassword } from "@/lib/auth-config";
import { getUserByUsername, updateLastLogin, ensureDefaultAdmin } from "@/lib/users";

// ── Rate Limiting (in-memory sliding window) ────────────────────────────────

const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const attempts = rateLimitMap.get(ip) || [];
  // Remove expired entries
  const recent = attempts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  rateLimitMap.set(ip, recent);
  if (recent.length >= RATE_LIMIT_MAX) {
    return true;
  }
  recent.push(now);
  return false;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, attempts] of rateLimitMap) {
    const recent = attempts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) {
      rateLimitMap.delete(ip);
    } else {
      rateLimitMap.set(ip, recent);
    }
  }
}, 300_000);

// ── Cookie helper ───────────────────────────────────────────────────────────

function makeSessionCookie(token: string, req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  const secure = proto === "https";
  const parts = [
    `terminalx-session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${7 * 24 * 60 * 60}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

// ── POST /api/auth/login ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429 }
    );
  }

  const authMode = getAuthMode();

  if (authMode === "none") {
    return NextResponse.json(
      { error: "Authentication is disabled" },
      { status: 400 }
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { password } = body;
  if (!password || typeof password !== "string") {
    return NextResponse.json(
      { error: "Password is required" },
      { status: 400 }
    );
  }

  // ── Password mode: single shared password ──
  if (authMode === "password") {
    const expected = getSinglePassword();
    if (!expected) {
      return NextResponse.json(
        { error: "Server misconfigured: TERMINALX_PASSWORD not set" },
        { status: 500 }
      );
    }

    if (password !== expected) {
      return NextResponse.json(
        { error: "Invalid password" },
        { status: 401 }
      );
    }

    const token = await signJwt({
      userId: "single-user",
      username: "admin",
      role: "admin",
    });

    const res = NextResponse.json({ success: true, username: "admin" });
    res.headers.set("Set-Cookie", makeSessionCookie(token, req));
    return res;
  }

  // ── Local mode: username + password ──
  if (authMode === "local") {
    const { username } = body;
    if (!username || typeof username !== "string") {
      return NextResponse.json(
        { error: "Username is required" },
        { status: 400 }
      );
    }

    // Ensure default admin exists on first login attempt
    await ensureDefaultAdmin();

    const user = getUserByUsername(username);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    await updateLastLogin(user.id);

    const token = await signJwt({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    const res = NextResponse.json({
      success: true,
      username: user.username,
      role: user.role,
    });
    res.headers.set("Set-Cookie", makeSessionCookie(token, req));
    return res;
  }

  return NextResponse.json(
    { error: `Auth mode '${authMode}' not supported for login` },
    { status: 400 }
  );
}

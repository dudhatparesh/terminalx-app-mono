import { SignJWT, jwtVerify } from "jose";
import { hash, compare } from "bcryptjs";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ── JWT Secret ──────────────────────────────────────────────────────────────

const SECRET_FILE = path.join(process.cwd(), ".terminalx-secret");

let cachedSecret: Uint8Array | null = null;

export function getJwtSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;

  // Prefer env var
  const envSecret = process.env.TERMINALX_JWT_SECRET;
  if (envSecret) {
    cachedSecret = new TextEncoder().encode(envSecret);
    return cachedSecret;
  }

  // Read or create secret file
  try {
    const existing = fs.readFileSync(SECRET_FILE, "utf-8").trim();
    if (existing.length >= 32) {
      cachedSecret = new TextEncoder().encode(existing);
      return cachedSecret;
    }
  } catch {
    // File doesn't exist, create it
  }

  const generated = crypto.randomBytes(48).toString("base64");
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  cachedSecret = new TextEncoder().encode(generated);
  return cachedSecret;
}

// ── Token Revocation (in-memory blacklist) ─────────────────────────────────

const revokedTokens = new Set<string>();

export function revokeToken(token: string): void {
  revokedTokens.add(token);
}

// ── JWT Sign / Verify ───────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
}

export async function signJwt(payload: JwtPayload): Promise<string> {
  const secret = getJwtSecret();
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  try {
    if (revokedTokens.has(token)) {
      return null;
    }
    const secret = getJwtSecret();
    const { payload } = await jwtVerify(token, secret);
    return {
      userId: payload.userId as string,
      username: payload.username as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

// ── Password Hashing ────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

export async function comparePassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return compare(password, passwordHash);
}

// ── Cookie Parsing ──────────────────────────────────────────────────────────

export function parseCookies(
  cookieHeader: string | undefined | null
): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split("; ")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

// ── Re-export auth mode ─────────────────────────────────────────────────────

export { getAuthMode } from "./auth-config";

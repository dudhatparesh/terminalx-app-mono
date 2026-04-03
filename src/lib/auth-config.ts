// Auth configuration — single source of truth for auth-related env vars

export type AuthMode = "none" | "password" | "local" | "oauth";

export function getAuthMode(): AuthMode {
  const mode = process.env.TERMINALX_AUTH_MODE || "none";
  if (mode === "password" || mode === "local" || mode === "oauth") {
    return mode;
  }
  return "none";
}

export function getAdminUsername(): string {
  return process.env.TERMINALX_ADMIN_USERNAME || "admin";
}

export function getAdminPassword(): string | undefined {
  return process.env.TERMINALX_ADMIN_PASSWORD;
}

export function getSinglePassword(): string | undefined {
  return process.env.TERMINALX_PASSWORD;
}

export function getOAuthIssuer(): string | undefined {
  return process.env.TERMINALX_OAUTH_ISSUER;
}

export function getOAuthClientId(): string | undefined {
  return process.env.TERMINALX_OAUTH_CLIENT_ID;
}

export function getOAuthClientSecret(): string | undefined {
  return process.env.TERMINALX_OAUTH_CLIENT_SECRET;
}

export function isOAuthConfigured(): boolean {
  return !!(getOAuthIssuer() && getOAuthClientId() && getOAuthClientSecret());
}

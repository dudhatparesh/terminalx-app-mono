// Auth configuration — single source of truth for auth-related env vars

export type AuthMode = "none" | "password" | "local";

export function getAuthMode(): AuthMode {
  const mode = process.env.TERMINALX_AUTH_MODE || "none";
  if (mode === "password" || mode === "local") {
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

// OAuth support planned for future release.
// See: https://github.com/dr-fusion/terminalx-app/issues (feature request)

import { getAuthMode } from "./auth-config";

/**
 * Determine if a user can access a given tmux session.
 * Non-admin users in local auth mode can only access sessions prefixed with their username.
 */
export function canAccessSession(
  username: string | null,
  role: string | null,
  sessionName: string
): boolean {
  const authMode = getAuthMode();
  if (authMode === "none" || authMode === "password") return true;
  if (role === "admin") return true;
  if (!username) return false;
  return sessionName.startsWith(`${username}-`);
}

/**
 * Prefix a session name with the username for scoping in multi-user mode.
 */
export function scopedSessionName(
  name: string,
  username: string | null
): string {
  const authMode = getAuthMode();
  if (authMode === "local" && username) {
    return `${username}-${name}`;
  }
  return name;
}

/**
 * Get user scoping info from request headers (set by middleware).
 */
export function getUserScoping(headers: {
  get(name: string): string | null;
}): {
  username: string | null;
  role: string | null;
  shouldScope: boolean;
} {
  const authMode = getAuthMode();
  if (authMode === "none" || authMode === "password") {
    return { username: null, role: "admin", shouldScope: false };
  }

  const username = headers.get("x-username");
  const role = headers.get("x-user-role");
  return {
    username,
    role,
    shouldScope: role === "user",
  };
}

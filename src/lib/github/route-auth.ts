// Shared identity resolution for the GitHub API routes (§6.2 / §7.3).
// Uses the real auth helper getUserScoping (src/lib/session-scope.ts) -> User.id.
// In 'none'/'password' modes username is null (single-user/shared instance): fall
// back to the default admin's id. In 'local' mode map x-username -> stable User.id.
// NOTE: returns null when no owner can be resolved; routes MUST answer 403 (never 401).
import { getUserScoping } from "../session-scope";
import { getUserByUsername, getUsers } from "../users";

export function resolveUserId(headers: { get(name: string): string | null }): string | null {
  const { username } = getUserScoping(headers);
  if (username) return getUserByUsername(username)?.id ?? null;
  // none/password mode: no per-user identity; attribute to the default admin account.
  return getUsers().find((u) => u.role === "admin")?.id ?? null;
}

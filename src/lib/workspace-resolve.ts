/**
 * Shared helpers for the workspace API routes: resolve the repo root + port for
 * a named session, and build the execution env (sanitized base + config env +
 * TERMINALX_PORT) for setup / run scripts.
 */
import { getMeta, type SessionMeta } from "./ai-sessions";
import { resolveWorkspaceConfig, type ResolvedWorkspaceConfig } from "./workspace-config";

export interface SessionWorkspace {
  meta: SessionMeta;
  /** Repo root backing the session's worktree, or its cwd as a fallback. */
  repoRoot: string;
  config: ResolvedWorkspaceConfig;
}

/**
 * Resolve the workspace config for a named managed session. Returns null when
 * the session has no metadata or no resolvable directory.
 */
export function resolveSessionWorkspace(sessionName: string): SessionWorkspace | null {
  const meta = getMeta(sessionName);
  if (!meta) return null;
  const repoRoot = meta.worktree?.repoRoot ?? meta.cwd;
  if (!repoRoot) return null;
  const config = resolveWorkspaceConfig(repoRoot, { port: meta.port });
  return { meta, repoRoot, config };
}

/**
 * Build the execution env for a setup/run command: config env (already
 * interpolated against the port) plus TERMINALX_PORT. The pty-manager allowlist
 * is untouched — these are exported inside the tmux session's own shell.
 */
export function buildExecutionEnv(
  config: ResolvedWorkspaceConfig,
  port: number
): Record<string, string> {
  return { ...config.env, TERMINALX_PORT: String(port) };
}

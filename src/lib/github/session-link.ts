// §2.7 Link a PR to a TerminalX session. Given a session's worktree branch, find
// the newest matching PR (head = owner:branch) and project it to PullRequestView.
import type { SessionMeta } from "../ai-sessions";
import type { GitHubAPI } from "./api";
import { toPullRequestView } from "./derive";
import type { PullRequestView } from "./types";

export interface SessionPRLink {
  sessionName: string;
  branch: string;
  pr: PullRequestView | null; // null => offer "Create PR"
}

/**
 * Resolve the PR for a session by its worktree branch. Returns `pr: null` when the
 * session has no worktree branch or no PR exists yet (the status bar then shows
 * "Create PR", §0.1).
 */
export async function resolvePRForSession(
  api: GitHubAPI,
  owner: string,
  repo: string,
  session: SessionMeta
): Promise<SessionPRLink> {
  const branch = session.worktree?.branch ?? "";
  if (!branch) {
    return { sessionName: session.name, branch: "", pr: null };
  }
  const prs = await api.pulls.listPullRequests(owner, repo, {
    head: `${owner}:${branch}`,
    state: "all",
    sort: "created",
    direction: "desc",
  });
  // Newest match wins. Guard against APIs that ignore sort by sorting locally.
  const newest = [...prs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  return {
    sessionName: session.name,
    branch,
    pr: newest ? toPullRequestView(newest) : null,
  };
}

import { describe, it, expect } from "vitest";
import { parseGitHubRemote } from "@/lib/pr-review/repo-binding";
import { sanitizeGitHubError } from "@/lib/pr-review/error";
import { GitHubErrorCode, type GitHubAPIError } from "@/lib/github/types";

describe("parseGitHubRemote", () => {
  it("parses SSH form git@github.com:owner/repo.git", () => {
    expect(parseGitHubRemote("git@github.com:acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
    });
  });

  it("parses HTTPS form with and without .git", () => {
    expect(parseGitHubRemote("https://github.com/acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
    });
    expect(parseGitHubRemote("https://github.com/acme/widgets")).toEqual({
      owner: "acme",
      repo: "widgets",
    });
  });

  it("parses an https remote carrying an embedded token without leaking it", () => {
    const parsed = parseGitHubRemote(
      "https://x-access-token:ghp_secret@github.com/acme/widgets.git"
    );
    expect(parsed).toEqual({ owner: "acme", repo: "widgets" });
  });

  it("returns null for a non-parseable remote", () => {
    expect(parseGitHubRemote("not a url")).toBeNull();
  });
});

function ghError(code: GitHubErrorCode, message = "boom"): GitHubAPIError {
  return { code, message, statusCode: 0 };
}

describe("sanitizeGitHubError (§6 / §9 — 403 never 401)", () => {
  it("maps auth/token errors to 403, NOT 401", async () => {
    for (const code of [
      GitHubErrorCode.AUTHENTICATION_FAILED,
      GitHubErrorCode.TOKEN_EXPIRED,
      GitHubErrorCode.TOKEN_REVOKED,
    ]) {
      const res = sanitizeGitHubError(ghError(code));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Reconnect GitHub in settings");
    }
  });

  it("maps FORBIDDEN to 403 and NOT_FOUND to 404", () => {
    expect(sanitizeGitHubError(ghError(GitHubErrorCode.FORBIDDEN)).status).toBe(403);
    expect(sanitizeGitHubError(ghError(GitHubErrorCode.NOT_FOUND)).status).toBe(404);
  });

  it("surfaces VALIDATION_ERROR as 422 with the GitHub message (branch protection etc.)", async () => {
    const res = sanitizeGitHubError(ghError(GitHubErrorCode.VALIDATION_ERROR, "base is protected"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("base is protected");
  });

  it("maps rate limits to 429 and never leaks a stack/path", async () => {
    const res = sanitizeGitHubError(ghError(GitHubErrorCode.RATE_LIMIT_EXCEEDED));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).not.toContain("/Users/");
  });

  it("maps a plain Error to 500 with a generic message", async () => {
    const res = sanitizeGitHubError(new Error("/secret/path exploded"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Request failed");
  });
});

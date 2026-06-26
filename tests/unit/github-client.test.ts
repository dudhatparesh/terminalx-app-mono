import { describe, it, expect, vi } from "vitest";
import { GitHubAPIClient, classifyResponse } from "@/lib/github/client";
import { GitHubAPI } from "@/lib/github/api";
import { GitHubErrorCode } from "@/lib/github/types";
import type { TokenVault } from "@/lib/github/token-vault";

// A minimal fake vault that just returns a fixed token (the real vault is covered
// by github-token-vault.test.ts). Typed as TokenVault for the client/api constructors.
const fakeVault = {
  getToken: async () => "ghp_test_token",
} as unknown as TokenVault;

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> }
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function makeClient(fetchImpl: typeof fetch) {
  return new GitHubAPIClient("int-1", fakeVault, {
    fetchImpl,
    sleep: async () => {}, // never actually wait in tests
    retryCount: 3,
  });
}

describe("classifyResponse", () => {
  it("maps 403 + ratelimit-remaining 0 to RATE_LIMIT_EXCEEDED", () => {
    const h = new Headers({ "x-ratelimit-remaining": "0" });
    expect(classifyResponse(403, h)).toBe(GitHubErrorCode.RATE_LIMIT_EXCEEDED);
  });
  it("maps 403 + retry-after to SECONDARY_RATE_LIMIT", () => {
    const h = new Headers({ "retry-after": "30" });
    expect(classifyResponse(403, h)).toBe(GitHubErrorCode.SECONDARY_RATE_LIMIT);
  });
  it("maps plain 403 to FORBIDDEN", () => {
    expect(classifyResponse(403, new Headers())).toBe(GitHubErrorCode.FORBIDDEN);
  });
  it("maps 401/404/422/503/500", () => {
    expect(classifyResponse(401, new Headers())).toBe(GitHubErrorCode.AUTHENTICATION_FAILED);
    expect(classifyResponse(404, new Headers())).toBe(GitHubErrorCode.NOT_FOUND);
    expect(classifyResponse(422, new Headers())).toBe(GitHubErrorCode.VALIDATION_ERROR);
    expect(classifyResponse(503, new Headers())).toBe(GitHubErrorCode.SERVICE_UNAVAILABLE);
    expect(classifyResponse(500, new Headers())).toBe(GitHubErrorCode.SERVER_ERROR);
  });
});

describe("GitHubAPIClient.request", () => {
  it("sends a bearer token + version header and parses JSON", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer ghp_test_token");
      expect(headers.get("x-github-api-version")).toBe("2022-11-28");
      return jsonResponse([{ name: "main" }]);
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);
    const out = await client.request<Array<{ name: string }>>(
      "GET",
      "/repos/acme/widgets/branches"
    );
    expect(out).toEqual([{ name: "main" }]);
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it("encodes query params and the JSON body", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = String(init?.body ?? "");
      return jsonResponse({ number: 7 }, { status: 201 });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);
    await client.request("POST", "/repos/acme/widgets/pulls", {
      body: { title: "hi", head: "feat", base: "main" },
      query: { per_page: 50 },
    });
    expect(capturedUrl).toContain("per_page=50");
    expect(JSON.parse(capturedBody)).toEqual({ title: "hi", head: "feat", base: "main" });
  });

  it("throws a NOT_FOUND GitHubAPIError on 404 and does NOT retry", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: "Not Found" }, { status: 404 })
    ) as unknown as typeof fetch;
    const client = makeClient(fetchImpl);
    await expect(client.request("GET", "/repos/x/y")).rejects.toMatchObject({
      code: GitHubErrorCode.NOT_FOUND,
      statusCode: 404,
    });
    // non-retryable => exactly one call
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it("retries transient 503 then succeeds (backoff stubbed)", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls < 3) return jsonResponse({ message: "unavailable" }, { status: 503 });
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);
    const out = await client.request<{ ok: boolean }>("GET", "/repos/x/y");
    expect(out).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("gives up after maxRetries on persistent 503", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: "down" }, { status: 503 })
    ) as unknown as typeof fetch;
    const client = makeClient(fetchImpl);
    await expect(client.request("GET", "/repos/x/y")).rejects.toMatchObject({
      code: GitHubErrorCode.SERVICE_UNAVAILABLE,
    });
    // initial + retries; shouldRetry stops at attempt >= 3 => 3 total attempts
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(3);
  });

  it("caches rate-limit state from response headers", async () => {
    const reset = Math.floor(Date.now() / 1000) + 60;
    const fetchImpl = vi.fn(async () =>
      jsonResponse([], {
        headers: {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4999",
          "x-ratelimit-reset": String(reset),
          "x-ratelimit-used": "1",
        },
      })
    ) as unknown as typeof fetch;
    const client = makeClient(fetchImpl);
    await client.request("GET", "/rate_limit");
    const rl = client.getRateLimit();
    expect(rl?.remaining).toBe(4999);
    expect(rl?.limit).toBe(5000);
    expect(rl?.reset).toBe(reset);
  });

  it("surfaces a network error as NETWORK_ERROR", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const client = new GitHubAPIClient("int-1", fakeVault, {
      fetchImpl,
      sleep: async () => {},
      retryCount: 0,
    });
    await expect(client.request("GET", "/x")).rejects.toMatchObject({
      code: GitHubErrorCode.NETWORK_ERROR,
    });
  });
});

describe("GitHubAPI typed surface (mocked fetch)", () => {
  it("listBranches hits the branches endpoint", async () => {
    let url = "";
    const fetchImpl = vi.fn(async (u: string | URL | Request) => {
      url = String(u);
      return jsonResponse([{ name: "main", commit: { sha: "abc", url: "" }, protected: false }]);
    }) as unknown as typeof fetch;
    const api = new GitHubAPI("int-1", fakeVault, { fetchImpl, sleep: async () => {} });
    const branches = await api.repo.listBranches("acme", "widgets");
    expect(url).toContain("/repos/acme/widgets/branches");
    expect(branches[0]?.name).toBe("main");
  });

  it("getChecksForSha merges check-runs + statuses into a rollup", async () => {
    const fetchImpl = vi.fn(async (u: string | URL | Request) => {
      const s = String(u);
      if (s.includes("/check-runs")) {
        return jsonResponse({
          check_runs: [
            {
              id: 1,
              name: "build",
              head_sha: "sha1",
              status: "completed",
              conclusion: "success",
              started_at: "",
              completed_at: "",
              html_url: "",
            },
          ],
        });
      }
      if (s.includes("/statuses")) {
        return jsonResponse([
          {
            state: "failure",
            description: "lint failed",
            context: "ci/lint",
            created_at: "",
            url: "",
          },
        ]);
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    const api = new GitHubAPI("int-1", fakeVault, { fetchImpl, sleep: async () => {} });
    const summary = await api.checksAggregate.getChecksForSha("acme", "widgets", "sha1");
    expect(summary.total).toBe(2);
    expect(summary.failing).toBe(1);
    expect(summary.passing).toBe(1);
    expect(summary.overall).toBe("failure");
  });

  it("getAuthenticated returns the viewer (GET /user, §2.5a)", async () => {
    const fetchImpl = vi.fn(async (u: string | URL | Request) => {
      expect(String(u)).toContain("/user");
      return jsonResponse({ login: "octocat", id: 1, avatar_url: "", url: "", type: "User" });
    }) as unknown as typeof fetch;
    const api = new GitHubAPI("int-1", fakeVault, { fetchImpl, sleep: async () => {} });
    const me = await api.users.getAuthenticated();
    expect(me.login).toBe("octocat");
  });
});

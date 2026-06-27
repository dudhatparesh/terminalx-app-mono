// §2.1 Core API client — hand-rolled over `fetch` (NO octokit). Handles auth,
// rate-limit accounting, error classification (§4.1) and retry with exponential
// backoff + jitter (§3.3). Every endpoint class (api.ts) goes through this.
import { ErrorCategory, GitHubAPIError, GitHubErrorCode } from "./types";
import { calculateBackoff, DEFAULT_RETRY_POLICY, RetryPolicy, shouldRetry } from "./derive";
import type { TokenVault } from "./token-vault";

export interface RateLimitState {
  limit: number;
  remaining: number;
  reset: number; // Unix seconds
  resetAt: Date;
  used: number;
}

export interface ClientOptions {
  timeout?: number; // default 30000ms
  retryCount?: number; // default 3
  userAgent?: string; // default "TerminalX/1.0"
  baseUrl?: string; // default https://api.github.com (or enterprise)
}

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_USER_AGENT = "TerminalX/1.0";
// The default GitHub REST host. Overridable via GITHUB_API_BASE_URL so the server
// can point at GitHub Enterprise, an authenticated proxy, or (in e2e) a local
// mock — without changing call sites. An explicit `baseUrl` option still wins.
const DEFAULT_BASE_URL = "https://api.github.com";

function defaultBaseUrl(): string {
  const override = process.env.GITHUB_API_BASE_URL?.trim();
  return override || DEFAULT_BASE_URL;
}

/** Map an HTTP Response to a GitHubErrorCode (§4.1 classifyError, expanded). */
export function classifyResponse(status: number, headers: Headers): GitHubErrorCode {
  if (status === 401) return GitHubErrorCode.AUTHENTICATION_FAILED;
  if (status === 403) {
    if (headers.get("x-ratelimit-remaining") === "0") return GitHubErrorCode.RATE_LIMIT_EXCEEDED;
    if (headers.get("retry-after")) return GitHubErrorCode.SECONDARY_RATE_LIMIT;
    return GitHubErrorCode.FORBIDDEN;
  }
  if (status === 404) return GitHubErrorCode.NOT_FOUND;
  if (status === 422) return GitHubErrorCode.VALIDATION_ERROR;
  if (status === 503) return GitHubErrorCode.SERVICE_UNAVAILABLE;
  if (status >= 500) return GitHubErrorCode.SERVER_ERROR;
  return GitHubErrorCode.SERVER_ERROR;
}

/** §4.1 — high-level category derived from a code, for the UI/error response. */
export function categoryForCode(code: GitHubErrorCode): ErrorCategory {
  switch (code) {
    case GitHubErrorCode.AUTHENTICATION_FAILED:
    case GitHubErrorCode.TOKEN_EXPIRED:
    case GitHubErrorCode.TOKEN_REVOKED:
      return ErrorCategory.AUTHENTICATION;
    case GitHubErrorCode.FORBIDDEN:
      return ErrorCategory.AUTHORIZATION;
    case GitHubErrorCode.VALIDATION_ERROR:
      return ErrorCategory.VALIDATION;
    case GitHubErrorCode.NOT_FOUND:
      return ErrorCategory.NOT_FOUND;
    case GitHubErrorCode.RATE_LIMIT_EXCEEDED:
      return ErrorCategory.RATE_LIMITED;
    case GitHubErrorCode.SECONDARY_RATE_LIMIT:
      return ErrorCategory.ABUSE_DETECTED;
    case GitHubErrorCode.SERVICE_UNAVAILABLE:
      return ErrorCategory.SERVICE_UNAVAILABLE;
    case GitHubErrorCode.SERVER_ERROR:
      return ErrorCategory.SERVER_ERROR;
    case GitHubErrorCode.TIMEOUT:
      return ErrorCategory.TIMEOUT;
    case GitHubErrorCode.NETWORK_ERROR:
      return ErrorCategory.NETWORK_ERROR;
    case GitHubErrorCode.CONFIGURATION_ERROR:
      return ErrorCategory.CONFIGURATION;
    default:
      return ErrorCategory.UNKNOWN;
  }
}

function makeError(
  code: GitHubErrorCode,
  message: string,
  statusCode: number,
  extra?: Partial<GitHubAPIError>
): GitHubAPIError {
  return { code, message, statusCode, ...extra };
}

export interface RequestOptions {
  body?: Record<string, unknown> | unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
}

/**
 * Low-level GitHub REST client. One instance per integration. Resolves the bearer
 * token lazily from the vault on first use so a revoked token surfaces as a
 * TOKEN_REVOKED error rather than a stale cached header.
 */
export class GitHubAPIClient {
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly userAgent: string;
  private readonly baseUrl: string;
  private readonly retryPolicy: RetryPolicy;
  private rateLimit: RateLimitState | null = null;

  // Injectable for tests; defaults to the global fetch.
  private readonly fetchImpl: typeof fetch;
  // Injectable backoff/sleep so tests don't actually wait. Returns ms slept.
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly integrationId: string,
    private readonly tokenVault: TokenVault,
    options?: ClientOptions & {
      fetchImpl?: typeof fetch;
      sleep?: (ms: number) => Promise<void>;
      retryPolicy?: RetryPolicy;
    }
  ) {
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = options?.retryCount ?? DEFAULT_RETRY_POLICY.maxAttempts;
    this.userAgent = options?.userAgent ?? DEFAULT_USER_AGENT;
    this.baseUrl = (options?.baseUrl ?? defaultBaseUrl()).replace(/\/+$/, "");
    this.retryPolicy = options?.retryPolicy ?? DEFAULT_RETRY_POLICY;
    this.fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    this.sleep =
      options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  getRateLimit(): RateLimitState | null {
    return this.rateLimit;
  }

  /** §2.1 — extract + cache rate-limit info from response headers. */
  private updateRateLimitState(headers: Headers): void {
    const limit = headers.get("x-ratelimit-limit");
    const remaining = headers.get("x-ratelimit-remaining");
    const reset = headers.get("x-ratelimit-reset");
    const used = headers.get("x-ratelimit-used");
    if (remaining === null && reset === null) return;
    const resetSec = reset ? Number(reset) : 0;
    this.rateLimit = {
      limit: limit ? Number(limit) : 0,
      remaining: remaining ? Number(remaining) : 0,
      reset: resetSec,
      resetAt: new Date(resetSec * 1000),
      used: used ? Number(used) : 0,
    };
  }

  private buildUrl(endpoint: string, query?: RequestOptions["query"]): string {
    const url = endpoint.startsWith("http")
      ? new URL(endpoint)
      : new URL(this.baseUrl + (endpoint.startsWith("/") ? endpoint : `/${endpoint}`));
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  /** Core request method with auth, rate-limit accounting and retry/backoff. */
  async request<T>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    endpoint: string,
    options?: RequestOptions
  ): Promise<T> {
    let attempt = 0;
    // attempt is 1-based for shouldRetry/backoff math (§3.3).
    // We try up to maxRetries+1 times total (initial + retries).
    while (true) {
      attempt++;
      try {
        return await this.attempt<T>(method, endpoint, options);
      } catch (err) {
        const apiError = err as GitHubAPIError;
        if (!isGitHubAPIError(apiError)) throw err;
        if (!shouldRetry(apiError, attempt, this.maxRetries)) throw apiError;
        // Secondary rate-limit / rate-limit honor Retry-After when present.
        let delay: number;
        if (apiError.retryAfter && apiError.retryAfter > 0) {
          delay = apiError.retryAfter * 1000;
        } else {
          delay = calculateBackoff(attempt, this.retryPolicy);
        }
        await this.sleep(delay);
      }
    }
  }

  private async attempt<T>(method: string, endpoint: string, options?: RequestOptions): Promise<T> {
    let token: string;
    try {
      token = await this.tokenVault.getToken(this.integrationId);
    } catch (err) {
      throw makeError(
        GitHubErrorCode.TOKEN_REVOKED,
        err instanceof Error ? err.message : "Token unavailable",
        0
      );
    }

    const url = this.buildUrl(endpoint, options?.query);
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": this.userAgent,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options?.headers ?? {}),
    };
    let bodyStr: string | undefined;
    if (options?.body !== undefined && method !== "GET") {
      bodyStr = JSON.stringify(options.body);
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: bodyStr,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw makeError(GitHubErrorCode.TIMEOUT, `Request to ${endpoint} timed out`, 0);
      }
      throw makeError(
        GitHubErrorCode.NETWORK_ERROR,
        err instanceof Error ? err.message : "Network error",
        0
      );
    } finally {
      clearTimeout(timer);
    }

    this.updateRateLimitState(res.headers);

    if (res.status === 204) {
      return undefined as T;
    }

    if (res.ok) {
      const text = await res.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    }

    // Error path: classify, attach rate-limit / retry-after metadata.
    const code = classifyResponse(res.status, res.headers);
    let bodyJson: { message?: string; documentation_url?: string } | null = null;
    const rawText = await res.text().catch(() => "");
    try {
      bodyJson = rawText ? JSON.parse(rawText) : null;
    } catch {
      bodyJson = null;
    }
    const resetHeader = res.headers.get("x-ratelimit-reset");
    const retryAfterHeader = res.headers.get("retry-after");
    throw makeError(code, bodyJson?.message ?? `GitHub API error ${res.status}`, res.status, {
      rateLimitReset: resetHeader ? new Date(Number(resetHeader) * 1000) : undefined,
      retryAfter: retryAfterHeader ? Number(retryAfterHeader) : undefined,
      requestId: res.headers.get("x-github-request-id") ?? undefined,
      documentation: bodyJson?.documentation_url,
    });
  }
}

export function isGitHubAPIError(err: unknown): err is GitHubAPIError {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "statusCode" in err &&
    typeof (err as GitHubAPIError).code === "string"
  );
}

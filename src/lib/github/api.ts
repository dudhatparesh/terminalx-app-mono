// §2.6 Typed API surface over the hand-rolled client. Each sub-API maps to a slice
// of the GitHub REST API; the aggregates (checks/review) compose them into the
// shapes the review-panel tabs (§0.1) consume.
import { GitHubAPIClient } from "./client";
import { buildChecksSummary, buildReviewSummary } from "./derive";
import type { TokenVault } from "./token-vault";
import {
  Branch,
  BranchProtection,
  ChecksSummary,
  CheckConclusion,
  CheckRun,
  CheckStatus,
  Comment,
  Commit,
  CommitStatus,
  PullRequest,
  Repository,
  Review,
  ReviewComment,
  ReviewSummary,
  User,
  WebhookConfig,
} from "./types";

function pageQuery(opts?: { perPage?: number; page?: number }): Record<string, number> {
  const q: Record<string, number> = {};
  if (opts?.perPage) q.per_page = opts.perPage;
  if (opts?.page) q.page = opts.page;
  return q;
}

// ── §2.2 Repository ──────────────────────────────────────────────────────────

export class RepositoryAPIImpl {
  constructor(private readonly client: GitHubAPIClient) {}

  getRepository(owner: string, repo: string): Promise<Repository> {
    return this.client.request("GET", `/repos/${owner}/${repo}`);
  }

  listBranches(
    owner: string,
    repo: string,
    options?: { perPage?: number; page?: number }
  ): Promise<Branch[]> {
    return this.client.request("GET", `/repos/${owner}/${repo}/branches`, {
      query: pageQuery(options),
    });
  }

  async getBranchProtection(
    owner: string,
    repo: string,
    branch: string
  ): Promise<BranchProtection | null> {
    try {
      return await this.client.request(
        "GET",
        `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`
      );
    } catch {
      // A branch with no protection returns 404; surface that as `null`.
      return null;
    }
  }

  listCommits(
    owner: string,
    repo: string,
    options?: { sha?: string; path?: string; author?: string; perPage?: number; page?: number }
  ): Promise<Commit[]> {
    return this.client.request("GET", `/repos/${owner}/${repo}/commits`, {
      query: {
        sha: options?.sha,
        path: options?.path,
        author: options?.author,
        ...pageQuery(options),
      },
    });
  }

  getCommit(owner: string, repo: string, ref: string): Promise<Commit> {
    return this.client.request("GET", `/repos/${owner}/${repo}/commits/${ref}`);
  }
}

// ── §2.3 Pull Requests ───────────────────────────────────────────────────────

export class PullRequestAPIImpl {
  constructor(private readonly client: GitHubAPIClient) {}

  createPullRequest(
    owner: string,
    repo: string,
    input: {
      title: string;
      body?: string;
      head: string;
      base: string;
      draft?: boolean;
      labels?: string[];
      assignees?: string[];
      reviewers?: string[];
    }
  ): Promise<PullRequest> {
    const { labels, assignees, reviewers, ...createBody } = input;
    void labels;
    void assignees;
    void reviewers; // applied via update/requestReviewers in the workflow (§7.2)
    return this.client.request("POST", `/repos/${owner}/${repo}/pulls`, { body: createBody });
  }

  getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest> {
    return this.client.request("GET", `/repos/${owner}/${repo}/pulls/${prNumber}`);
  }

  listPullRequests(
    owner: string,
    repo: string,
    options?: {
      state?: "open" | "closed" | "all";
      base?: string;
      head?: string;
      sort?: "created" | "updated" | "popularity" | "long-running";
      direction?: "asc" | "desc";
      perPage?: number;
      page?: number;
    }
  ): Promise<PullRequest[]> {
    return this.client.request("GET", `/repos/${owner}/${repo}/pulls`, {
      query: {
        state: options?.state,
        base: options?.base,
        head: options?.head,
        sort: options?.sort,
        direction: options?.direction,
        ...pageQuery(options),
      },
    });
  }

  updatePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    updates: {
      title?: string;
      body?: string;
      state?: "open" | "closed";
      base?: string;
      draft?: boolean;
      labels?: string[];
      assignees?: string[];
    }
  ): Promise<PullRequest> {
    return this.client.request("PATCH", `/repos/${owner}/${repo}/pulls/${prNumber}`, {
      body: updates,
    });
  }

  mergePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    options?: {
      commitTitle?: string;
      commitMessage?: string;
      mergeMethod?: "merge" | "squash" | "rebase";
    }
  ): Promise<{ sha: string; merged: boolean; message: string }> {
    return this.client.request("PUT", `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
      body: {
        commit_title: options?.commitTitle,
        commit_message: options?.commitMessage,
        merge_method: options?.mergeMethod,
      },
    });
  }

  createComment(owner: string, repo: string, prNumber: number, body: string): Promise<Comment> {
    return this.client.request("POST", `/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      body: { body },
    });
  }

  updateComment(owner: string, repo: string, commentId: number, body: string): Promise<Comment> {
    return this.client.request("PATCH", `/repos/${owner}/${repo}/issues/comments/${commentId}`, {
      body: { body },
    });
  }

  deleteComment(owner: string, repo: string, commentId: number): Promise<void> {
    return this.client.request("DELETE", `/repos/${owner}/${repo}/issues/comments/${commentId}`);
  }

  listComments(
    owner: string,
    repo: string,
    prNumber: number,
    options?: { perPage?: number; page?: number }
  ): Promise<Comment[]> {
    return this.client.request("GET", `/repos/${owner}/${repo}/pulls/${prNumber}/comments`, {
      query: pageQuery(options),
    });
  }
}

// ── §2.4 Check runs & statuses ───────────────────────────────────────────────

export class CheckRunAPIImpl {
  constructor(private readonly client: GitHubAPIClient) {}

  async listCheckRuns(
    owner: string,
    repo: string,
    ref: string,
    options?: {
      appId?: number;
      checkName?: string;
      status?: CheckStatus;
      conclusion?: CheckConclusion;
      perPage?: number;
      page?: number;
    }
  ): Promise<CheckRun[]> {
    const res = await this.client.request<{ check_runs: CheckRun[] }>(
      "GET",
      `/repos/${owner}/${repo}/commits/${ref}/check-runs`,
      {
        query: {
          app_id: options?.appId,
          check_name: options?.checkName,
          status: options?.status,
          ...pageQuery(options),
        },
      }
    );
    return res?.check_runs ?? [];
  }

  getCheckRun(owner: string, repo: string, checkRunId: number): Promise<CheckRun> {
    return this.client.request("GET", `/repos/${owner}/${repo}/check-runs/${checkRunId}`);
  }

  createCheckRun(
    owner: string,
    repo: string,
    input: {
      name: string;
      head_sha: string;
      status?: CheckStatus;
      details_url?: string;
      external_id?: string;
      output?: CheckRun["output"];
    }
  ): Promise<CheckRun> {
    return this.client.request("POST", `/repos/${owner}/${repo}/check-runs`, { body: input });
  }

  updateCheckRun(
    owner: string,
    repo: string,
    checkRunId: number,
    updates: {
      status?: CheckStatus;
      conclusion?: CheckConclusion;
      completed_at?: string;
      output?: CheckRun["output"];
    }
  ): Promise<CheckRun> {
    return this.client.request("PATCH", `/repos/${owner}/${repo}/check-runs/${checkRunId}`, {
      body: updates,
    });
  }

  async listCheckSuites(
    owner: string,
    repo: string,
    ref: string
  ): Promise<Array<{ id: number; status: CheckStatus; conclusion: string | null }>> {
    const res = await this.client.request<{
      check_suites: Array<{ id: number; status: CheckStatus; conclusion: string | null }>;
    }>("GET", `/repos/${owner}/${repo}/commits/${ref}/check-suites`);
    return res?.check_suites ?? [];
  }
}

export class StatusAPIImpl {
  constructor(private readonly client: GitHubAPIClient) {}

  listStatuses(owner: string, repo: string, ref: string): Promise<CommitStatus[]> {
    return this.client.request("GET", `/repos/${owner}/${repo}/commits/${ref}/statuses`);
  }

  createStatus(
    owner: string,
    repo: string,
    ref: string,
    input: {
      state: "pending" | "success" | "failure" | "error";
      description?: string;
      context: string;
      target_url?: string;
    }
  ): Promise<void> {
    return this.client.request("POST", `/repos/${owner}/${repo}/statuses/${ref}`, { body: input });
  }
}

// ── §2.5 Reviews ─────────────────────────────────────────────────────────────

export class ReviewAPIImpl {
  constructor(private readonly client: GitHubAPIClient) {}

  listReviews(
    owner: string,
    repo: string,
    prNumber: number,
    options?: { perPage?: number; page?: number }
  ): Promise<Review[]> {
    return this.client.request("GET", `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
      query: pageQuery(options),
    });
  }

  listReviewComments(
    owner: string,
    repo: string,
    prNumber: number,
    options?: { perPage?: number; page?: number }
  ): Promise<ReviewComment[]> {
    return this.client.request("GET", `/repos/${owner}/${repo}/pulls/${prNumber}/comments`, {
      query: pageQuery(options),
    });
  }

  replyToReviewComment(
    owner: string,
    repo: string,
    prNumber: number,
    commentId: number,
    body: string
  ): Promise<ReviewComment> {
    return this.client.request(
      "POST",
      `/repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`,
      { body: { body } }
    );
  }

  requestReviewers(
    owner: string,
    repo: string,
    prNumber: number,
    input: { reviewers?: string[]; team_reviewers?: string[] }
  ): Promise<PullRequest> {
    return this.client.request(
      "POST",
      `/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      { body: input }
    );
  }

  createReview(
    owner: string,
    repo: string,
    prNumber: number,
    input: {
      body?: string;
      event: "PENDING" | "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
      comments?: Array<{ path: string; line: number; body: string }>;
    }
  ): Promise<Review> {
    return this.client.request("POST", `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
      body: input,
    });
  }

  dismissReview(
    owner: string,
    repo: string,
    prNumber: number,
    reviewId: number,
    message: string
  ): Promise<Review> {
    return this.client.request(
      "PUT",
      `/repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId}/dismissals`,
      { body: { message } }
    );
  }
}

// ── §2.5a Authenticated user ─────────────────────────────────────────────────

export class UsersAPIImpl {
  constructor(private readonly client: GitHubAPIClient) {}

  getAuthenticated(): Promise<User> {
    return this.client.request("GET", "/user");
  }
}

// ── §5.1 Webhooks ────────────────────────────────────────────────────────────

export class WebhookAPIImpl {
  constructor(private readonly client: GitHubAPIClient) {}

  async createWebhook(
    integrationId: string,
    owner: string,
    repo: string,
    config: WebhookConfig
  ): Promise<{ id: string; url: string; secret: string }> {
    void integrationId; // the client is already bound to the integration
    const res = await this.client.request<{ id: number; config: { url: string } }>(
      "POST",
      `/repos/${owner}/${repo}/hooks`,
      {
        body: {
          name: "web",
          active: config.active,
          events: config.events,
          config: {
            url: config.url,
            content_type: "json",
            secret: config.secret,
            insecure_ssl: config.insecureSSL ? "1" : "0",
          },
        },
      }
    );
    return { id: String(res.id), url: res.config.url, secret: config.secret };
  }

  updateWebhook(
    integrationId: string,
    owner: string,
    repo: string,
    webhookId: string,
    config: Partial<WebhookConfig>
  ): Promise<void> {
    void integrationId;
    return this.client.request("PATCH", `/repos/${owner}/${repo}/hooks/${webhookId}`, {
      body: {
        active: config.active,
        events: config.events,
        config: config.url
          ? { url: config.url, content_type: "json", secret: config.secret }
          : undefined,
      },
    });
  }

  deleteWebhook(
    integrationId: string,
    owner: string,
    repo: string,
    webhookId: string
  ): Promise<void> {
    void integrationId;
    return this.client.request("DELETE", `/repos/${owner}/${repo}/hooks/${webhookId}`);
  }

  testWebhook(
    integrationId: string,
    owner: string,
    repo: string,
    webhookId: string
  ): Promise<void> {
    void integrationId;
    return this.client.request("POST", `/repos/${owner}/${repo}/hooks/${webhookId}/tests`);
  }
}

// ── Aggregates (§2.4 / §2.5) ─────────────────────────────────────────────────

export class ChecksAggregateAPIImpl {
  constructor(
    private readonly checks: CheckRunAPIImpl,
    private readonly status: StatusAPIImpl
  ) {}

  /** Merge check runs + commit statuses for a head SHA into one ChecksSummary. */
  async getChecksForSha(owner: string, repo: string, headSha: string): Promise<ChecksSummary> {
    const [runs, statuses] = await Promise.all([
      this.checks.listCheckRuns(owner, repo, headSha),
      this.status.listStatuses(owner, repo, headSha),
    ]);
    return buildChecksSummary(headSha, runs, statuses);
  }
}

export class ReviewAggregateAPIImpl {
  constructor(private readonly reviews: ReviewAPIImpl) {}

  /** Compose listReviews() + listReviewComments() into the Review-tab payload. */
  async getReviewSummary(owner: string, repo: string, prNumber: number): Promise<ReviewSummary> {
    const [reviews, comments] = await Promise.all([
      this.reviews.listReviews(owner, repo, prNumber),
      this.reviews.listReviewComments(owner, repo, prNumber),
    ]);
    return buildReviewSummary(prNumber, reviews, comments);
  }
}

// ── §2.6 Facade ──────────────────────────────────────────────────────────────

export class GitHubAPI {
  readonly client: GitHubAPIClient;
  readonly repo: RepositoryAPIImpl;
  readonly pulls: PullRequestAPIImpl;
  readonly checks: CheckRunAPIImpl;
  readonly reviews: ReviewAPIImpl;
  readonly status: StatusAPIImpl;
  readonly users: UsersAPIImpl;
  readonly webhooks: WebhookAPIImpl;
  readonly checksAggregate: ChecksAggregateAPIImpl;
  readonly reviewAggregate: ReviewAggregateAPIImpl;

  constructor(
    public readonly integrationId: string,
    tokenVault: TokenVault,
    options?: ConstructorParameters<typeof GitHubAPIClient>[2]
  ) {
    this.client = new GitHubAPIClient(integrationId, tokenVault, options);
    this.repo = new RepositoryAPIImpl(this.client);
    this.pulls = new PullRequestAPIImpl(this.client);
    this.checks = new CheckRunAPIImpl(this.client);
    this.reviews = new ReviewAPIImpl(this.client);
    this.status = new StatusAPIImpl(this.client);
    this.users = new UsersAPIImpl(this.client);
    this.webhooks = new WebhookAPIImpl(this.client);
    this.checksAggregate = new ChecksAggregateAPIImpl(this.checks, this.status);
    this.reviewAggregate = new ReviewAggregateAPIImpl(this.reviews);
  }
}

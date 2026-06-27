# PR Creation & Review UI - Advanced Features & Extension Points

**Purpose:** Advanced capabilities, future enhancements, and plugin architecture for TerminalX PR system.

---

## 1. Advanced Features (Future)

### 1.1 AI-Powered Code Review

```typescript
// src/lib/ai/codeReviewService.ts
import { Anthropic } from "@anthropic-ai/sdk";

export class AICodeReviewService {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateReviewComments(
    filePath: string,
    oldCode: string,
    newCode: string
  ): Promise<AIComment[]> {
    const prompt = `
Review this code change and suggest improvements:

File: ${filePath}

Old code:
\`\`\`
${oldCode}
\`\`\`

New code:
\`\`\`
${newCode}
\`\`\`

Provide 2-3 specific, actionable comments. Format as JSON:
[
  {
    "line": <line_number>,
    "severity": "info" | "warning" | "error",
    "comment": "<suggestion>"
  }
]
`;

    const message = await this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    try {
      const content = message.content[0];
      if (content.type === "text") {
        const json = JSON.parse(content.text);
        return json as AIComment[];
      }
    } catch (e) {
      console.error("Failed to parse AI review:", e);
    }

    return [];
  }

  async suggestTitle(files: FileDiff[], description: string): Promise<string> {
    const changedFiles = files.map((f) => f.path).join(", ");

    const prompt = `
Generate a concise Git commit title (max 50 chars) for this PR.

Files changed: ${changedFiles}
Description: ${description}

Return only the title, no quotes.
`;

    const message = await this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
    });

    if (message.content[0].type === "text") {
      return message.content[0].text.trim();
    }

    return "Update code";
  }
}

interface AIComment {
  line: number;
  severity: "info" | "warning" | "error";
  comment: string;
  generated?: boolean;
}
```

**UI Integration:**

```typescript
// In DiffViewer component
const [aiSuggestions, setAiSuggestions] = useState<AIComment[]>([]);
const [aiLoading, setAiLoading] = useState(false);

async function generateAIReview() {
  setAiLoading(true);
  const aiService = new AICodeReviewService(process.env.ANTHROPIC_API_KEY!);
  const suggestions = await aiService.generateReviewComments(file.path, originalCode, newCode);
  setAiSuggestions(suggestions);
  setAiLoading(false);
}
```

### 1.2 Real-time Collaboration (WebSocket)

```typescript
// src/lib/collaboration/prReviewSync.ts
import { WebSocket } from "ws";

export class PRReviewCollaborationService {
  private ws: WebSocket | null = null;
  private messageHandlers: Map<string, Function> = new Map();

  async connect(prNumber: number, token: string) {
    this.ws = new WebSocket(`wss://your-server.com/ws/pr-review/${prNumber}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    this.ws.on("message", (data: string) => {
      const event = JSON.parse(data);
      const handler = this.messageHandlers.get(event.type);
      handler?.(event.payload);
    });
  }

  // Broadcast when user adds comment
  broadcastComment(comment: DiffComment) {
    this.send({
      type: "comment:add",
      payload: comment,
    });
  }

  // Listen for remote user actions
  on(event: "comment:add" | "user:joined" | "user:left", handler: Function) {
    this.messageHandlers.set(event, handler);
  }

  private send(message: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect() {
    this.ws?.close();
  }
}

// Usage in component
const collaborationService = useMemo(() => new PRReviewCollaborationService(), []);

useEffect(() => {
  collaborationService.connect(pr.number, authToken);

  // Show when other users comment
  collaborationService.on("comment:add", (comment) => {
    showToast(`@${comment.author} commented on ${comment.lineId}`);
  });

  return () => collaborationService.disconnect();
}, [pr.number, authToken]);
```

### 1.3 Code Coverage Integration

```typescript
// src/lib/coverage/coverageService.ts
export class CoverageService {
  async fetchCoverage(
    owner: string,
    repo: string,
    ref: string
  ): Promise<LineCoverage[]> {
    // Integrate with Codecov, Coveralls, etc.
    const response = await fetch(
      `https://codecov.io/api/gh/${owner}/${repo}/pulls/${ref}`
    )
    const data = await response.json()
    return this.parseCoverageData(data)
  }

  parseCoverageData(data: any): LineCoverage[] {
    return data.files.map((file: any) => ({
      path: file.name,
      coverage: file.coverage,
      lines: file.lines.map((line: any) => ({
        lineNumber: line.line_number,
        hits: line.hits,
      })),
    }))
  }
}

interface LineCoverage {
  path: string
  coverage: number // percentage
  lines: {
    lineNumber: number
    hits: number // 0 = uncovered, > 0 = covered
  }[]
}

// In DiffLine component
function DiffLineWithCoverage({
  line,
  coverage,
  ...props
}: DiffLineProps & { coverage?: number }) {
  const coverageClass = coverage === 0 ? 'bg-red-900/20' : 'bg-green-900/20'

  return (
    <div className={coverage !== undefined ? coverageClass : ''}>
      <DiffLine {...props} />
    </div>
  )
}
```

### 1.4 Merge Conflict Detection

```typescript
// src/lib/merge/conflictDetector.ts
export class ConflictDetector {
  async checkMergeability(owner: string, repo: string, prNumber: number): Promise<MergeStatus> {
    const octokit = new Octokit({ auth: this.token });

    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    return {
      mergeable: pr.mergeable,
      mergeableState: pr.mergeable_state,
      conflicts: pr.mergeable_state === "dirty" ? [] : undefined,
      message: pr.merge_commit_sha ? "Can be merged" : "Conflicts must be resolved",
    };
  }

  async detectConflictingLines(diff: FileDiff): Promise<ConflictRegion[]> {
    const conflicts: ConflictRegion[] = [];
    const conflictPattern = /^(<<<<<<<|=======|>>>>>>>)/m;

    const lines = diff.patch?.split("\n") || [];
    let inConflict = false;
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
      if (conflictPattern.test(lines[i])) {
        if (!inConflict) {
          startLine = i;
          inConflict = true;
        } else if (lines[i].startsWith(">>>>>>>")) {
          conflicts.push({
            startLine,
            endLine: i,
            file: diff.path,
          });
          inConflict = false;
        }
      }
    }

    return conflicts;
  }
}

interface MergeStatus {
  mergeable: boolean;
  mergeableState: string;
  conflicts?: ConflictRegion[];
  message: string;
}

interface ConflictRegion {
  startLine: number;
  endLine: number;
  file: string;
}
```

### 1.5 CI/CD Status Integration

```typescript
// src/lib/ci/ciStatusService.ts
export class CIStatusService {
  async fetchCheckRuns(
    owner: string,
    repo: string,
    ref: string
  ): Promise<CheckRun[]> {
    const octokit = new Octokit({ auth: this.token })

    const { data } = await octokit.checks.listForRef({
      owner,
      repo,
      ref,
    })

    return data.check_runs.map(run => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      detailsUrl: run.details_url,
      output: run.output?.title,
    }))
  }

  getStatusIcon(status: string): React.ReactNode {
    const icons = {
      queued: <Clock className="h-4 w-4 text-yellow-500" />,
      in_progress: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
      completed: <Check className="h-4 w-4 text-green-500" />,
    }
    return icons[status as keyof typeof icons]
  }
}

// In PRReviewPanel header
<div className="space-y-2">
  <h3 className="text-sm font-medium">CI Status</h3>
  {checkRuns.map(run => (
    <div key={run.id} className="flex items-center gap-2 text-sm">
      {CIStatusService.getStatusIcon(run.status)}
      <a href={run.detailsUrl} className="underline">
        {run.name}
      </a>
      {run.conclusion && (
        <span className="text-xs text-muted-foreground">
          {run.conclusion}
        </span>
      )}
    </div>
  ))}
</div>
```

---

## 2. Plugin Architecture

### 2.1 Comment Plugin System

```typescript
// src/lib/plugins/commentPluginTypes.ts
export interface CommentPlugin {
  name: string;
  version: string;

  // Hook: Before comment is posted
  beforePost?(comment: DiffComment): Promise<DiffComment>;

  // Hook: After comment is received
  afterReceive?(comment: DiffComment): Promise<DiffComment>;

  // Hook: When rendering comment
  renderComment?(comment: DiffComment): React.ReactNode;

  // Hook: Custom actions in comment menu
  customActions?(comment: DiffComment): CommentAction[];
}

interface CommentAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => Promise<void>;
  variant?: "default" | "destructive";
}

// Example: Markdown formatter plugin
export const MarkdownFormatterPlugin: CommentPlugin = {
  name: "markdown-formatter",
  version: "1.0.0",

  beforePost: async (comment) => {
    // Auto-format markdown
    comment.content = comment.content
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>");
    return comment;
  },

  customActions: (comment) => [
    {
      label: "Copy markdown",
      onClick: async () => {
        await navigator.clipboard.writeText(comment.content);
      },
    },
  ],
};
```

### 2.2 Diff Viewer Plugin System

```typescript
// src/lib/plugins/diffPluginTypes.ts
export interface DiffPlugin {
  name: string
  version: string

  // Modify diff before rendering
  transformDiff?(file: FileDiff): FileDiff

  // Add custom rendering for certain file types
  canHandle?(filename: string): boolean
  renderFile?(file: FileDiff): React.ReactNode

  // Custom line highlighting
  getLineHighlight?(line: DiffLine): string

  // Custom gutter icons
  getGutterIcon?(line: DiffLine): React.ReactNode
}

// Example: TypeScript type annotation plugin
export const TypeScriptPlugin: DiffPlugin = {
  name: 'typescript-types',
  version: '1.0.0',

  canHandle: (filename) => filename.endsWith('.ts') || filename.endsWith('.tsx'),

  getGutterIcon: (line) => {
    if (line.content.includes(':')) {
      return <TypeIcon className="h-3 w-3" />
    }
    return null
  },

  getLineHighlight: (line) => {
    // Add specific highlighting for type definitions
    if (line.content.includes('interface ') || line.content.includes('type ')) {
      return 'bg-purple-900/10'
    }
    return ''
  },
}
```

### 2.3 Plugin Registry

```typescript
// src/lib/plugins/pluginRegistry.ts
export class PluginRegistry {
  private commentPlugins: Map<string, CommentPlugin> = new Map();
  private diffPlugins: Map<string, DiffPlugin> = new Map();

  registerCommentPlugin(plugin: CommentPlugin) {
    this.commentPlugins.set(plugin.name, plugin);
  }

  registerDiffPlugin(plugin: DiffPlugin) {
    this.diffPlugins.set(plugin.name, plugin);
  }

  async executeCommentHook(
    hook: keyof Omit<CommentPlugin, "name" | "version">,
    comment: DiffComment
  ): Promise<DiffComment> {
    let result = comment;

    for (const plugin of this.commentPlugins.values()) {
      const hookFn = plugin[hook] as any;
      if (hookFn) {
        result = await hookFn(result);
      }
    }

    return result;
  }

  getDiffPlugin(filename: string): DiffPlugin | null {
    for (const plugin of this.diffPlugins.values()) {
      if (plugin.canHandle?.(filename)) {
        return plugin;
      }
    }
    return null;
  }

  getCommentActions(comment: DiffComment): CommentAction[] {
    let actions: CommentAction[] = [];

    for (const plugin of this.commentPlugins.values()) {
      const pluginActions = plugin.customActions?.(comment) || [];
      actions = [...actions, ...pluginActions];
    }

    return actions;
  }
}

// Global registry instance
export const pluginRegistry = new PluginRegistry();
```

---

## 3. Webhook Integration

### 3.1 GitHub Webhook Handler

```typescript
// src/app/api/webhooks/github/route.ts
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  // Verify webhook signature
  const signature = req.headers.get("x-hub-signature-256") || "";
  const body = await req.text();

  const hmac = crypto.createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET!);
  const digest = "sha256=" + hmac.update(body).digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(body);
  const action = req.headers.get("x-github-event");

  // Handle different webhook events
  switch (action) {
    case "pull_request":
      return handlePREvent(event);
    case "pull_request_review_comment":
      return handleCommentEvent(event);
    case "pull_request_review":
      return handleReviewEvent(event);
    default:
      return NextResponse.json({ received: true });
  }
}

async function handlePREvent(event: any) {
  const { action, pull_request } = event;

  // Broadcast to connected clients via WebSocket
  broadcastToRoom(`pr-${pull_request.number}`, {
    type: "pr:updated",
    pr: pull_request,
    action,
  });

  return NextResponse.json({ received: true });
}

async function handleCommentEvent(event: any) {
  const { action, comment, pull_request } = event;

  // Notify review session
  broadcastToRoom(`pr-${pull_request.number}`, {
    type: "comment:updated",
    comment,
    action,
  });

  return NextResponse.json({ received: true });
}

async function handleReviewEvent(event: any) {
  const { review, pull_request } = event;

  broadcastToRoom(`pr-${pull_request.number}`, {
    type: "review:submitted",
    review,
  });

  return NextResponse.json({ received: true });
}

function broadcastToRoom(room: string, message: any) {
  // Implement via Redis pub/sub or similar
  // This notifies all users viewing that PR
}
```

---

## 4. Search & Analytics

### 4.1 PR Search Service

```typescript
// src/lib/search/prSearchService.ts
export class PRSearchService {
  private elasticClient: elasticsearch.Client;

  constructor(elasticUrl: string) {
    this.elasticClient = new elasticsearch.Client({
      node: elasticUrl,
    });
  }

  async indexPR(pr: PullRequest) {
    await this.elasticClient.index({
      index: "pr-index",
      id: `${pr.repoOwner}/${pr.repoName}/${pr.number}`,
      document: {
        number: pr.number,
        title: pr.title,
        description: pr.description,
        author: pr.authorLogin,
        state: pr.state,
        createdAt: pr.createdAt,
        files: pr.files.map((f) => f.path),
        commits: pr.commits.length,
        comments: pr.commits.length, // This would be comment count
      },
    });
  }

  async search(query: string): Promise<SearchResult[]> {
    const result = await this.elasticClient.search({
      index: "pr-index",
      query: {
        multi_match: {
          query,
          fields: ["title^2", "description", "author", "files"],
        },
      },
    });

    return result.hits.hits.map((hit) => ({
      id: hit._id,
      score: hit._score,
      pr: hit._source as any,
    }));
  }

  async advancedSearch(filters: SearchFilters): Promise<SearchResult[]> {
    const must = [];

    if (filters.author) {
      must.push({ match: { author: filters.author } });
    }

    if (filters.state) {
      must.push({ match: { state: filters.state } });
    }

    if (filters.dateRange) {
      must.push({
        range: {
          createdAt: {
            gte: filters.dateRange.from,
            lte: filters.dateRange.to,
          },
        },
      });
    }

    const result = await this.elasticClient.search({
      index: "pr-index",
      query: { bool: { must } },
    });

    return result.hits.hits.map((hit) => ({
      id: hit._id,
      score: hit._score,
      pr: hit._source as any,
    }));
  }
}

interface SearchFilters {
  query?: string;
  author?: string;
  state?: "open" | "closed" | "merged";
  dateRange?: { from: string; to: string };
  labels?: string[];
}

interface SearchResult {
  id: string;
  score: number;
  pr: PullRequest;
}
```

### 4.2 Review Analytics

```typescript
// src/lib/analytics/reviewAnalytics.ts
export class ReviewAnalytics {
  async getReviewMetrics(
    owner: string,
    repo: string,
    period: "week" | "month" | "year" = "month"
  ): Promise<ReviewMetrics> {
    const timeRange = this.getTimeRange(period);

    const metrics = {
      avgReviewTime: await this.calculateAvgReviewTime(owner, repo, timeRange),
      avgCommentsPerPR: await this.calculateAvgComments(owner, repo, timeRange),
      approvalRate: await this.calculateApprovalRate(owner, repo, timeRange),
      toplReviewers: await this.getTopReviewers(owner, repo, timeRange),
      prThroughput: await this.calculateThroughput(owner, repo, timeRange),
    };

    return metrics;
  }

  private async calculateAvgReviewTime(
    owner: string,
    repo: string,
    timeRange: DateRange
  ): Promise<number> {
    // Query GitHub API for PR review times
    const prs = await this.getPRsInRange(owner, repo, timeRange);

    const reviewTimes = prs
      .filter((pr) => pr.closedAt)
      .map((pr) => {
        const created = new Date(pr.createdAt);
        const closed = new Date(pr.closedAt!);
        return (closed.getTime() - created.getTime()) / (1000 * 60 * 60); // hours
      });

    return reviewTimes.length > 0 ? reviewTimes.reduce((a, b) => a + b) / reviewTimes.length : 0;
  }

  // ... other metric calculations
}

interface ReviewMetrics {
  avgReviewTime: number; // hours
  avgCommentsPerPR: number;
  approvalRate: number; // percentage
  toplReviewers: { login: string; count: number }[];
  prThroughput: number; // PRs merged per week
}
```

---

## 5. Custom Extensions

### 5.1 Custom Review Template Plugin

```typescript
// src/extensions/customReviewTemplate.ts
export const customReviewTemplatePlugin: DiffPlugin = {
  name: "custom-review-template",
  version: "1.0.0",

  beforePost: async (comment) => {
    // Auto-add review template
    comment.content = `
## Review Template
- [ ] Code style check
- [ ] Logic verification
- [ ] Performance impact
- [ ] Test coverage
- [ ] Documentation

${comment.content}
    `.trim();

    return comment;
  },
};
```

### 5.2 Language-Specific Linting Plugin

```typescript
// src/extensions/lintingPlugin.ts
export const eslintPlugin: DiffPlugin = {
  name: "eslint-linting",
  version: "1.0.0",

  canHandle: (filename) => /\.(ts|tsx|js|jsx)$/.test(filename),

  transformDiff: (file) => {
    // Run ESLint on the new code
    const lintResults = eslintInstance.lintText(file.patch || "");

    // Add linting issues as synthetic comments
    lintResults.forEach((result) => {
      // Create comment for each lint error
    });

    return file;
  },
};
```

---

## 6. Notification System

### 6.1 Comment Mention Notifications

```typescript
// src/lib/notifications/mentionService.ts
export class MentionService {
  async detectMentions(text: string): Promise<string[]> {
    // Extract @username mentions
    const mentionPattern = /@([a-zA-Z0-9_-]+)/g;
    const matches = text.matchAll(mentionPattern);
    return Array.from(matches).map((m) => m[1]);
  }

  async notifyMentionedUsers(mentions: string[], comment: DiffComment, pr: PullRequest) {
    for (const username of mentions) {
      // Send notification to user
      await this.sendNotification({
        userId: username,
        type: "mention",
        title: `@${comment.author} mentioned you`,
        body: `${comment.author} mentioned you in PR #${pr.number}`,
        url: `/workspace/pr/${pr.number}#comment-${comment.id}`,
      });
    }
  }

  private async sendNotification(notification: Notification) {
    // Send via email, Slack, push notification, etc.
  }
}

interface Notification {
  userId: string;
  type: "mention" | "review-requested" | "pr-merged" | "comment-reply";
  title: string;
  body: string;
  url: string;
}
```

---

## 7. Integration Examples

### 7.1 Slack Integration

```typescript
// src/integrations/slack/slackService.ts
export class SlackIntegration {
  async postPRReview(pr: PullRequest, comment: DiffComment, webhookUrl: string) {
    const payload = {
      text: `New comment on PR #${pr.number}: ${pr.title}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${comment.author}* commented on <${pr.htmlUrl}|#${pr.number}>:\n\`\`\`${comment.content}\`\`\``,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "View on GitHub" },
              url: pr.htmlUrl,
            },
          ],
        },
      ],
    };

    await fetch(webhookUrl, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}
```

### 7.2 Jira Integration

```typescript
// src/integrations/jira/jiraService.ts
export class JiraIntegration {
  async linkPRToIssue(pr: PullRequest, issueKey: string) {
    // Extract issue key from PR description or branch name
    const issue = await this.jiraClient.getIssue(issueKey);

    // Add PR link to Jira issue
    await this.jiraClient.updateIssue(issueKey, {
      fields: {
        customfield_github_pr: pr.htmlUrl,
      },
    });

    // Add Jira link to PR description
    const updatedDescription = `${pr.description}\n\nRelated to: [${issueKey}](${this.jiraClient.getIssueUrl(issueKey)})`;
    await this.updatePRDescription(pr.number, updatedDescription);
  }

  private async updatePRDescription(prNumber: number, description: string) {
    // Update via GitHub API
  }
}
```

---

## 8. Performance Monitoring

### 8.1 Review Session Analytics

```typescript
// src/lib/monitoring/reviewSessionMonitoring.ts
export class ReviewSessionMonitoring {
  trackSessionStart(prNumber: number, userId: string) {
    analytics.track("review_session_started", {
      pr_number: prNumber,
      user_id: userId,
      timestamp: new Date(),
    });
  }

  trackCommentAdded(prNumber: number, commentId: string) {
    analytics.track("comment_added", {
      pr_number: prNumber,
      comment_id: commentId,
      timestamp: new Date(),
    });
  }

  trackSyncEvent(prNumber: number, syncedCount: number, failedCount: number, duration: number) {
    analytics.track("comments_synced", {
      pr_number: prNumber,
      synced_count: syncedCount,
      failed_count: failedCount,
      duration_ms: duration,
      success_rate: syncedCount / (syncedCount + failedCount),
    });
  }

  async generateSessionReport(prNumber: number): Promise<SessionReport> {
    // Aggregate session metrics
    return {
      totalReviewTime: 0,
      commentsAdded: 0,
      filesReviewed: 0,
      syncAttempts: 0,
      averageCommentLength: 0,
    };
  }
}

interface SessionReport {
  totalReviewTime: number;
  commentsAdded: number;
  filesReviewed: number;
  syncAttempts: number;
  averageCommentLength: number;
}
```

---

## 9. Testing Extensions

### 9.1 Mock PR Service for Testing

```typescript
// src/lib/github/__mocks__/pullRequests.ts
export const mockPRService = {
  getPR: async () => ({
    id: 1,
    number: 42,
    title: "Test PR",
    description: "Test description",
    // ... full mock PR
  }),

  createPR: async () => ({
    // ... mock created PR
  }),

  addComment: async () => ({
    // ... mock comment
  }),
};

// Usage in tests
vi.mock("@/lib/github/pullRequests", () => ({
  PRService: vi.fn(() => mockPRService),
}));
```

---

## 10. Roadmap

### Phase 1 (Current)

- [x] Core PR creation & review
- [x] Inline comments
- [x] Local sync

### Phase 2 (Next)

- [ ] Real-time collaboration
- [ ] AI code review
- [ ] CI/CD integration
- [ ] Search & analytics

### Phase 3 (Later)

- [ ] Slack/Jira integration
- [ ] Custom review templates
- [ ] Code coverage visualization
- [ ] PR suggestions

### Phase 4 (Future)

- [ ] Mobile app support
- [ ] Offline mode
- [ ] Custom workflow automation
- [ ] Enterprise features

---

**Last Updated:** June 2026  
**Status:** Extension Architecture Ready

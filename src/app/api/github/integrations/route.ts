// §6.2 Integration lifecycle: create / list / delete a user's GitHub integration.
// Identity resolves via getUserScoping -> User.id with an admin fallback in
// none/password modes (route-auth.ts). Unauthorized => 403 (NEVER 401).
import { NextRequest, NextResponse } from "next/server";
import { GitHubAPI } from "@/lib/github/api";
import { resolveUserId } from "@/lib/github/route-auth";
import { tokenVault } from "@/lib/github/token-vault";
import { getIntegrationRecord, listRepositoryRecords } from "@/lib/github/store";

function clientMeta(req: NextRequest) {
  return {
    userAgent: req.headers.get("user-agent") || "",
    ipAddress:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown",
  };
}

export async function GET(req: NextRequest) {
  const userId = resolveUserId(req.headers);
  if (!userId) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const integrations = await tokenVault.listIntegrations(userId);
  return NextResponse.json({
    integrations: integrations.map(({ id, displayName, authType, githubServerUrl, enabled }) => ({
      id,
      displayName,
      authType,
      githubServerUrl,
      enabled,
    })),
  });
}

export async function POST(req: NextRequest) {
  const userId = resolveUserId(req.headers);
  if (!userId) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: {
    token?: string;
    displayName?: string;
    serverUrl?: string;
    scopes?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json({ error: "A GitHub token is required" }, { status: 400 });
  }
  const serverUrl = body.serverUrl?.trim() || "https://github.com";
  const displayName = body.displayName?.trim() || "GitHub (Personal)";

  // 1. Store encrypted token (creates the integration record).
  let integrationId: string;
  try {
    integrationId = await tokenVault.storeToken(
      userId,
      { token, scopes: body.scopes },
      { displayName, githubServerUrl: serverUrl, ...clientMeta(req) }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to store integration" },
      { status: 409 }
    );
  }

  // 2. Test API access (GET /user, §2.5a). On failure, roll back the integration
  //    so we don't persist an unusable token.
  try {
    const api = new GitHubAPI(integrationId, tokenVault);
    const user = await api.users.getAuthenticated();
    return NextResponse.json(
      { integrationId, authenticatedAs: user.login, createdAt: new Date().toISOString() },
      { status: 201 }
    );
  } catch (err) {
    await tokenVault.deleteIntegration(integrationId).catch(() => {});
    return NextResponse.json(
      {
        error: "Invalid GitHub credentials",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const userId = resolveUserId(req.headers);
  if (!userId) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  let integrationId: string | undefined;
  try {
    ({ integrationId } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!integrationId) {
    return NextResponse.json({ error: "integrationId is required" }, { status: 400 });
  }

  // Verify ownership (record.userId == User.id, §1.1) — 403 on mismatch.
  const integration = getIntegrationRecord(integrationId);
  if (!integration || integration.userId !== userId) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Best-effort: remove webhooks from registered repos before revoking the token.
  const repos = listRepositoryRecords(integrationId);
  if (repos.some((r) => r.webhookId)) {
    try {
      const api = new GitHubAPI(integrationId, tokenVault);
      for (const repo of repos) {
        if (repo.webhookId) {
          await api.webhooks
            .deleteWebhook(integrationId, repo.owner, repo.name, repo.webhookId)
            .catch(() => {});
        }
      }
    } catch {
      // Token may already be gone; cascade-delete below still cleans local state.
    }
  }

  await tokenVault.deleteIntegration(integrationId);
  return NextResponse.json({ success: true });
}

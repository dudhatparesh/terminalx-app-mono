// Resolve a GitHub repo (owner/name) to the integration whose TokenVault credential
// should service it. A repo is registered against an integration via the
// GitHubRepositoryRecord (store.ts §1.1); we match on `fullName` (owner/name) and
// require the owning integration to be enabled.
//
// SERVER-ONLY: imports the GitHub store (fs). The route owns this transitively via
// aggregate.ts — never import from a "use client" file.
import { getIntegrationRecord, listRepositoryRecords } from "@/lib/github/store";
import type { GitHubRepositoryRecord } from "@/lib/github/types";

/** Find the registered repository record matching owner/name (case-insensitive). */
export function getRepositoryRecordByFullName(
  owner: string,
  name: string
): GitHubRepositoryRecord | null {
  const fullName = `${owner}/${name}`.toLowerCase();
  const match = listRepositoryRecords().find((r) => r.fullName.toLowerCase() === fullName);
  return match ?? null;
}

/**
 * The integration id that should service this repo, or null when no enabled
 * integration is bound. This is the "is a GitHub token configured for this repo"
 * signal used by §3.2's `hasGitHubToken` gate.
 */
export function integrationIdForRepo(owner: string, name: string): string | null {
  const record = getRepositoryRecordByFullName(owner, name);
  if (!record) return null;
  const integration = getIntegrationRecord(record.integrationId);
  if (!integration || !integration.enabled) return null;
  return integration.id;
}

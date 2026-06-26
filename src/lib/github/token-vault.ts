// §1.3 Secure token vault. Stores GitHub credentials encrypted at rest in the
// JSON-file store (data/github-integrations.json + data/github-tokens.json, §1.1),
// keyed by the existing User.id (NOT a SQL key). Encryption is AES-256-GCM with a
// PBKDF2-derived key (crypto.ts, §1.4).
import * as crypto from "crypto";
import { decryptToken, encryptToken, EncryptedBlob } from "./crypto";
import {
  deleteIntegrationRecord,
  getIntegrationRecord,
  getTokenRecord,
  listIntegrationsForUser,
  saveIntegrationRecord,
  saveTokenRecord,
  updateIntegrationRecord,
} from "./store";
import {
  GitHubAppConfig,
  GitHubIntegrationRecord,
  GitHubTokenRecord,
  PATTokenConfig,
} from "./types";

export interface StoreTokenMetadata {
  displayName: string;
  githubServerUrl: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface IntegrationSummary {
  id: string;
  displayName: string;
  authType: "PAT" | "GITHUB_APP";
  githubServerUrl: string;
  enabled: boolean;
  lastUsedAt?: Date;
}

function isAppConfig(config: PATTokenConfig | GitHubAppConfig): config is GitHubAppConfig {
  return "appId" in config && "privateKey" in config;
}

function blobToTokenFields(
  blob: EncryptedBlob
): Pick<GitHubTokenRecord, "tokenCiphertext" | "tokenNonce" | "tokenSalt" | "tokenTag"> {
  return {
    tokenCiphertext: blob.ciphertext,
    tokenNonce: blob.nonce,
    tokenSalt: blob.salt,
    tokenTag: blob.tag,
  };
}

function tokenFieldsToBlob(rec: GitHubTokenRecord): EncryptedBlob {
  return {
    ciphertext: rec.tokenCiphertext,
    nonce: rec.tokenNonce,
    salt: rec.tokenSalt,
    tag: rec.tokenTag ?? "",
  };
}

/**
 * Concrete TokenVault. Pass a `masterKey` to override the env var (used in tests).
 */
export class TokenVault {
  constructor(private readonly masterKey?: string) {}

  /**
   * Store an encrypted token; returns the new integration id.
   * Enforces (userId, githubServerUrl, authType) uniqueness via the store.
   */
  async storeToken(
    userId: string,
    config: PATTokenConfig | GitHubAppConfig,
    metadata: StoreTokenMetadata
  ): Promise<string> {
    const now = new Date().toISOString();
    const app = isAppConfig(config);
    const integration: GitHubIntegrationRecord = {
      id: crypto.randomUUID(),
      userId,
      displayName: metadata.displayName,
      githubServerUrl: metadata.githubServerUrl,
      authType: app ? "GITHUB_APP" : "PAT",
      enabled: true,
      createdAt: now,
      updatedAt: now,
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress,
    };
    // Saving first enforces uniqueness; it throws before we persist a token.
    await saveIntegrationRecord(integration);

    const secret = app ? config.privateKey : config.token;
    const blob = encryptToken(secret, this.masterKey);
    const tokenRecord: GitHubTokenRecord = {
      integrationId: integration.id,
      ...blobToTokenFields(blob),
      tokenType: app ? "app-jwt" : "bearer",
      patScopes: app ? undefined : config.scopes,
      appId: app ? config.appId : undefined,
      installationId: app ? config.installationId : undefined,
    };
    await saveTokenRecord(tokenRecord);
    return integration.id;
  }

  /** Retrieve and decrypt the token. Throws if missing / revoked / tampered. */
  async getToken(integrationId: string): Promise<string> {
    const integration = getIntegrationRecord(integrationId);
    if (!integration) throw new Error(`Integration ${integrationId} not found`);
    if (!integration.enabled) throw new Error(`Integration ${integrationId} is disabled/revoked`);
    const tokenRecord = getTokenRecord(integrationId);
    if (!tokenRecord) throw new Error(`No token stored for integration ${integrationId}`);
    const plaintext = decryptToken(tokenFieldsToBlob(tokenRecord), this.masterKey);
    // Best-effort touch of lastUsedAt; never let a write failure block reads.
    void updateIntegrationRecord(integrationId, {
      lastUsedAt: new Date().toISOString(),
    }).catch(() => {});
    return plaintext;
  }

  /** Validate the integration is enabled and the token decrypts. */
  async validateToken(integrationId: string): Promise<boolean> {
    try {
      await this.getToken(integrationId);
      return true;
    } catch {
      return false;
    }
  }

  /** Rotate a PAT: re-encrypt the new token in place. */
  async rotatePATToken(
    integrationId: string,
    newToken: string
  ): Promise<{ success: boolean; rotatedAt: Date }> {
    const tokenRecord = getTokenRecord(integrationId);
    if (!tokenRecord) throw new Error(`No token stored for integration ${integrationId}`);
    const blob = encryptToken(newToken, this.masterKey);
    const rotatedAt = new Date();
    await saveTokenRecord({
      ...tokenRecord,
      ...blobToTokenFields(blob),
      lastRotatedAt: rotatedAt.toISOString(),
    });
    await updateIntegrationRecord(integrationId, {}).catch(() => {});
    return { success: true, rotatedAt };
  }

  /**
   * Refresh a GitHub App token. The full JWT-minting flow is out of scope for the
   * data layer; this returns the stored secret and is the seam where a JWT signer
   * would be added. Throws if the integration isn't a GitHub App.
   */
  async refreshGitHubAppToken(integrationId: string): Promise<string> {
    const integration = getIntegrationRecord(integrationId);
    if (!integration) throw new Error(`Integration ${integrationId} not found`);
    if (integration.authType !== "GITHUB_APP") {
      throw new Error(`Integration ${integrationId} is not a GitHub App`);
    }
    return this.getToken(integrationId);
  }

  /** Revoke: disable the integration so getToken throws thereafter. */
  async revokeToken(integrationId: string): Promise<void> {
    const integration = getIntegrationRecord(integrationId);
    if (!integration) return;
    await updateIntegrationRecord(integrationId, { enabled: false });
  }

  /** Permanently delete an integration + cascade its token/repo records. */
  async deleteIntegration(integrationId: string): Promise<void> {
    await deleteIntegrationRecord(integrationId);
  }

  /** List active integrations for a user (no secrets in the result). */
  async listIntegrations(userId: string): Promise<IntegrationSummary[]> {
    return listIntegrationsForUser(userId).map((r) => ({
      id: r.id,
      displayName: r.displayName,
      authType: r.authType,
      githubServerUrl: r.githubServerUrl,
      enabled: r.enabled,
      lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt) : undefined,
    }));
  }
}

/** Shared default vault (reads the master key from the env). */
export const tokenVault = new TokenVault();

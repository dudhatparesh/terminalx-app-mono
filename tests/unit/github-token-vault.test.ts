import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { TokenVault } from "@/lib/github/token-vault";
import {
  getIntegrationRecord,
  getTokenRecord,
  listIntegrationsForUser,
  saveRepositoryRecord,
  listRepositoryRecords,
} from "@/lib/github/store";

// A deterministic 32-byte base64 master key for the AES-256-GCM vault (§1.4).
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

describe("github token vault + JSON-file store", () => {
  let tmpDir: string;
  let originalCwd: string;
  let vault: TokenVault;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-gh-vault-"));
    process.chdir(tmpDir);
    vault = new TokenVault(MASTER_KEY);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores a PAT encrypted at rest (plaintext never hits disk)", async () => {
    const id = await vault.storeToken(
      "user-1",
      { token: "ghp_supersecret_value", scopes: ["repo"] },
      { displayName: "GitHub (Personal)", githubServerUrl: "https://github.com" }
    );
    expect(typeof id).toBe("string");

    const tokenRec = getTokenRecord(id);
    expect(tokenRec).toBeDefined();
    expect(tokenRec!.tokenCiphertext).not.toContain("ghp_supersecret_value");
    expect(tokenRec!.tokenType).toBe("bearer");
    expect(tokenRec!.patScopes).toEqual(["repo"]);

    // The raw file on disk must not contain the plaintext token anywhere.
    const tokensRaw = fs.readFileSync(path.join(tmpDir, "data", "github-tokens.json"), "utf-8");
    expect(tokensRaw).not.toContain("ghp_supersecret_value");
  });

  it("round-trips the token through getToken (decrypts correctly)", async () => {
    const id = await vault.storeToken(
      "user-1",
      { token: "ghp_round_trip" },
      { displayName: "GitHub", githubServerUrl: "https://github.com" }
    );
    expect(await vault.getToken(id)).toBe("ghp_round_trip");
  });

  it("fails to decrypt with the wrong master key (GCM tag mismatch)", async () => {
    const id = await vault.storeToken(
      "user-1",
      { token: "ghp_tamper" },
      { displayName: "GitHub", githubServerUrl: "https://github.com" }
    );
    const otherVault = new TokenVault(Buffer.alloc(32, 9).toString("base64"));
    await expect(otherVault.getToken(id)).rejects.toThrow();
  });

  it("enforces (userId, serverUrl, authType) uniqueness in code", async () => {
    await vault.storeToken(
      "user-1",
      { token: "ghp_a" },
      { displayName: "GitHub", githubServerUrl: "https://github.com" }
    );
    await expect(
      vault.storeToken(
        "user-1",
        { token: "ghp_b" },
        { displayName: "GitHub dup", githubServerUrl: "https://github.com" }
      )
    ).rejects.toThrow(/already exists/i);
  });

  it("revokeToken disables the integration so getToken throws", async () => {
    const id = await vault.storeToken(
      "user-1",
      { token: "ghp_revoke" },
      { displayName: "GitHub", githubServerUrl: "https://github.com" }
    );
    expect(await vault.validateToken(id)).toBe(true);
    await vault.revokeToken(id);
    expect(getIntegrationRecord(id)!.enabled).toBe(false);
    expect(await vault.validateToken(id)).toBe(false);
    await expect(vault.getToken(id)).rejects.toThrow(/disabled|revoked/i);
  });

  it("rotatePATToken replaces the stored secret", async () => {
    const id = await vault.storeToken(
      "user-1",
      { token: "ghp_old" },
      { displayName: "GitHub", githubServerUrl: "https://github.com" }
    );
    const res = await vault.rotatePATToken(id, "ghp_new");
    expect(res.success).toBe(true);
    expect(await vault.getToken(id)).toBe("ghp_new");
  });

  it("lists integrations for a user without leaking secrets", async () => {
    await vault.storeToken(
      "user-1",
      { token: "ghp_1" },
      { displayName: "Personal", githubServerUrl: "https://github.com" }
    );
    await vault.storeToken(
      "user-1",
      { token: "ghp_2" },
      { displayName: "Enterprise", githubServerUrl: "https://ghe.example.com" }
    );
    await vault.storeToken(
      "user-2",
      { token: "ghp_other" },
      { displayName: "Other", githubServerUrl: "https://github.com" }
    );

    const list = await vault.listIntegrations("user-1");
    expect(list).toHaveLength(2);
    for (const item of list) {
      expect(item).not.toHaveProperty("token");
      expect(JSON.stringify(item)).not.toContain("ghp_");
    }
    expect(listIntegrationsForUser("user-2")).toHaveLength(1);
  });

  it("deleteIntegration cascades to token + repository records (§6.2)", async () => {
    const id = await vault.storeToken(
      "user-1",
      { token: "ghp_cascade" },
      { displayName: "GitHub", githubServerUrl: "https://github.com" }
    );
    await saveRepositoryRecord({
      id: "repo-1",
      integrationId: id,
      owner: "acme",
      name: "widgets",
      fullName: "acme/widgets",
      defaultBranch: "main",
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(listRepositoryRecords(id)).toHaveLength(1);

    await vault.deleteIntegration(id);
    expect(getIntegrationRecord(id)).toBeUndefined();
    expect(getTokenRecord(id)).toBeUndefined();
    expect(listRepositoryRecords(id)).toHaveLength(0);
  });
});

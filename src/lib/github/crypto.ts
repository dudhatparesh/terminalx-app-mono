// §1.4 Token encryption at rest.
// AES-256-GCM with a 12-byte nonce; key derived via PBKDF2(masterKey, salt, 100k, 32).
// Uses Node's built-in `crypto` (codebase convention: src/lib/auth.ts, git-worktree.ts).
import * as crypto from "crypto";

export const ENCRYPTION_ALGORITHM = "aes-256-gcm";
export const KEY_DERIVATION_ITERATIONS = 100000;
export const NONCE_LENGTH = 12;
export const TAG_LENGTH = 16;
export const SALT_LENGTH = 16;
export const MASTER_KEY_ENV = "TERMINALX_GITHUB_TOKEN_MASTER_KEY"; // 32 bytes (base64)

export interface EncryptedBlob {
  ciphertext: string; // base64
  nonce: string; // base64 (12-byte IV)
  salt: string; // base64 (PBKDF2 salt)
  tag: string; // base64 (16-byte GCM auth tag)
}

/**
 * Resolve the 32-byte master key from `masterKey` or the env var.
 * Accepts base64 (preferred) or a raw 32-char string. Throws CONFIGURATION-style
 * errors so the caller can surface "integration not configured".
 */
export function resolveMasterKey(masterKey?: string): Buffer {
  const raw = masterKey ?? process.env[MASTER_KEY_ENV];
  if (!raw) {
    throw new Error(
      `GitHub token encryption key missing: set ${MASTER_KEY_ENV} (32 bytes, base64).`
    );
  }
  // Try base64 first.
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    key = Buffer.from(raw, "utf-8");
  }
  if (key.length !== 32) {
    // Fall back to interpreting as raw utf-8 if base64 decode produced the wrong size.
    const asUtf8 = Buffer.from(raw, "utf-8");
    if (asUtf8.length === 32) return asUtf8;
    throw new Error(
      `GitHub token encryption key must decode to 32 bytes (got ${key.length}); set ${MASTER_KEY_ENV} to a base64-encoded 32-byte key.`
    );
  }
  return key;
}

function deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(masterKey, salt, KEY_DERIVATION_ITERATIONS, 32, "sha256");
}

/** Encrypt `plaintext` with a fresh salt + nonce; returns base64 blob fields. */
export function encryptToken(plaintext: string, masterKey?: string): EncryptedBlob {
  const key = resolveMasterKey(masterKey);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const nonce = crypto.randomBytes(NONCE_LENGTH);
  const derived = deriveKey(key, salt);

  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, derived, nonce, {
    authTagLength: TAG_LENGTH,
  });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    salt: salt.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/** Decrypt a blob produced by encryptToken. Throws if tampered (GCM tag mismatch). */
export function decryptToken(blob: EncryptedBlob, masterKey?: string): string {
  const key = resolveMasterKey(masterKey);
  const salt = Buffer.from(blob.salt, "base64");
  const nonce = Buffer.from(blob.nonce, "base64");
  const tag = Buffer.from(blob.tag, "base64");
  const ciphertext = Buffer.from(blob.ciphertext, "base64");
  const derived = deriveKey(key, salt);

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, derived, nonce, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf-8");
}

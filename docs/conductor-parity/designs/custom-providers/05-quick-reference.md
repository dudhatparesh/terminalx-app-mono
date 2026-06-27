# TerminalX Provider System - Quick Reference

## AIProvider Interface (7 Methods)

```typescript
interface AIProvider {
  // Configuration (immutable)
  id: string;                              // "claude", "codex", "opencode"
  label: string;                           // "Claude 3.5 Sonnet"
  type: string;                            // "claude", "local", etc.
  authType: "none" | "api-key" | "oauth" | "device-flow" | string;
  available: boolean;                      // Is CLI installed?
  unavailableReason?: string;              // Why not available
  isConfigured: boolean;                   // Credentials set?
  metadata?: Record<string, unknown>;      // Custom metadata

  // Runtime methods
  invokeCommand(options?: {
    dangerouslySkipPermissions?: boolean;
    cwd?: string;
    envOverrides?: Record<string, string>;
  }): string | null;                      // Return: bash command to run

  validateInstallation(): string | null;  // Return: null if OK, else error

  getEnvSetupCommands(): string[];        // Return: bash commands to set up env

  async validateCredentials(): Promise<void>;  // Throw if invalid

  getAuthHelpText(): string;              // Return: user-friendly setup guide
}
```

## Provider Registry API

```typescript
// Get all providers
const providers = providerRegistry.list();

// Get specific provider
const provider = providerRegistry.get("claude");

// Get ready-to-use providers
const ready = providerRegistry.getConfigured();

// Get default provider
const defaultProv = providerRegistry.getDefault();

// Register new provider
providerRegistry.register(new MyProvider());

// Refresh availability (async)
await providerRegistry.refreshAvailability();
```

## Creating a Provider: Template

```typescript
import { AIProvider } from "./types";
import { execSync } from "child_process";

export class MyProvider implements AIProvider {
  // CONFIG
  id = "myprovider";
  label = "My AI Provider";
  type = "myprovider";
  authType = "api-key";
  available = false;
  unavailableReason = "";
  isConfigured = false;
  metadata = {};

  constructor() {
    this.updateAvailability();
  }

  private updateAvailability() {
    try {
      execSync("which my-cli", { stdio: "ignore" });
      this.available = true;
      this.unavailableReason = undefined;
      // Check if configured
      this.isConfigured = this.hasConfig();
    } catch {
      this.available = false;
      this.unavailableReason = "my-cli not installed";
    }
  }

  // RUNTIME
  invokeCommand(): string | null {
    if (!this.available || !this.isConfigured) return null;
    const cmd = "my-cli";
    return `bash -lc '${cmd}; ec=$?; echo "[exited $ec]"; exec bash -l'`;
  }

  validateInstallation(): string | null {
    return this.unavailableReason || null;
  }

  getEnvSetupCommands(): string[] {
    return []; // Or: ["export API_KEY=..."]
  }

  async validateCredentials(): Promise<void> {
    if (!this.isConfigured) throw new Error("Not configured");
    // Test API key, OAuth token, etc.
  }

  getAuthHelpText(): string {
    return "Setup instructions...";
  }

  // OPTIONAL
  async configure(config: any): Promise<void> {
    // Save config to file
    // Update this.isConfigured
  }

  private hasConfig(): boolean {
    // Check if credentials exist
    return true; // or false
  }
}
```

## Registering a Provider

```typescript
// src/lib/providers/index.ts

import { providerRegistry } from "./registry";
import { ClaudeProvider } from "./claude";
import { CodexProvider } from "./codex";
import { MyProvider } from "./myprovider";

export function initializeProviders() {
  providerRegistry.register(new ClaudeProvider());
  providerRegistry.register(new CodexProvider());
  providerRegistry.register(new MyProvider());
}

export { providerRegistry } from "./registry";
export type { AIProvider } from "./types";
```

## Bootstrap at Startup

```typescript
// server/index.ts

import { initializeProviders } from "../src/lib/providers";

loadDotEnv();
initializeProviders(); // Add this line
applyGlobalOptions();
// ... rest of startup
```

## Session Creation API

```typescript
// POST /api/sessions
{
  name: "my-session",
  providerId: "claude",           // NEW: use provider ID
  kind: "claude",                 // OLD: still works (backward compat)
  dangerouslySkipPermissions: false
}

// Server validates:
// 1. Provider exists
// 2. Provider.available = true
// 3. Provider.isConfigured = true
// 4. provider.validateCredentials() doesn't throw

// Then executes:
const command = provider.invokeCommand({
  dangerouslySkipPermissions: true
});
```

## Provider Configuration API

```typescript
// GET /api/providers
// Returns: all providers with status

// GET /api/providers/:id
// Returns: specific provider details + help text

// POST /api/providers/:id/configure
// Body: provider-specific config
// {
//   apiKey: "sk-...",
//   model: "gpt-4"
// }
// Calls: provider.configure(config)
// Then: provider.validateCredentials()
```

## SessionMeta Extension

```typescript
interface SessionMeta {
  name: string;
  kind: SessionKind; // Still here (backward compat)
  createdAt: string;

  // NEW
  providerConfig?: {
    providerId: string; // "claude", "codex", etc.
    config: {
      id: string;
      label: string;
      type: string;
      authType: string;
      metadata?: Record<string, unknown>;
    };
    reason?: string; // Why this provider was chosen
  };
}
```

## Credential Storage

```typescript
// Store credential
import { saveCredential } from "@/lib/providers/credentials";
await saveCredential("opencode", "api-key", apiKeyValue);

// Retrieve credential
import { getCredentials } from "@/lib/providers/credentials";
const creds = getCredentials();
const apiKey = creds["opencode"]?.value;

// Check if exists
import { hasCredential } from "@/lib/providers/credentials";
if (hasCredential("opencode")) {
  /* ... */
}

// Delete credential
import { deleteCredential } from "@/lib/providers/credentials";
await deleteCredential("opencode");
```

## Availability States

```typescript
// Available + Configured = Ready to use
{
  available: true,
  unavailableReason: undefined,
  isConfigured: true
}
// ✅ Show in session creator

// Available + Not Configured = Needs setup
{
  available: true,
  unavailableReason: undefined,
  isConfigured: false
}
// ⚠️  Show in settings with "Configure" button

// Not Available + Any Config = Install needed
{
  available: false,
  unavailableReason: "CLI not found. Install: npm install -g...",
  isConfigured: false
}
// ❌ Show unavailable reason, skip in creator
```

## Environment Variable Injection

```typescript
// In provider class
getEnvSetupCommands(): string[] {
  const apiKey = process.env.OPENAI_API_KEY || this.getStoredKey();
  if (!apiKey) return [];
  return [`export OPENAI_API_KEY="${apiKey}"`];
}

// In invokeCommand()
invokeCommand(): string | null {
  const envCmds = this.getEnvSetupCommands();
  const invocation = "codex";
  const fullCmd = envCmds.length > 0
    ? `${envCmds.join(" && ")} && ${invocation}`
    : invocation;
  return `bash -lc '${fullCmd}; exec bash -l'`;
}
```

## Error Messages

```typescript
// Installation missing
return "Claude CLI not found. Install from: https://github.com/anthropic-ai/anthropic-cli";

// Credentials missing
throw new Error("API key not configured. Visit: https://platform.openai.com/api-keys");

// Auth invalid
throw new Error("Invalid OpenAI API key. Check at: https://platform.openai.com");

// Network error
throw new Error("Cannot reach auth server. Check network connection.");
```

## Testing Checklist

```typescript
describe("MyProvider", () => {
  it("implements required interface", () => {
    const p = new MyProvider();
    expect(p.id).toBeDefined();
    expect(p.invokeCommand).toBeDefined();
  });

  it("detects installation", () => {
    const error = p.validateInstallation();
    expect(typeof error).toBe("string" | null);
  });

  it("wraps invocation safely", () => {
    const cmd = p.invokeCommand();
    expect(cmd).toContain("exec bash"); // CRITICAL!
  });

  it("validates credentials", async () => {
    await expect(p.validateCredentials()).resolves.not.toThrow();
  });

  it("provides help text", () => {
    const help = p.getAuthHelpText();
    expect(help).toContain("setup");
  });
});
```

## UI Component Template

```typescript
// src/components/settings/MyProviderAuthUI.tsx

"use client";

import { useState } from "react";
import type { AIProvider } from "@/lib/providers/types";

export function MyProviderAuthUI({
  provider,
  onConfigured,
}: {
  provider: AIProvider;
  onConfigured?: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/providers/${provider.id}/configure`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey }),
        }
      );
      if (!res.ok) throw new Error("Failed");
      onConfigured?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="API Key"
        className="w-full px-3 py-2 border rounded"
      />
      {error && <div className="text-red-400">{error}</div>}
      <button
        onClick={handleSave}
        disabled={loading}
        className="px-3 py-2 bg-blue-600"
      >
        {loading ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
```

## File Structure

```
src/lib/providers/
├── types.ts               # AIProvider interface
├── registry.ts            # ProviderRegistry class
├── credentials.ts         # Credential storage
├── index.ts               # initializeProviders()
├── claude.ts              # ClaudeProvider
├── codex.ts               # CodexProvider
└── myprovider.ts          # Your provider

src/app/api/providers/
├── route.ts               # GET/POST /api/providers
└── [id]/
    ├── route.ts           # GET /api/providers/:id
    └── configure/
        └── route.ts       # POST /api/providers/:id/configure

src/components/settings/
├── ProviderSettingsPanel.tsx
└── MyProviderAuthUI.tsx
```

## Backward Compatibility

```typescript
// OLD CODE (still works)
type SessionKind = "bash" | "claude" | "codex";
const kind: SessionKind = "claude";

// NEW CODE (preferred)
type SessionKind = "bash" | string;
const providerId = "claude";
const provider = providerRegistry.get(providerId);
```

## Common Pitfalls

### ❌ BAD: Session exits if provider fails

```typescript
invokeCommand(): string {
  return "my-cli --interactive";  // Dies if not installed!
}
```

### ✅ GOOD: Fallback to bash

```typescript
invokeCommand(): string {
  return `bash -lc 'my-cli --interactive; ec=$?; \
    echo "[exited $ec]"; exec bash -l'`;
}
```

### ❌ BAD: Secret in logs

```typescript
console.log("API Key:", apiKey); // LEAKS SECRET!
```

### ✅ GOOD: Never log secrets

```typescript
console.log("Credentials saved"); // Don't mention secret
```

### ❌ BAD: Synchronous network call

```typescript
validateInstallation(): string | null {
  fetch("https://api.example.com/status");  // HANGS!
}
```

### ✅ GOOD: Async validation

```typescript
async validateCredentials(): Promise<void> {
  const res = await fetch("https://api.example.com/status");
  if (!res.ok) throw new Error("API unreachable");
}
```

## Performance Tips

```typescript
// Cache availability check (don't re-run every time)
private cachedAvailable: boolean | null = null;
private lastCheckTime: number = 0;
private CHECK_INTERVAL_MS = 60000;

private updateAvailability() {
  const now = Date.now();
  if (this.cachedAvailable !== null && now - this.lastCheckTime < CHECK_INTERVAL_MS) {
    return;  // Use cached result
  }
  // Run expensive check...
}

// Use timeout on network calls
await fetch(url, { timeout: 5000 });

// Parallel provider checks
await Promise.all(
  providerRegistry.list().map(p => p.validateCredentials())
);
```

## Documentation Links

- **[PROVIDERS.md](./PROVIDERS.md)** — Index & overview
- **[PROVIDER_DESIGN_SUMMARY.md](./PROVIDER_DESIGN_SUMMARY.md)** — Architecture
- **[PROVIDER_SPEC.md](./PROVIDER_SPEC.md)** — Complete spec
- **[PROVIDER_IMPLEMENTATION.md](./PROVIDER_IMPLEMENTATION.md)** — Step-by-step
- **[PROVIDER_API_REFERENCE.md](./PROVIDER_API_REFERENCE.md)** — API docs

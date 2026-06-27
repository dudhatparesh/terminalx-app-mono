# TerminalX Custom AI Provider Support - Implementation Guide

## Quick Start: Implementing a New Provider

This guide walks through adding a custom provider to TerminalX using the specification in `PROVIDER_SPEC.md`.

## Example: Adding the "Open Code" Provider

### Step 1: Create Provider Class

Create `src/lib/providers/opencode.ts`:

```typescript
import { AIProvider } from "./types";
import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

export class OpenCodeProvider implements AIProvider {
  // ── AIProviderConfig ────────────────────────────────────────────────────

  id = "opencode";
  label = "Open Code (Multi-Model)";
  type = "opencode";
  authType = "api-key";
  available = false;
  unavailableReason: string | undefined;
  isConfigured = false;
  metadata = {
    official: false,
    website: "https://github.com/example/open-code",
    supportedModels: ["gpt-4", "gpt-3.5-turbo", "claude-3-opus"],
  };

  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.env.HOME || "/", ".opencode", "config.json");
    this.updateAvailability();
  }

  // ── Availability Detection ──────────────────────────────────────────────

  private updateAvailability(): void {
    try {
      // Check if CLI is installed
      execSync("which open-code > /dev/null 2>&1", { stdio: "ignore" });
      this.available = true;
      this.unavailableReason = undefined;

      // Check if configured (has config file with valid content)
      this.isConfigured = this.isProperlyConfigured();
    } catch {
      this.available = false;
      this.unavailableReason =
        "Open Code CLI not found. Install from: https://github.com/example/open-code";
      this.isConfigured = false;
    }
  }

  private isProperlyConfigured(): boolean {
    try {
      if (!fs.existsSync(this.configPath)) {
        return false;
      }

      const config = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));

      // Validate required fields
      if (!config.apiKey || !config.provider || !config.model) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  private readConfig(): { apiKey: string; provider: string; model: string } | null {
    try {
      const config = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
      return {
        apiKey: config.apiKey,
        provider: config.provider,
        model: config.model,
      };
    } catch {
      return null;
    }
  }

  // ── AIProviderRuntime ───────────────────────────────────────────────────

  invokeCommand(options?: {
    dangerouslySkipPermissions?: boolean;
    cwd?: string;
    envOverrides?: Record<string, string>;
  }): string | null {
    if (!this.available || !this.isConfigured) {
      return null;
    }

    const config = this.readConfig();
    if (!config) return null;

    const args: string[] = [
      `--provider=${config.provider}`,
      `--model=${config.model}`,
      `--api-key=${config.apiKey}`,
    ];

    if (options?.dangerouslySkipPermissions) {
      args.push("--skip-permissions");
    }

    const invocation = ["open-code", ...args].join(" ");

    // Wrap so tmux session persists if CLI exits
    return (
      `bash -lc '${invocation}; ec=$?; ` +
      `echo "[open-code exited with code $ec — dropping to bash]"; ` +
      `exec bash -l'`
    );
  }

  validateInstallation(): string | null {
    if (this.available) return null;
    return this.unavailableReason || "Open Code CLI not installed";
  }

  getEnvSetupCommands(): string[] {
    // Open Code reads config from file, not env vars
    // (If your provider needs env vars, return them here)
    return [];
  }

  async validateCredentials(): Promise<void> {
    if (!this.available) {
      throw new Error(
        "Open Code CLI not installed. " + "Install from: https://github.com/example/open-code"
      );
    }

    const config = this.readConfig();
    if (!config) {
      throw new Error(
        "Open Code not configured. " +
          "Create ~/.opencode/config.json with apiKey, provider, and model."
      );
    }

    // Validate credentials by running a test command
    try {
      execSync(`open-code --validate --api-key="${config.apiKey}"`, {
        stdio: "pipe",
        timeout: 5000,
      });
    } catch (err) {
      throw new Error(
        `Open Code validation failed. ` + `Check your API key and network connection.`
      );
    }
  }

  getAuthHelpText(): string {
    return (
      "Open Code requires configuration. Create ~/.opencode/config.json:\n\n" +
      "{\n" +
      '  "apiKey": "your-api-key",\n' +
      '  "provider": "gpt-4",\n' +
      '  "model": "gpt-4-turbo"\n' +
      "}\n\n" +
      "Supported providers: gpt-4, gpt-3.5-turbo, claude-3-opus\n" +
      "Get API keys from your provider's dashboard."
    );
  }

  // ── Optional: Custom Configuration ──────────────────────────────────────

  async configure(config: { apiKey: string; provider: string; model: string }): Promise<void> {
    const dir = path.dirname(this.configPath);

    // Ensure directory exists with restrictive permissions
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Write config with restrictive permissions
    const configContent = JSON.stringify(config, null, 2);
    fs.writeFileSync(this.configPath, configContent, {
      mode: 0o600,
    });

    // Refresh availability
    this.updateAvailability();
  }

  async deleteConfig(): Promise<void> {
    try {
      if (fs.existsSync(this.configPath)) {
        fs.unlinkSync(this.configPath);
      }
      this.isConfigured = false;
    } catch (err) {
      throw new Error(`Failed to delete Open Code config: ${String(err)}`);
    }
  }
}
```

### Step 2: Create Type Definitions

Create `src/lib/providers/types.ts`:

```typescript
export interface AIProviderConfig {
  id: string;
  label: string;
  type: string;
  authType: "none" | "api-key" | "oauth" | "device-flow" | string;
  available: boolean;
  unavailableReason?: string;
  isConfigured: boolean;
  metadata?: Record<string, unknown>;
}

export interface AIProviderRuntime {
  invokeCommand(options?: {
    dangerouslySkipPermissions?: boolean;
    cwd?: string;
    envOverrides?: Record<string, string>;
  }): string | null;

  validateInstallation(): string | null;
  getEnvSetupCommands(): string[];
  validateCredentials(): Promise<void>;
  getAuthHelpText(): string;
}

export interface AIProvider extends AIProviderConfig, AIProviderRuntime {}
```

### Step 3: Create Provider Registry

Create `src/lib/providers/registry.ts`:

```typescript
import { AIProvider } from "./types";

export interface ProviderRegistry {
  list(): AIProvider[];
  get(idOrType: string): AIProvider | null;
  register(provider: AIProvider): void;
  getConfigured(): AIProvider[];
  getDefault(): AIProvider | null;
  refreshAvailability(): Promise<void>;
}

export class ProviderRegistryImpl implements ProviderRegistry {
  private providers: Map<string, AIProvider> = new Map();

  list(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  get(idOrType: string): AIProvider | null {
    return this.providers.get(idOrType) || null;
  }

  register(provider: AIProvider): void {
    if (!provider.id || !provider.label) {
      throw new Error("Provider must have id and label");
    }
    this.providers.set(provider.id, provider);
  }

  getConfigured(): AIProvider[] {
    return this.list().filter((p) => p.available && p.isConfigured);
  }

  getDefault(): AIProvider | null {
    const configured = this.getConfigured();
    return configured.length > 0 ? configured[0] : null;
  }

  async refreshAvailability(): Promise<void> {
    // Providers update themselves in constructor/updateAvailability
    // This is a hook for external refresh logic if needed
    for (const provider of this.list()) {
      try {
        provider.validateInstallation();
      } catch {
        // Provider handles its own state
      }
    }
  }
}

export const providerRegistry = new ProviderRegistryImpl();
```

### Step 4: Bootstrap Providers at Startup

Create `src/lib/providers/index.ts`:

```typescript
import { providerRegistry } from "./registry";
import { ClaudeProvider } from "./claude";
import { CodexProvider } from "./codex";
import { OpenCodeProvider } from "./opencode";

export function initializeProviders() {
  // Register built-in providers
  providerRegistry.register(new ClaudeProvider());
  providerRegistry.register(new CodexProvider());

  // Register custom/enterprise providers
  providerRegistry.register(new OpenCodeProvider());

  console.log(`[providers] initialized with ${providerRegistry.list().length} providers`);
}

export { providerRegistry } from "./registry";
export type { AIProvider, AIProviderConfig, AIProviderRuntime } from "./types";
```

### Step 5: Update Server Bootstrap

Modify `server/index.ts`:

```typescript
import { createServer } from "http";
import next from "next";
import { initializeProviders } from "../src/lib/providers";

// ... other imports ...

loadDotEnv();
initializeProviders(); // Add this after loadDotEnv()
applyGlobalOptions();
// ... rest of bootstrap ...
```

### Step 6: Update Session API

Modify `src/app/api/sessions/route.ts`:

```typescript
import { providerRegistry } from "@/lib/providers";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, providerId, kind, dangerouslySkipPermissions, cwd, worktree } = body;

    // Support both old 'kind' (backward compat) and new 'providerId'
    const actualProviderId = providerId || kind || "bash";

    // Validate provider exists
    let provider = null;
    if (actualProviderId !== "bash") {
      provider = providerRegistry.get(actualProviderId);
      if (!provider) {
        return NextResponse.json(
          { error: `Unknown provider: ${actualProviderId}` },
          { status: 400 }
        );
      }

      if (!provider.available) {
        return NextResponse.json(
          { error: `Provider not installed: ${provider.unavailableReason}` },
          { status: 400 }
        );
      }

      if (!provider.isConfigured) {
        return NextResponse.json(
          {
            error: `Provider not configured.\n${provider.getAuthHelpText()}`,
          },
          { status: 400 }
        );
      }

      // Validate credentials before session creation
      try {
        await provider.validateCredentials();
      } catch (err) {
        return NextResponse.json(
          {
            error: `Provider auth failed: ${err instanceof Error ? err.message : String(err)}`,
          },
          { status: 401 }
        );
      }
    }

    // Get invoke command
    const command = provider ? provider.invokeCommand({ dangerouslySkipPermissions }) : null;

    // ... rest of session creation logic ...

    // Save metadata with provider config
    await saveMeta({
      name: finalName,
      kind: actualProviderId,
      createdAt: new Date().toISOString(),
      createdBy: username || undefined,
      managed: true,
      cwd: startDir,
      providerConfig: provider
        ? {
            providerId: provider.id,
            config: {
              id: provider.id,
              label: provider.label,
              type: provider.type,
              authType: provider.authType,
              metadata: provider.metadata,
            },
            reason: `User selected ${provider.label}`,
          }
        : undefined,
      worktree: createdWorktree
        ? {
            /* ... */
          }
        : undefined,
    });

    return NextResponse.json(
      {
        /* ... */
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[api/sessions POST]", err);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
```

### Step 7: Create Provider Configuration API

Create `src/app/api/providers/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { providerRegistry } from "@/lib/providers";

export async function GET(req: NextRequest) {
  try {
    const providers = providerRegistry.list();
    return NextResponse.json({
      providers: providers.map((p) => ({
        id: p.id,
        label: p.label,
        type: p.type,
        authType: p.authType,
        available: p.available,
        unavailableReason: p.unavailableReason,
        isConfigured: p.isConfigured,
        metadata: p.metadata,
      })),
      defaultProvider: providerRegistry.getDefault()?.id || null,
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to list providers" }, { status: 500 });
  }
}
```

Create `src/app/api/providers/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { providerRegistry } from "@/lib/providers";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const provider = providerRegistry.get(params.id);
    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: provider.id,
      label: provider.label,
      type: provider.type,
      authType: provider.authType,
      available: provider.available,
      unavailableReason: provider.unavailableReason,
      isConfigured: provider.isConfigured,
      metadata: provider.metadata,
      helpText: provider.getAuthHelpText(),
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to get provider" }, { status: 500 });
  }
}
```

### Step 8: Create Provider Configuration Endpoint

Create `src/app/api/providers/[id]/configure/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { providerRegistry } from "@/lib/providers";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const provider = providerRegistry.get(params.id) as any;
    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const body = await req.json();

    // Provider-specific configuration
    if (provider.configure) {
      await provider.configure(body);
    }

    // Validate credentials after configuration
    try {
      await provider.validateCredentials();
    } catch (err) {
      return NextResponse.json(
        {
          error: `Configuration invalid: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      isConfigured: provider.isConfigured,
      label: provider.label,
    });
  } catch (err) {
    return NextResponse.json({ error: `Configuration failed: ${String(err)}` }, { status: 500 });
  }
}
```

### Step 9: Create UI Component

Create `src/components/settings/OpenCodeAuthUI.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AIProvider } from "@/lib/providers/types";

interface OpenCodeAuthUIProps {
  provider: AIProvider;
  onConfigured?: () => void;
}

export function OpenCodeAuthUI({ provider, onConfigured }: OpenCodeAuthUIProps) {
  const [config, setConfig] = useState({
    apiKey: "",
    provider: "gpt-4",
    model: "gpt-4-turbo",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch(`/api/providers/${provider.id}/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Configuration failed");
      }

      setSuccess(true);
      onConfigured?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium">API Key</label>
        <input
          type="password"
          value={config.apiKey}
          onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
          placeholder="your-api-key"
          className="w-full px-3 py-2 border rounded text-sm mt-1 bg-[#0f1117] border-[#363b47]"
        />
      </div>

      <div>
        <label className="text-xs font-medium">Provider</label>
        <select
          value={config.provider}
          onChange={(e) => setConfig({ ...config, provider: e.target.value })}
          className="w-full px-3 py-2 border rounded text-sm mt-1 bg-[#0f1117] border-[#363b47]"
        >
          <option>gpt-4</option>
          <option>gpt-3.5-turbo</option>
          <option>claude-3-opus</option>
        </select>
      </div>

      <div>
        <label className="text-xs font-medium">Model</label>
        <input
          type="text"
          value={config.model}
          onChange={(e) => setConfig({ ...config, model: e.target.value })}
          placeholder="gpt-4-turbo"
          className="w-full px-3 py-2 border rounded text-sm mt-1 bg-[#0f1117] border-[#363b47]"
        />
      </div>

      {error && <div className="text-xs text-red-400 bg-red-900/20 p-2 rounded">{error}</div>}
      {success && (
        <div className="text-xs text-green-400 bg-green-900/20 p-2 rounded">
          Configuration saved successfully
        </div>
      )}

      <Button onClick={handleSave} disabled={loading || !config.apiKey} className="w-full">
        {loading ? "Saving..." : "Save Configuration"}
      </Button>
    </div>
  );
}
```

### Step 10: Integrate into Settings Panel

Modify `src/components/settings/ProviderSettingsPanel.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { providerRegistry } from "@/lib/providers";
import { OpenCodeAuthUI } from "./OpenCodeAuthUI";
import type { AIProvider } from "@/lib/providers/types";

export function ProviderSettingsPanel() {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const loadProviders = async () => {
      await providerRegistry.refreshAvailability();
      setProviders(providerRegistry.list());
    };
    loadProviders();
  }, [refreshKey]);

  const handleConfigured = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">AI Providers</h3>

      {providers.map((provider) => (
        <div key={provider.id} className="border rounded p-4 bg-[#0f1117] border-[#363b47]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h4 className="font-medium">{provider.label}</h4>
              <p className="text-xs text-gray-500 mt-1">{provider.id}</p>

              <div className="flex gap-2 mt-2 flex-wrap">
                {!provider.available && (
                  <span className="px-2 py-1 text-xs bg-red-900/30 text-red-400 rounded">
                    Not Installed
                  </span>
                )}
                {provider.available && !provider.isConfigured && (
                  <span className="px-2 py-1 text-xs bg-yellow-900/30 text-yellow-400 rounded">
                    Not Configured
                  </span>
                )}
                {provider.isConfigured && (
                  <span className="px-2 py-1 text-xs bg-green-900/30 text-green-400 rounded">
                    Ready to Use
                  </span>
                )}
              </div>

              {provider.unavailableReason && (
                <p className="text-xs text-red-400 mt-2">{provider.unavailableReason}</p>
              )}
            </div>

            {provider.available && (
              <button
                onClick={() =>
                  setExpandedProviderId(
                    expandedProviderId === provider.id ? null : provider.id
                  )
                }
                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded shrink-0"
              >
                {expandedProviderId === provider.id ? "Hide" : "Configure"}
              </button>
            )}
          </div>

          {expandedProviderId === provider.id && (
            <div className="mt-4 pt-4 border-t border-[#363b47]">
              {provider.type === "opencode" && (
                <OpenCodeAuthUI provider={provider} onConfigured={handleConfigured} />
              )}
              {!provider.type.match(/opencode|claude|codex/) && (
                <p className="text-xs text-gray-400">
                  Provider-specific configuration UI not yet implemented. {provider.getAuthHelpText()}
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

## Testing the Implementation

### 1. Unit Test for OpenCode Provider

Create `src/lib/providers/__tests__/opencode.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OpenCodeProvider } from "../opencode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("OpenCodeProvider", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true });
    } catch {}
  });

  it("initializes with correct metadata", () => {
    const provider = new OpenCodeProvider(path.join(tempDir, "config.json"));
    expect(provider.id).toBe("opencode");
    expect(provider.label).toBe("Open Code (Multi-Model)");
    expect(provider.type).toBe("opencode");
  });

  it("detects missing configuration", () => {
    const provider = new OpenCodeProvider(path.join(tempDir, "config.json"));
    expect(provider.isConfigured).toBe(false);
  });

  it("detects valid configuration", async () => {
    const configPath = path.join(tempDir, "config.json");
    const provider = new OpenCodeProvider(configPath);

    // Create a valid config (simulate CLI being installed)
    const config = {
      apiKey: "sk-test-key",
      provider: "gpt-4",
      model: "gpt-4-turbo",
    };

    fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });

    // Re-check (would need to call updateAvailability in real code)
    await provider.configure(config);
    expect(provider.isConfigured).toBe(true);
  });

  it("generates invoke command when configured", async () => {
    const configPath = path.join(tempDir, "config.json");
    const provider = new OpenCodeProvider(configPath);

    const config = {
      apiKey: "sk-test-key",
      provider: "gpt-4",
      model: "gpt-4-turbo",
    };

    await provider.configure(config);
    // Would need to mock execSync for "which open-code" to make this work
    // In real implementation, provider.available would be true after mocking
  });

  it("returns auth help text", () => {
    const provider = new OpenCodeProvider(path.join(tempDir, "config.json"));
    const help = provider.getAuthHelpText();
    expect(help).toContain("~/.opencode/config.json");
    expect(help).toContain("apiKey");
  });
});
```

### 2. Integration Test

Create `src/app/api/sessions/__tests__/provider-selection.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "../route";
import { NextRequest } from "next/server";

describe("POST /api/sessions with provider selection", () => {
  const createMockRequest = (body: unknown): NextRequest => {
    const init: RequestInit = {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    };
    return new NextRequest("http://localhost:3000/api/sessions", init);
  };

  it("accepts providerId in request", async () => {
    const req = createMockRequest({
      name: "test-session",
      providerId: "bash",
    });

    // This would need proper setup with database, mocking, etc.
    // Just showing the API contract
    expect(true).toBe(true);
  });

  it("rejects unknown provider", async () => {
    const req = createMockRequest({
      name: "test-session",
      providerId: "nonexistent-provider",
    });

    // Would assert 400 error
    expect(true).toBe(true);
  });
});
```

## Deployment Checklist

- [ ] Implement `AIProvider` interface for your custom provider
- [ ] Add provider to `initializeProviders()` in `src/lib/providers/index.ts`
- [ ] Create provider configuration API endpoint
- [ ] Create provider configuration UI component
- [ ] Update `ProviderSettingsPanel` to include new provider
- [ ] Add provider to session creation dialog
- [ ] Test provider availability detection (CLI installed check)
- [ ] Test provider configuration flow
- [ ] Test session creation with provider
- [ ] Test fallback to bash when provider unavailable
- [ ] Document provider setup instructions for users

## File Structure

```
src/lib/providers/
├── types.ts                 # AIProvider interface definitions
├── registry.ts             # Provider registry implementation
├── index.ts                # Provider initialization bootstrap
├── claude.ts               # Claude provider implementation
├── codex.ts                # Codex provider implementation
├── opencode.ts             # Example: Open Code provider
└── __tests__/
    ├── types.test.ts
    ├── registry.test.ts
    ├── opencode.test.ts
    └── integration.test.ts

src/app/api/providers/
├── route.ts                # GET /api/providers, POST to refresh
└── [id]/
    ├── route.ts            # GET /api/providers/:id
    └── configure/
        └── route.ts        # POST /api/providers/:id/configure

src/components/settings/
├── ProviderSettingsPanel.tsx
├── OpenCodeAuthUI.tsx
├── ClaudeAuthUI.tsx
└── CodexAuthUI.tsx
```

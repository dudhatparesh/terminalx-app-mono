# TerminalX AI Provider API Reference

## AIProvider Interface

All custom AI providers must implement the `AIProvider` interface. This document provides detailed API reference, best practices, and common patterns.

## Core Interface Definition

````typescript
export interface AIProviderConfig {
  // ── Immutable Metadata ──────────────────────────────────────────────────

  /**
   * Unique identifier for this provider instance.
   * Used in API calls, session metadata, and storage keys.
   *
   * Examples: "claude", "codex", "opencode", "local-ollama"
   * Format: [a-z0-9_-]+ (lowercase, alphanumeric, hyphen, underscore)
   *
   * @invariant Always equal to constructor or class constant
   * @invariant Immutable after registration
   */
  readonly id: string;

  /**
   * Display name for UI presentation.
   * User-friendly label shown in dropdowns and settings.
   *
   * Examples:
   *   "Claude 3.5 Sonnet"
   *   "GPT-4 (OpenAI)"
   *   "Ollama Local (Mistral)"
   *
   * @invariant Human-readable, max 64 characters recommended
   */
  readonly label: string;

  /**
   * Type/category of provider for UI grouping and feature detection.
   * Can be same as id (e.g., type: "claude", id: "claude-3.5") or different
   * (e.g., type: "local", id: "ollama-mistral").
   *
   * Built-in types: "claude", "codex"
   * Custom types: "opencode", "local", "enterprise", etc.
   *
   * @invariant Used for conditional UI rendering and capability detection
   */
  readonly type: string;

  // ── Authentication ──────────────────────────────────────────────────────

  /**
   * Type of authentication method required.
   *
   * - "none": No credentials required (e.g., free local CLI)
   * - "api-key": Static API key (e.g., OpenAI, Anthropic)
   * - "oauth": OAuth 2.0 flow required
   * - "device-flow": Device code flow (e.g., Claude CLI)
   * - Custom: Your own auth type string (e.g., "custom-jwt")
   *
   * Affects UI flow:
   *   - "none" → No setup needed
   *   - "api-key" → Show password input field
   *   - "oauth" → Show "Login" button
   *   - "device-flow" → Show "Authenticate" button
   */
  readonly authType: "none" | "api-key" | "oauth" | "device-flow" | string;

  // ── Runtime Status ──────────────────────────────────────────────────────

  /**
   * Whether provider CLI/service is installed and accessible.
   *
   * For CLI providers:
   *   - Set true if `which <cli>` succeeds
   *   - Set false if CLI not found in PATH
   *
   * For remote providers:
   *   - Set true if network accessible (or defer to validateCredentials)
   *   - Set false if service URL unreachable
   *
   * @mutable Can change between calls (e.g., after user installs CLI)
   * @default false (assume not available until proven otherwise)
   */
  available: boolean;

  /**
   * Reason provider is unavailable (null if available).
   * User-friendly error message explaining how to fix issue.
   *
   * Examples:
   *   "Claude CLI not found. Install from: https://github.com/anthropic-ai/anthropic-cli"
   *   "Open Code CLI requires Python 3.8+. Current version: 3.6"
   *   "Codex service unreachable. Check network connection."
   *
   * @invariant Only set when available = false
   * @invariant Include actionable remediation advice
   */
  unavailableReason?: string;

  /**
   * Whether user has configured credentials for this provider.
   *
   * For "none" auth: Set true if available
   * For "api-key": Set true if API key stored
   * For "oauth": Set true if access token stored and not expired
   * For "device-flow": Set true if user has completed device flow
   *
   * @mutable Changes after saveCredential() or deleteCredential()
   * @invariant Can only be true if available = true
   */
  isConfigured: boolean;

  /**
   * Custom provider metadata (arbitrary JSON).
   * Use for version info, model capabilities, pricing, etc.
   *
   * @example
   * metadata: {
   *   official: true,
   *   latestModel: "claude-3-5-sonnet",
   *   rateLimit: "100 req/min",
   *   pricing: { inputToken: 0.003, outputToken: 0.015 },
   *   supportedModels: ["gpt-4", "gpt-3.5-turbo"],
   *   configurable: true
   * }
   */
  readonly metadata?: Record<string, unknown>;
}

export interface AIProviderRuntime {
  /**
   * Generate shell command to invoke this provider.
   *
   * The returned command is executed in a tmux session.
   * Provider is responsible for wrapping the invocation to keep
   * the tmux session alive even if the CLI exits (e.g., not installed).
   *
   * @param options - Execution options
   * @param options.dangerouslySkipPermissions - Skip permission prompts (for CLI providers)
   * @param options.cwd - Working directory to start in
   * @param options.envOverrides - Additional environment variables
   *
   * @returns Shell command string, or null if provider cannot be invoked
   *
   * @example Claude
   * ```
   * return `bash -lc 'claude --dangerously-skip-permissions; ec=$?; \
   *   echo "[claude exited with code $ec]"; exec bash -l'`;
   * ```
   *
   * @example OpenAI Codex with env var
   * ```
   * const cmd = 'OPENAI_API_KEY=$apiKey codex';
   * return `bash -lc '${cmd}; ec=$?; echo "[codex exited]"; exec bash -l'`;
   * ```
   *
   * @note IMPORTANT: Wrap with fallback to bash!
   * Users must be able to interact with shell even if provider fails.
   * Do NOT return a command that exits the session.
   *
   * @note If envOverrides provided, integrate them into command:
   * ```typescript
   * const env = (options?.envOverrides || [])
   *   .map(([k, v]) => `export ${k}="${v}"`)
   *   .join(" && ");
   * const fullCmd = env ? `${env} && <provider-command>` : "<provider-command>";
   * ```
   */
  invokeCommand(options?: {
    dangerouslySkipPermissions?: boolean;
    cwd?: string;
    envOverrides?: Record<string, string>;
  }): string | null;

  /**
   * Validate that provider CLI/service is installed and working.
   *
   * Called at startup and when user tries to use provider.
   * Return null if installation is valid, or error message.
   *
   * @returns null if valid, or error string explaining how to fix
   *
   * @example CLI provider
   * ```typescript
   * try {
   *   execSync("which open-code", { stdio: "ignore" });
   *   return null; // Valid
   * } catch {
   *   return "Open Code CLI not found. Install: npm install -g open-code";
   * }
   * ```
   *
   * @example Version check
   * ```typescript
   * try {
   *   const version = execSync("claude --version", { encoding: "utf-8" });
   *   const [major] = version.split(".").map(Number);
   *   if (major < 2) return "Claude CLI v2+ required. Run: brew upgrade claude";
   *   return null;
   * } catch {
   *   return "Claude CLI not found...";
   * }
   * ```
   */
  validateInstallation(): string | null;

  /**
   * Get bash commands to inject into session environment.
   * Called before invoking provider command.
   *
   * Use for:
   * - Exporting API keys as env vars
   * - Setting up proxy settings
   * - Configuring locale/PATH
   * - Loading shell functions
   *
   * @returns Array of bash commands (each without newlines)
   *
   * @example Export API key
   * ```typescript
   * return [
   *   `export OPENAI_API_KEY="${this.readApiKey()}"`,
   *   `export OPENAI_ORG_ID="org-123"`
   * ];
   * ```
   *
   * @example Complex setup
   * ```typescript
   * return [
   *   `export PROVIDER_API_KEY="${this.getApiKey()}"`,
   *   `export PROVIDER_TIMEOUT="30"`,
   *   `export LOG_LEVEL="debug"`
   * ];
   * ```
   *
   * @note Commands are executed in sequence before provider invocation
   * @note Secrets in commands are visible in shell history; mark them safe
   * @note Return [] for providers that don't need env setup (e.g., config-file based)
   */
  getEnvSetupCommands(): string[];

  /**
   * Validate that provider credentials are valid and usable.
   *
   * Called before session creation to fail fast if auth is broken.
   * Check API key validity, OAuth token expiration, network access, etc.
   *
   * @throws Error with user-friendly message if validation fails
   *
   * @example API key validation
   * ```typescript
   * const key = this.getStoredApiKey();
   * if (!key) throw new Error("API key not configured");
   *
   * try {
   *   const response = await fetch("https://api.example.com/validate", {
   *     headers: { "Authorization": `Bearer ${key}` }
   *   });
   *   if (!response.ok) throw new Error("Invalid API key");
   * } catch (err) {
   *   throw new Error(
   *     "Cannot reach authentication server. Check network connection."
   *   );
   * }
   * ```
   *
   * @example OAuth token refresh
   * ```typescript
   * const token = this.getStoredToken();
   * if (!token) throw new Error("Not authenticated. Run 'provider login'");
   *
   * if (this.isTokenExpired(token)) {
   *   try {
   *     const newToken = await this.refreshToken(token.refreshToken);
   *     await this.saveToken(newToken);
   *   } catch {
   *     throw new Error("Token refresh failed. Run 'provider login' again");
   *   }
   * }
   * ```
   */
  async validateCredentials(): Promise<void>;

  /**
   * Get human-readable help text for authentication setup.
   *
   * Returned when provider.isConfigured = false.
   * Guide user through credential acquisition and configuration.
   *
   * @returns Multi-line help text (can include code blocks)
   *
   * @example Claude device flow
   * ```
   * "Claude requires authentication. Run:\n" +
   * "  claude login\n" +
   * "Then paste the device code into your browser.\n\n" +
   * "Visit: https://github.com/anthropic-ai/anthropic-cli"
   * ```
   *
   * @example API key setup
   * ```
   * "Get your OpenAI API key:\n" +
   * "1. Visit https://platform.openai.com/api-keys\n" +
   * "2. Create or copy your API key\n" +
   * "3. Paste it in the settings panel above\n\n" +
   * "Pricing: $0.05 per 1K tokens"
   * ```
   *
   * @note Can include URLs, code examples, pricing info
   * @note Shown in UI when user clicks "Configure" on unconfigured provider
   */
  getAuthHelpText(): string;
}

export interface AIProvider extends AIProviderConfig, AIProviderRuntime {}
````

## Provider Registry API

````typescript
export interface ProviderRegistry {
  /**
   * Get all registered providers (available or not).
   *
   * @returns Array of all providers, in registration order
   *
   * @example
   * const providers = registry.list();
   * console.log(providers.map(p => p.label));
   * // Output: ["Claude", "Codex", "Open Code", "Ollama Local"]
   */
  list(): AIProvider[];

  /**
   * Get a single provider by ID or type.
   *
   * @param idOrType - Provider id or type string
   * @returns Provider instance, or null if not found
   *
   * @note Prefers exact id match over type match
   *
   * @example
   * const claude = registry.get("claude");
   * const opencode = registry.get("opencode");
   * const unknown = registry.get("nonexistent"); // null
   */
  get(idOrType: string): AIProvider | null;

  /**
   * Register a new provider.
   *
   * Adds provider to registry, making it available for session creation.
   * Can be called at startup or dynamically after app initialization.
   *
   * @param provider - Provider instance implementing AIProvider
   *
   * @throws Error if provider invalid (missing id, label, methods)
   *
   * @example At startup
   * ```typescript
   * const registry = providerRegistry;
   * registry.register(new ClaudeProvider());
   * registry.register(new CodexProvider());
   * registry.register(new OpenCodeProvider());
   * ```
   *
   * @example Dynamic registration
   * ```typescript
   * const customProvider = new MyCustomProvider();
   * registry.register(customProvider);
   * // Now appears in UI automatically
   * ```
   *
   * @note Overwrites existing provider with same id (with warning)
   * @note Safe to call multiple times with same provider
   */
  register(provider: AIProvider): void;

  /**
   * Get providers that are both available and configured.
   *
   * Use this for populating session creation UI.
   * Filters out unavailable providers (CLI not installed, etc.)
   * and unconfigured providers (user hasn't set up credentials).
   *
   * @returns Array of ready-to-use providers
   *
   * @example
   * const ready = registry.getConfigured();
   * // Only show these in session creation dropdown
   * // ready = [Claude (available + configured), ...]
   * // not in ready = [Codex (CLI not installed), OpenCode (no API key)]
   */
  getConfigured(): AIProvider[];

  /**
   * Get the default provider to auto-select.
   *
   * Returns first configured provider, or null if none available.
   * Use to pre-select provider in session creation dialog.
   *
   * @returns Default provider instance, or null if none ready
   *
   * @example
   * const defaultProvider = registry.getDefault();
   * if (defaultProvider) {
   *   sessionForm.setProvider(defaultProvider.id);
   * } else {
   *   sessionForm.showNeedToConfigureMessage();
   * }
   */
  getDefault(): AIProvider | null;

  /**
   * Refresh availability status of all providers.
   *
   * Poll all providers to check if CLIs are installed, services reachable, etc.
   * Called at startup and periodically to detect installation changes.
   *
   * @returns Promise that resolves when all providers checked
   *
   * @example
   * ```typescript
   * // On app startup
   * await registry.refreshAvailability();
   * const available = registry.getConfigured();
   * ```
   *
   * @example
   * ```typescript
   * // After user installs a provider
   * await registry.refreshAvailability();
   * // UI re-renders with new provider available
   * ```
   *
   * @note Can be called safely multiple times
   * @note Typically takes 100-500ms (network + file checks)
   * @note Can be awaited at startup or run in background
   */
  async refreshAvailability(): Promise<void>;
}
````

## Common Patterns & Best Practices

### 1. Session Wrapping (Critical!)

Always wrap provider invocation to keep tmux alive:

```typescript
// BAD: Session exits if provider not found or crashes
invokeCommand(): string {
  return "open-code --interactive";
}

// GOOD: Session survives provider failure, drops to bash
invokeCommand(): string {
  const invocation = "open-code --interactive";
  return (
    `bash -lc '${invocation}; ec=$?; ` +
    `echo "[open-code exited with code $ec]"; ` +
    `exec bash -l'`
  );
}
```

### 2. Credential Storage

Store credentials in secure file with restricted permissions:

```typescript
// Store with mode 0600 (read/write owner only)
fs.writeFileSync(configPath, JSON.stringify(config), {
  mode: 0o600,
  encoding: "utf-8",
});

// OR use shared credentials storage
import { saveCredential } from "@/lib/providers/credentials";
await saveCredential(this.id, "api-key", apiKey);
```

### 3. Environment Variable Injection

For providers that read from env vars:

```typescript
getEnvSetupCommands(): string[] {
  const apiKey = process.env.OPENAI_API_KEY || this.getStoredApiKey();
  if (!apiKey) return [];

  // Escape quotes in secret
  const escaped = apiKey.replace(/"/g, '\\"');
  return [`export OPENAI_API_KEY="${escaped}"`];
}

invokeCommand(): string | null {
  const cmd = "codex";
  const setup = this.getEnvSetupCommands();
  const fullCmd = setup.length > 0
    ? `${setup.join(" && ")} && ${cmd}`
    : cmd;

  return `bash -lc '${fullCmd}; ec=$?; exec bash -l'`;
}
```

### 4. Health Checks

Implement quick validation without network calls:

```typescript
validateInstallation(): string | null {
  try {
    // Quick check: is CLI in PATH?
    execSync("which open-code", { stdio: "ignore" });

    // Optional: Check version compatibility
    const version = execSync("open-code --version", {
      encoding: "utf-8",
      timeout: 2000,
    });
    const major = parseInt(version.split(".")[0]);
    if (major < 2) {
      return "Open Code v2+ required. Upgrade with: npm install -g open-code";
    }

    return null; // All good
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return "Open Code CLI not found. Install: npm install -g open-code";
    }
    return `Installation check failed: ${String(err)}`;
  }
}
```

### 5. Async Credential Validation

Validate live credentials before session creation:

```typescript
async validateCredentials(): Promise<void> {
  if (!this.available) {
    throw new Error("Open Code CLI not installed");
  }

  const apiKey = this.getStoredApiKey();
  if (!apiKey) {
    throw new Error(
      "API key not configured. " +
      "Visit https://platform.openai.com/api-keys to get one."
    );
  }

  // Test API key by making a lightweight API call
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
      timeout: 5000,
    });

    if (response.status === 401) {
      throw new Error("Invalid API key");
    }

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("401")) {
      throw new Error("Invalid API key");
    }
    throw new Error(
      "Cannot validate credentials. Check network connection."
    );
  }
}
```

### 6. Metadata for UI Features

Provide metadata for rich UI:

```typescript
metadata = {
  // Branding
  official: true,
  website: "https://github.com/example/open-code",
  icon: "https://example.com/logo.png",

  // Capabilities
  latestModel: "gpt-4-turbo",
  supportedModels: ["gpt-4", "gpt-3.5-turbo", "claude-3"],

  // Configuration
  configurable: true,
  requiresNetworkAccess: true,

  // Pricing (optional)
  pricing: {
    currency: "USD",
    inputTokenCost: 0.005,
    outputTokenCost: 0.015,
  },

  // Limits
  rateLimit: "100 requests per minute",
  maxContextWindow: 128000,
};
```

## Error Handling Patterns

### Provider Not Installed

```typescript
// In UI
if (!provider.available) {
  return (
    <div className="bg-red-900/20 border border-red-700 p-4 rounded">
      <p className="font-medium">Setup Required</p>
      <p className="text-sm mt-2">{provider.unavailableReason}</p>
      <a href={installUrl} className="text-blue-400 underline mt-3 inline-block">
        Installation Instructions
      </a>
    </div>
  );
}
```

### Credentials Not Configured

```typescript
// In session creation
if (!provider.isConfigured) {
  return (
    <div className="bg-yellow-900/20 border border-yellow-700 p-4 rounded">
      <p className="font-medium">Configuration Required</p>
      <p className="text-sm mt-2 whitespace-pre-wrap">
        {provider.getAuthHelpText()}
      </p>
      <button onClick={() => navigate("/settings")}>
        Go to Settings
      </button>
    </div>
  );
}
```

### Credentials Invalid at Session Time

```typescript
// In session creation API
try {
  await provider.validateCredentials();
} catch (err) {
  return NextResponse.json(
    {
      error: String(err),
      providerHelpText: provider.getAuthHelpText(),
    },
    { status: 401 }
  );
}
```

## Testing Providers

### Mock Provider for Tests

```typescript
export class MockProvider implements AIProvider {
  id = "mock";
  label = "Mock Provider";
  type = "mock";
  authType = "none";
  available = true;
  unavailableReason = undefined;
  isConfigured = true;
  metadata = {};

  invokeCommand(): string | null {
    return "echo 'Mock provider executed'";
  }

  validateInstallation(): string | null {
    return null;
  }

  getEnvSetupCommands(): string[] {
    return [];
  }

  async validateCredentials(): Promise<void> {}

  getAuthHelpText(): string {
    return "No auth required for mock";
  }
}

// In tests
describe("Session creation with mock provider", () => {
  it("creates session with provider", () => {
    const provider = new MockProvider();
    const cmd = provider.invokeCommand();
    expect(cmd).toContain("Mock provider executed");
  });
});
```

### Testing Real Providers

```typescript
describe("OpenCodeProvider", () => {
  it("detects missing CLI", () => {
    // Mock execSync to throw "not found"
    jest.spyOn(childProcess, "execSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const provider = new OpenCodeProvider();
    expect(provider.available).toBe(false);
    expect(provider.unavailableReason).toContain("not found");
  });

  it("validates credentials", async () => {
    // Mock file system and network calls
    jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ apiKey: "test" }));
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 200 }));

    const provider = new OpenCodeProvider();
    await expect(provider.validateCredentials()).resolves.not.toThrow();
  });
});
```

## Migration Guide: From SessionKind to Providers

### Old Code

```typescript
type SessionKind = "bash" | "claude" | "codex";

createSession("my-session", "claude");
// Or with CLI_BINS
const command = commandForKind("claude", { dangerouslySkipPermissions: true });
```

### New Code

```typescript
type SessionKind = "bash" | string; // Still works!

// Option 1: Use providerId
const provider = providerRegistry.get("claude");
const command = provider?.invokeCommand({ dangerouslySkipPermissions: true });

// Option 2: Keep using commandForKind (deprecated but works)
const command = commandForKind("claude", { dangerouslySkipPermissions: true });

// Option 3: Custom provider
const opencode = providerRegistry.get("opencode");
if (opencode && opencode.isConfigured) {
  const command = opencode.invokeCommand();
}
```

## Troubleshooting

### Provider Not Appearing in UI

1. Check provider is registered: `registry.list()` should include it
2. Check availability: `provider.available` must be true
3. Verify import: `initializeProviders()` called at startup
4. Check console for registration errors

### Session Exits Immediately

1. Check `invokeCommand()` wrapping (must have `exec bash -l` fallback)
2. Verify provider is installed: `validateInstallation()`
3. Check credentials: `validateCredentials()`
4. Look at tmux session logs: `tmux capture-pane -p`

### Credentials Not Saved

1. Verify `getEnvSetupCommands()` is not losing secrets
2. Check file permissions: `ls -la ~/.opencode/config.json` should be `0600`
3. Ensure atomic writes (tmp + rename pattern)
4. Check provider `isConfigured` is set correctly after save

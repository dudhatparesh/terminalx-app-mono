# TerminalX Custom AI Provider Support - Design Summary

## Overview

This design enables TerminalX to support multiple AI code execution providers (Claude, Codex, Open Code, etc.) through a pluggable architecture. The system is backward-compatible with the current `SessionKind` approach while providing a more extensible path forward.

## Key Design Decisions

### 1. Interface-Driven Architecture

- **Decision**: Define `AIProvider` interface with 7 core methods
- **Rationale**: Clear contract allows any provider to be added without core changes
- **Benefit**: Vendors can implement providers independently (internal/external)

### 2. Dual-Layer Config & Runtime

- **Decision**: Split into `AIProviderConfig` (metadata) and `AIProviderRuntime` (actions)
- **Rationale**: Some providers only need config (discovery), others need both
- **Benefit**: Supports lazy-loading providers, mock providers for testing

### 3. Session Wrapping (Always)

- **Decision**: All `invokeCommand()` must wrap with bash fallback
- **Rationale**: Prevent tmux session exit when provider unavailable
- **Benefit**: Users always have shell access to debug; graceful degradation

### 4. Credential Isolation

- **Decision**: Store credentials in `data/provider-credentials/` (0600)
- **Rationale**: Each provider controls its own credential format
- **Benefit**: No leakage between providers; custom auth flows supported

### 5. Availability Detection Phases

- **Phase 1 (Constructor)**: Quick check - is CLI installed? (sync)
- **Phase 2 (Before Session)**: Validate auth - are credentials valid? (async)
- **Phase 3 (Session Start)**: Runtime - is provider working? (sync shell check)
- **Rationale**: Fail early for better UX; don't block startup
- **Benefit**: Fast startup, detailed error messages at action time

### 6. Registry Pattern

- **Decision**: Central `ProviderRegistry` manages all providers
- **Rationale**: Single source of truth; enables provider discovery
- **Benefit**: UI can ask registry for "all available", "all configured", "default"

### 7. Backward Compatibility

- **Decision**: Keep `SessionKind` type, map "claude"/"codex" strings to providers
- **Rationale**: Existing sessions, API calls, storage formats still work
- **Benefit**: Zero migration cost for existing code

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    TerminalX Application                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ UI Layer (React)                                         │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ • CreateSessionDialog                                    │   │
│  │ • ProviderSettingsPanel                                 │   │
│  │ • DashboardView                                          │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                                 │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │ API Layer (Next.js Routes)                              │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ • POST /api/sessions (create session)                   │   │
│  │ • GET/POST /api/providers (list/refresh)                │   │
│  │ • POST /api/providers/:id/configure (save credentials)  │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                                 │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │ Provider Registry (In-Memory)                            │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ • list() → all providers                                 │   │
│  │ • get(id) → specific provider                            │   │
│  │ • getConfigured() → ready-to-use providers              │   │
│  │ • register() → add new provider                          │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                                 │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │ Provider Implementations                                 │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ • ClaudeProvider (src/lib/providers/claude.ts)          │   │
│  │ • CodexProvider (src/lib/providers/codex.ts)            │   │
│  │ • OpenCodeProvider (src/lib/providers/opencode.ts)      │   │
│  │ • CustomProvider (user-defined)                          │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                                 │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │ Core Implementations                                     │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ • Session Creation (src/app/api/sessions/route.ts)      │   │
│  │ • CLI Wrapper (invokeCommand())                          │   │
│  │ • Env Setup (getEnvSetupCommands())                      │   │
│  │ • Credentials (src/lib/providers/credentials.ts)        │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                                 │
│  ┌──────────────▼───────────────────────────────────────────┐   │
│  │ Persistent Storage                                       │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ • data/ai-sessions.json (SessionMeta with providerConfig)   │   │
│  │ • data/provider-credentials/ (encrypted/restricted)     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ External Systems                                         │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ • CLI Executables (claude, codex, open-code, etc.)      │   │
│  │ • Remote APIs (OpenAI, Anthropic, custom)               │   │
│  │ • tmux Sessions (server/index.ts PTY management)        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Examples

### Creating a Session with Open Code Provider

```
1. User clicks "New Session" button
   ↓
2. Dialog renders provider selector (calls GET /api/providers)
   ├─ Registry returns all providers
   ├─ UI shows only getConfigured() providers
   └─ User selects "Open Code"
   ↓
3. User clicks "Create"
   ↓
4. POST /api/sessions { providerId: "opencode", name: "my-session" }
   ↓
5. Server-side validation:
   ├─ Get provider from registry
   ├─ Check provider.available = true
   ├─ Check provider.isConfigured = true
   ├─ Call provider.validateCredentials() (async)
   └─ Get provider.invokeCommand()
   ↓
6. Create tmux session with command from provider
   ├─ Set up env: provider.getEnvSetupCommands()
   ├─ Inject command: provider.invokeCommand()
   └─ Execute: "bash -lc 'export ... && open-code; exec bash -l'"
   ↓
7. Save SessionMeta with providerConfig:
   {
     name: "my-session",
     kind: "opencode",
     providerConfig: {
       providerId: "opencode",
       config: { id, label, type, authType, metadata }
     }
   }
   ↓
8. Return session to UI, user clicks to attach
   ↓
9. WebSocket connects to /ws/terminal/my-session
   ↓
10. User interacts with open-code CLI in tmux
```

### Configuring Credentials for Open Code

```
1. User navigates to Settings → Providers
   ↓
2. GET /api/providers returns all providers with metadata
   ↓
3. UI shows OpenCodeProvider with status "Not Configured"
   ↓
4. User clicks "Configure" → expands OpenCodeAuthUI
   ├─ Shows form for apiKey, provider, model
   └─ User fills in values
   ↓
5. User clicks "Save Configuration"
   ↓
6. POST /api/providers/opencode/configure
   { apiKey: "...", provider: "gpt-4", model: "gpt-4-turbo" }
   ↓
7. Server calls provider.configure(config)
   ├─ Writes to ~/.opencode/config.json (mode 0600)
   └─ Updates provider.isConfigured = true
   ↓
8. Server calls provider.validateCredentials()
   ├─ Reads config file
   ├─ Makes test API call
   └─ Throws if invalid
   ↓
9. Return { success: true, isConfigured: true }
   ↓
10. UI shows "Ready to Use" status
    ↓
11. OpenCode now appears in provider selector for new sessions
```

### Handling Provider Not Installed

```
User installs a provider CLI:
  $ npm install -g open-code

Next time they load TerminalX:
1. Server bootstrap calls initializeProviders()
   ├─ Creates OpenCodeProvider instance
   └─ Constructor runs validateInstallation()
   ↓
2. validateInstallation() runs "which open-code"
   ├─ Returns null (found!) → provider.available = true
   └─ provider.unavailableReason = undefined
   ↓
3. UI calls GET /api/providers
   ├─ Returns OpenCodeProvider with available: true
   └─ UI can show "Not Configured" instead of "Not Installed"
   ↓
4. User clicks "Configure" on OpenCode
   ├─ Shows OpenCodeAuthUI form
   └─ User can now set up API key
```

## File Structure

```
src/lib/providers/
├── types.ts                  # AIProvider, AIProviderConfig, AIProviderRuntime
├── registry.ts              # ProviderRegistry implementation
├── credentials.ts           # Credential storage/retrieval
├── guards.ts               # Type guards (isAIProvider, etc.)
├── index.ts                # initializeProviders() bootstrap
├── claude.ts               # ClaudeProvider implementation
├── codex.ts                # CodexProvider implementation
├── opencode.ts             # OpenCodeProvider example
└── __tests__/
    ├── types.test.ts
    ├── registry.test.ts
    ├── claude.test.ts
    ├── opencode.test.ts
    └── integration.test.ts

src/app/api/providers/
├── route.ts                # GET /api/providers, POST to refresh
└── [id]/
    ├── route.ts            # GET /api/providers/:id
    └── configure/
        └── route.ts        # POST /api/providers/:id/configure

src/components/settings/
├── ProviderSettingsPanel.tsx          # Main provider settings UI
├── ProviderAuthUI.tsx                 # Generic auth UI
├── ClaudeAuthUI.tsx                   # Claude-specific setup
├── CodexAuthUI.tsx                    # Codex-specific setup
└── OpenCodeAuthUI.tsx                 # Open Code-specific setup

src/lib/
├── ai-sessions.ts          # Updated: SessionMeta.providerConfig
└── (existing files)

server/
└── index.ts               # Updated: call initializeProviders()
```

## Migration Path

### Phase 1: Current State (Pre-Implementation)

- Only "bash", "claude", "codex" supported
- Hard-coded in `CLI_BINS` dict
- `commandForKind()` returns command
- No UI for provider selection

### Phase 2: Introduction of Providers (This Spec)

- `AIProvider` interface defined
- Built-in providers (Claude, Codex) implement interface
- Registry manages all providers
- Session API accepts `providerId` (backward-compatible)
- UI shows provider selector

### Phase 3: Deprecation (Future)

- `commandForKind()` marked deprecated
- All code migrated to use registry
- `CLI_BINS` dict removed

### Phase 4: Removal (Future)

- `SessionKind` type removed (now just `string`)
- Direct CLI invocation no longer supported

## Security Considerations

### Credential Storage

- Credentials stored in `data/provider-credentials/credentials.json`
- File permissions: mode 0600 (owner read/write only)
- No encryption in base spec (can be added)
- Never logged or printed

### Secret Handling

- Secrets in `getEnvSetupCommands()` are visible in shell history
- Providers can mark secrets as "safe for env var"
- Alternative: pass via stdin/file descriptor

### Permission Model

- Session owner can see and use their own provider config
- Multi-user mode: scoped session names enforce isolation
- Admin can manage provider registry

### Validation

- Credentials validated before session start (fail fast)
- Installation validation happens at startup (quick)
- Network calls use timeouts (prevent hangs)

## Future Extensions

### 1. Custom Credential Types

```typescript
// Beyond "api-key", "oauth", "device-flow"
authType: "jwt" | "certificate" | "websocket-token" | ...
```

### 2. Provider Capabilities

```typescript
metadata: {
  capabilities: {
    terminal: true,
    vscode: true,
    jupyter: false,
    streaming: true
  }
}
```

### 3. Dynamic Provider Loading

```typescript
// Load providers from plugins directory
const plugins = await loadProvidersFromDirectory("~/.terminalsrc.d/providers");
plugins.forEach((p) => registry.register(p));
```

### 4. Provider Chaining

```typescript
// Use Provider A's output as input to Provider B
const chainedProvider = new ChainedProvider(providerA, providerB);
```

### 5. Cost Tracking

```typescript
// Track API calls and costs per provider/user
const cost = session.providerConfig.metadata?.costPerToken * tokens;
```

### 6. Provider Health Checks

```typescript
// Monitor provider status, alert on degradation
const health = await provider.getHealthStatus();
if (health.uptime < 0.95) {
  alertUser();
}
```

## Testing Strategy

### Unit Tests

- Provider interface compliance
- Config validation
- Credential storage
- Registry operations

### Integration Tests

- Full session creation flow
- Provider configuration flow
- Multi-provider scenarios
- Backward compatibility with old SessionKind

### E2E Tests

- User creates session with each provider
- User configures provider credentials
- Session runs CLI from provider
- Fallback to bash when provider unavailable

## Documentation Deliverables

1. **PROVIDER_SPEC.md** (This Directory)
   - Complete specification of provider system
   - Interface definitions
   - Built-in & example providers
   - Config & credential storage
   - UI components design
   - API changes
   - Fallback behavior

2. **PROVIDER_IMPLEMENTATION.md** (This Directory)
   - Step-by-step implementation guide
   - Example: adding Open Code provider
   - Code templates
   - Testing patterns
   - Deployment checklist

3. **PROVIDER_API_REFERENCE.md** (This Directory)
   - Detailed API documentation
   - Every method signature & semantics
   - Best practices & patterns
   - Common pitfalls
   - Troubleshooting guide

4. **PROVIDER_DESIGN_SUMMARY.md** (This File)
   - Architecture overview
   - Design decisions rationale
   - Data flow examples
   - File structure
   - Security model
   - Future extensions

## Success Criteria

- [ ] Multiple providers can be registered and discovered
- [ ] Session creation works with different providers
- [ ] Credentials are stored securely
- [ ] UI shows provider selection and configuration
- [ ] Backward compatibility with existing SessionKind code
- [ ] Provider CLI failures don't kill tmux session
- [ ] Custom providers can be added without modifying core
- [ ] All provider methods have clear contracts (TypeScript)
- [ ] Security: credentials not logged or leaked
- [ ] Performance: provider availability check < 100ms

## Summary

This design enables TerminalX to support arbitrary AI code execution providers through a clean, extensible interface. The provider registry pattern allows vendors to contribute providers independently. Built-in providers (Claude, Codex) serve as reference implementations. The system degrades gracefully when providers are unavailable, keeping users in the bash shell. Backward compatibility is maintained throughout.

The specification provides three implementation documents:

1. **PROVIDER_SPEC.md** — Complete specification
2. **PROVIDER_IMPLEMENTATION.md** — Step-by-step guide
3. **PROVIDER_API_REFERENCE.md** — Detailed API docs
4. **PROVIDER_DESIGN_SUMMARY.md** — This overview

Implementation can proceed incrementally:

- Start with just provider registry & Claude provider
- Add Codex provider
- Add Open Code provider as example
- Let users add custom providers

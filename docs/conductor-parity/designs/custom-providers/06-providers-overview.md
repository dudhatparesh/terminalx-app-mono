# TerminalX Custom AI Provider Support

## Documentation Index

This directory contains a comprehensive specification and implementation guide for adding custom AI provider support to TerminalX. The system enables support for Claude, Codex, Open Code, and any other AI code execution provider through a pluggable architecture.

### Quick Links

1. **[PROVIDER_DESIGN_SUMMARY.md](./PROVIDER_DESIGN_SUMMARY.md)** — START HERE
   - Executive summary of the design
   - Key design decisions and rationale
   - Architecture diagram
   - Data flow examples
   - File structure overview
   - ~19 KB | Read time: 15-20 min

2. **[PROVIDER_SPEC.md](./PROVIDER_SPEC.md)** — Complete Specification
   - Detailed specification of all components
   - Provider abstraction & interface
   - Built-in providers (Claude, Codex)
   - Example custom provider (Open Code)
   - Configuration & storage
   - UI component designs
   - API changes & endpoints
   - Migration strategy
   - Testing strategy
   - ~39 KB | Read time: 45-60 min

3. **[PROVIDER_IMPLEMENTATION.md](./PROVIDER_IMPLEMENTATION.md)** — Step-by-Step Guide
   - Detailed implementation walkthrough
   - Example: adding "Open Code" provider
   - 10 concrete implementation steps
   - Full code examples
   - Testing patterns
   - Deployment checklist
   - File structure reference
   - ~26 KB | Read time: 30-40 min

4. **[PROVIDER_API_REFERENCE.md](./PROVIDER_API_REFERENCE.md)** — API Documentation
   - Complete API reference
   - Every interface method documented
   - Best practices & patterns
   - Common patterns (session wrapping, creds, env setup)
   - Error handling strategies
   - Testing examples
   - Troubleshooting guide
   - Migration examples
   - ~22 KB | Read time: 30-40 min

## What Is This?

TerminalX currently supports AI code execution through hardcoded "claude" and "codex" SessionKind values. This design enables:

- **Pluggable Providers**: Any provider implementing the `AIProvider` interface
- **Built-in Support**: Claude and Codex out of the box
- **Easy Extension**: Add new providers (Open Code, Ollama, etc.) without modifying core
- **UI Integration**: Provider selector in session creation, settings panel for configuration
- **Secure Credentials**: Encrypted storage with proper permission isolation
- **Graceful Degradation**: If provider unavailable, user gets bash shell
- **Backward Compatible**: Old `SessionKind` code still works

## Use Cases

### For End Users

- Create sessions with different AI providers
- Switch between providers per session
- Store API keys/credentials securely
- Get clear setup instructions when provider not configured

### For Vendor/Admin

- Add custom enterprise provider (e.g., internal LLM)
- Support multiple models per provider
- Track usage and costs per provider
- Enforce provider policies (approved list)

### For Developer

- Implement new provider by creating `AIProvider` class
- No core TerminalX code changes needed
- Clear interface contract
- Full type safety with TypeScript
- Testing framework provided

## Core Concepts

### AIProvider Interface

Every provider must implement:

- **invokeCommand()** — Generate shell command to run provider
- **validateInstallation()** — Check if CLI/service installed
- **validateCredentials()** — Check if auth credentials valid
- **getEnvSetupCommands()** — Get env vars to inject
- **getAuthHelpText()** — User-friendly setup instructions

### Provider Registry

Central registry that:

- **list()** — Get all providers
- **get(id)** — Get specific provider
- **getConfigured()** — Get ready-to-use providers
- **register(provider)** — Add new provider
- **refreshAvailability()** — Poll all providers

### SessionMeta Extension

Sessions now store:

```typescript
providerConfig: {
  providerId: string;      // "claude", "codex", "opencode", etc.
  config: {
    id: string;
    label: string;
    type: string;
    authType: string;
    metadata?: object;
  };
}
```

### Credential Storage

Credentials stored in `data/provider-credentials/credentials.json` with:

- mode 0600 (owner read/write only)
- Provider-specific format
- Atomic writes to prevent corruption
- Optional encryption (not in base spec)

## Quick Start: Adding a Provider

### 1. Create Provider Class

```typescript
// src/lib/providers/myprovider.ts
export class MyProvider implements AIProvider {
  id = "myprovider";
  label = "My Custom Provider";

  invokeCommand(): string | null {
    return `bash -lc 'my-cli; ec=$?; exec bash -l'`;
  }

  // ... implement other methods
}
```

### 2. Register Provider

```typescript
// src/lib/providers/index.ts
import { MyProvider } from "./myProvider";

export function initializeProviders() {
  providerRegistry.register(new MyProvider());
}
```

### 3. Bootstrap at Startup

```typescript
// server/index.ts
import { initializeProviders } from "../src/lib/providers";

loadDotEnv();
initializeProviders(); // Add this line
```

That's it! Provider now appears in:

- Session creation dialog
- Provider settings panel
- Provider list API

## Architecture Overview

```
┌─ UI Layer ──────────────────────────────────┐
│ • CreateSessionDialog                       │
│ • ProviderSettingsPanel                     │
│ • DashboardView                             │
└─────────────────┬───────────────────────────┘
                  │
┌─ API Layer ─────▼───────────────────────────┐
│ • POST /api/sessions (create)               │
│ • GET /api/providers (list)                 │
│ • POST /api/providers/:id/configure (save)  │
└─────────────────┬───────────────────────────┘
                  │
┌─ Provider Registry ───▼──────────────────────┐
│ • list() / get() / register()                │
└─────────────────┬───────────────────────────┘
                  │
┌─ Provider Implementations ──▼────────────────┐
│ • ClaudeProvider                            │
│ • CodexProvider                             │
│ • OpenCodeProvider                          │
│ • YourCustomProvider                        │
└─────────────────┬───────────────────────────┘
                  │
┌─ Session / CLI Execution ──▼────────────────┐
│ • invokeCommand() → tmux session            │
│ • getEnvSetupCommands() → env injection     │
└─────────────────────────────────────────────┘
```

## Key Design Patterns

### 1. Session Wrapping (Critical!)

All providers must wrap invocation to keep tmux alive:

```typescript
// BAD: Session exits if provider fails
return "open-code --interactive";

// GOOD: Falls back to bash if provider fails
return `bash -lc 'open-code --interactive; ec=$?; \
  echo "[exited with code $ec]"; exec bash -l'`;
```

### 2. Availability Detection Phases

1. **Constructor**: Quick check (which CLI)
2. **Before Session**: Validate credentials (async)
3. **Session Start**: Runtime check (shell error)

### 3. Graceful Degradation

- Provider not installed? Show setup instructions
- Credentials invalid? User gets bash + error message
- Provider crashes? Automatic fallback to bash
- Network down? Session still works (offline mode)

## File Changes Summary

### New Files

- `src/lib/providers/types.ts` — Interface definitions
- `src/lib/providers/registry.ts` — Provider registry
- `src/lib/providers/index.ts` — Bootstrap
- `src/lib/providers/claude.ts` — Claude provider
- `src/lib/providers/codex.ts` — Codex provider
- `src/lib/providers/opencode.ts` — Example custom provider
- `src/app/api/providers/route.ts` — Provider listing API
- `src/components/settings/ProviderSettingsPanel.tsx` — Settings UI

### Modified Files

- `src/lib/ai-sessions.ts` — Add providerConfig to SessionMeta
- `src/app/api/sessions/route.ts` — Accept providerId, validate provider
- `src/hooks/useSessions.ts` — Update SessionKind type
- `server/index.ts` — Call initializeProviders()

## Security Model

### Credentials

- Stored in `data/provider-credentials/` (restricted)
- File permissions: 0600 (owner only)
- Validated before use
- Never logged or printed
- Atomic writes prevent partial saves

### Permissions

- Session owner can see/use their provider config
- Multi-user mode: sessions scoped by owner
- Admin can manage provider registry
- Validation happens before session start

### Validation

- Installation check at startup (quick)
- Credentials validated before session creation
- Network calls have timeouts
- Invalid credentials fail fast

## Backward Compatibility

The design maintains 100% backward compatibility:

```typescript
// Old code still works
createSession("my-session", "claude");

// New code is preferred
const provider = providerRegistry.get("claude");
createSession("my-session", provider);

// SessionKind type still accepts strings
type SessionKind = "bash" | string;
```

Existing sessions, API calls, and storage formats continue to work without modification.

## Testing Strategy

### Unit Tests

```typescript
describe("MyProvider", () => {
  it("implements AIProvider interface", () => {
    const provider = new MyProvider();
    expect(provider.invokeCommand).toBeDefined();
    expect(provider.validateInstallation).toBeDefined();
  });
});
```

### Integration Tests

- Session creation with provider
- Provider configuration flow
- Credential storage/retrieval
- Registry operations

### E2E Tests

- Full session lifecycle
- Provider switching
- Credential management
- Error scenarios

## Implementation Phases

### Phase 1: Foundation

- [ ] Define AIProvider interface
- [ ] Implement provider registry
- [ ] Create Claude and Codex providers
- [ ] Update session API to accept providerId

### Phase 2: UI

- [ ] Add provider selector to session creation
- [ ] Create provider settings panel
- [ ] Provider configuration UI
- [ ] Provider availability display

### Phase 3: Extensibility

- [ ] Example Open Code provider
- [ ] Custom provider documentation
- [ ] Plugin loading mechanism (optional)
- [ ] Provider marketplace (future)

### Phase 4: Polish

- [ ] Performance optimizations
- [ ] Comprehensive testing
- [ ] User documentation
- [ ] Admin guide

## Performance Considerations

### Startup Time

- Provider availability check: ~50-100ms total
- Registry initialization: <10ms
- Impact: No noticeable increase in app startup

### Session Creation

- Provider validation (credentials): ~100-500ms
- This happens before session starts (fail fast)
- Parallel validation across providers: possible optimization

### Memory

- Registry holds ~5-20 providers: <1MB
- Minimal memory overhead

## Future Extensions

1. **Plugin System**: Load providers from `~/.terminalsrc.d/providers/`
2. **Provider Chaining**: Combine multiple providers
3. **Cost Tracking**: Monitor API usage and costs
4. **Health Checks**: Monitor provider uptime/status
5. **Provider Store**: Curated list of verified providers
6. **Custom Capabilities**: Per-provider feature detection

## Getting Help

### Reading Order

1. Start with **PROVIDER_DESIGN_SUMMARY.md** (overview)
2. Read **PROVIDER_SPEC.md** for complete spec
3. Follow **PROVIDER_IMPLEMENTATION.md** step-by-step
4. Refer to **PROVIDER_API_REFERENCE.md** when implementing

### Common Scenarios

**Q: How do I add a new provider?**
A: Implement `AIProvider` interface, register in `initializeProviders()`. See PROVIDER_IMPLEMENTATION.md Step 1-2.

**Q: How do I store credentials securely?**
A: Use `saveCredential()` function. Stored in `data/provider-credentials/` with mode 0600. See PROVIDER_SPEC.md Section 3.1.

**Q: What happens if a provider CLI isn't installed?**
A: `available=false`, user sees "Install from:" message in settings. See PROVIDER_SPEC.md Section 7.

**Q: How do I handle API errors?**
A: Throw in `validateCredentials()` with user-friendly message. See PROVIDER_API_REFERENCE.md "Error Handling Patterns".

**Q: Can I support multiple auth types?**
A: Yes! Set `authType` to custom string (e.g., "custom-jwt"). Implement in `validateCredentials()`. See PROVIDER_API_REFERENCE.md.

## Summary

This specification enables TerminalX to support arbitrary AI code execution providers through a clean, extensible interface. It provides:

- ✅ **Interface Definition** — Clear contract for providers
- ✅ **Built-in Providers** — Claude, Codex reference implementations
- ✅ **Example Provider** — Open Code walkthrough
- ✅ **UI Components** — Provider selector, settings, configuration
- ✅ **API Endpoints** — Full REST API for provider management
- ✅ **Credential Storage** — Secure, isolated per-provider
- ✅ **Error Handling** — Graceful degradation, clear messages
- ✅ **Testing Framework** — Unit, integration, E2E patterns
- ✅ **Backward Compatibility** — Existing code continues to work
- ✅ **Security Model** — Isolated credentials, permission checks

The design is production-ready and supports immediate implementation.

## Documents

- [PROVIDER_DESIGN_SUMMARY.md](./PROVIDER_DESIGN_SUMMARY.md) — Architecture & design decisions
- [PROVIDER_SPEC.md](./PROVIDER_SPEC.md) — Complete specification
- [PROVIDER_IMPLEMENTATION.md](./PROVIDER_IMPLEMENTATION.md) — Implementation guide
- [PROVIDER_API_REFERENCE.md](./PROVIDER_API_REFERENCE.md) — API reference & best practices

Perfect! Now I have a comprehensive understanding. Let me create a detailed report:

## TerminalX Codebase Infrastructure Analysis

### Project Architecture Overview

**Type**: Next.js 16.2 + Node.js self-hosted terminal IDE  
**Main Files**:

- Custom Node.js server: `/server/index.ts` (657 lines)
- Session management: `/src/lib/ai-sessions.ts` (142 lines)
- Git operations: `/src/lib/git-worktree.ts` (178 lines)
- File service: `/src/lib/file-service.ts` (170+ lines)
- Auth system: `/src/lib/auth.ts` (270+ lines)

---

### 1. Git Operations Infrastructure

**Existing Capabilities** (`/src/lib/git-worktree.ts`):

- Git repository detection: `getGitDirectoryInfo(directory)` — validates repo, extracts root, branch, repo name
- Branch validation: `validateGitBranchName()` — enforces Git naming rules (alphanumeric, dots, slashes, underscores, hyphens only; max 200 chars)
- Worktree creation: `createGitWorktreeForSession(selectedDirectory, rawBranch)` — creates isolated git worktrees for sessions
- Worktree cleanup: `removeGitWorktree(worktreePath, repoRoot)` — best-effort cleanup
- Git subprocess execution: `git()` helper using `execFileSync()` with 5s timeout (20s for worktree operations)
- Session metadata tracking: `SessionMeta.worktree` stores `{repoRoot, path, branch}`

**Timeout Settings**: 5000ms standard, 20000ms for worktree operations  
**Max Buffer**: 4MB for normal git, 16MB for pane history  
**Error Handling**: `gitErrorMessage()` sanitizes stderr/stdout before throwing

**What's Missing for Diff Viewing**:

- No diff generation or parsing
- No staging/unstaging
- No commit creation
- No GitHub/GitLab/Bitbucket API integration
- No pull request creation endpoints

---

### 2. AI Session Handling

**Session Management** (`/src/lib/ai-sessions.ts`):

- Three session kinds: `SessionKind = "bash" | "claude" | "codex"`
- Session metadata persistence: JSON file at `/data/ai-sessions.json` with atomic writes using temp files
- Metadata structure:
  ```typescript
  {
    name: string;
    kind: SessionKind;
    createdAt: string;
    createdBy?: string;
    managed?: boolean;
    cwd?: string;
    worktree?: { repoRoot, path, branch };
  }
  ```
- Session adoption: `ensureManagedSession()` marks inherited tmux sessions
- Command generation: `commandForKind()` wraps CLI invocations (Claude, Codex) with fallback bash
- Permission flag support: `dangerouslySkipPermissions` option for claude CLI

**API Endpoint** (`/src/app/api/sessions/route.ts`):

- `GET /api/sessions` — lists all sessions with metadata, Telegram topics
- `POST /api/sessions` — creates session with optional worktree creation
- `DELETE /api/sessions` — kills session and cleans metadata
- Session scoping: Only non-admin users can see/manage their own sessions (via `scopedSessionName()`)

**Data Persistence**:

- Write lock with Promise queue to prevent concurrent file corruption
- Atomic writes using temp file + rename pattern

---

### 3. Worktree Creation

**Capabilities** (`/src/lib/git-worktree.ts` + `/src/app/api/sessions/route.ts`):

- **Creation Flow**:
  1. Validate directory is within Git repo root
  2. Validate branch name (Git rules + custom constraints)
  3. Check branch doesn't already exist
  4. Create git worktree with branch: `git worktree add -b <branch> <path>`
  5. Store in session metadata for session-scoped cleanup
  6. Return `CreatedGitWorktree` with `{repoRoot, worktreePath, startDir, branch}`

- **Worktree Storage**: `$TERMINALX_WORKTREES_ROOT/.terminalx-worktrees/` (configurable via env)
- **Naming**: `{repoName}-{sha1(repoRoot)}-{branch-slug}` for uniqueness
- **Safety**: Path traversal prevention via `resolveSafePath()`, symlink resolution, `.git`/`.ssh`/`.gnupg` blocking

---

### 4. File/Directory Management

**Capabilities** (`/src/lib/file-service.ts`):

- `listDirectory(path)` — returns `FileEntry[]` with name, type (file/dir/symlink), size, modified timestamp
- `readFile(path)` — reads up to 1MB with UTF-8 encoding
- `getFileInfo(path)` — returns detailed metadata including permissions, created, modified timestamps

**API Endpoint** (`/src/app/api/files/route.ts`):

- `GET /api/files?path=...&action=auto|list|read|info` — admin-only file browsing
- Auto-detection: directories → list, files → read
- Error sanitization to prevent path leaking

**File Watcher** (in `/server/index.ts`):

- Singleton `chokidar` instance watching `TERMINUS_ROOT`
- WebSocket broadcast of file events (add, change, unlink, addDir, unlinkDir)
- Configurable depth (5), ignores node_modules, .git, .next, dist, build, .ssh, .gnupg, .config/secrets

---

### 5. Session Scope & Authentication

**Infrastructure** (`/src/lib/session-scope.ts`, `/src/lib/auth.ts`, `/src/lib/auth-config.ts`):

**Auth Modes**:

- `none` — no authentication
- `password` — single password for all users
- `local` — per-user local accounts (JSON file)
- `google` — OAuth2 with allowlist

**JWT System**:

- Secret stored in `data/.terminalx-secret` (or `TERMINALX_JWT_SECRET` env)
- Token revocation: persistent list in `data/.revoked-tokens.json` with JTI + expiry
- Cookie-based: `terminalx-session` cookie, also accepts Bearer tokens and query params

**Session Scoping**:

- Username prefix applied to session names in local multi-user mode
- Non-admin users can only access sessions they created
- Admin users can access all sessions

---

### 6. Custom Server Infrastructure

**WebSocket Servers** (noServer mode in `/server/index.ts`):

1. **Terminal WS** (`/ws/terminal/:sessionId`):
   - PTY input/output streaming
   - Terminal resize control
   - Tmux copy-mode scroll control (page-up, page-down, history-top, history-bottom)
   - 4MB max payload
   - Session death detection → close code 4000

2. **Logs WS** (`/ws/logs/:encodedPath`):
   - File tail streaming with real-time updates
   - 64KB max payload
   - Admin-only in local mode

3. **Files WS** (`/ws/files`):
   - File system watcher event stream
   - Broadcasts file changes to all connected clients
   - Admin-only in local mode

**HTTP Endpoints**:

- Telegram webhook endpoint hardcoded in custom server (not Next.js route)
- Health check: `/health` JSON endpoint
- All other routes delegated to Next.js

---

### 7. Component Architecture

**Component Structure** (`/src/components/`):

- `layout/` — AppShell, TopNav, RightPanel, StatusBar, CommandPalette
- `dashboard/` — DashboardView (main UI with session sidebar, git info, worktree creation)
- `terminal/` — TerminalViewXterm (xterm.js integration)
- `files/` — File browser
- `replay/` — Session replay viewer
- `settings/` — User/mobile settings
- `auth/` — Login/logout UI
- `ui/` — shadcn/ui components (card, dialog, button, dropdown, etc.)

**State Management**:

- Custom hooks: `useSessions()`, `useOpenTabs()`
- React 19 with hooks
- Client-side only (useClient directives)

---

### 8. Telegram Integration (Provider Pattern Reference)

**Existing External Integration** (`/src/lib/telegram/`):

- **Auth**: Identity resolution from Telegram user IDs → TerminalX usernames
- **Config**: Environment-based settings (`TERMINALX_TELEGRAM_BOT_TOKEN`, `TERMINALX_TELEGRAM_ALLOWED_USERS`)
- **Bot**: grammy library integration with full session control (attach, kill, chat streaming)
- **Streamer**: Real-time screen capture → Telegram messages (diff-based incremental updates)
- **Transcription**: Whisper-based audio transcription
- **State**: Persistent topic mappings in `data/telegram-state.json`
- **Keyboard**: Dynamic inline buttons for session controls
- **Rendering**: Terminal output → Markdown/HTML conversion

**Pattern**: Provider initialized at startup, config polling every 5s for hot-reload, bot reference accessible to API routes via bot-bridge pattern

---

### 9. Security Infrastructure

**Safe Path Resolution** (`/src/lib/file-service.ts`):

- `resolveSafePath()` — validates paths stay within `TERMINUS_ROOT`
- Symlink follow + re-check to prevent escape attacks
- Blocks: `.git`, `.ssh`, `.gnupg`, `.config/secrets`, `.env`, `.env.*`, `.terminalx-secret`
- Optional: `TERMINALX_ALLOW_SENSITIVE_FILE_ACCESS=true` to bypass

**Audit Logging** (`/src/lib/audit-log.ts`):

- All major actions logged: session_created, session_deleted, terminal_connected, login, etc.

**Rate Limiting** (`/src/lib/rate-limit.ts`):

- Per-IP rate limits available for auth endpoints

---

### 10. What Infrastructure Exists for Extensions

**Ready to Extend**:

1. **API Routes Structure**: Simple Next.js route handlers with auth checks
2. **Provider Pattern**: Telegram shows how external integrations attach (env config → auth resolution → state management → bot instance)
3. **Session Metadata**: Already supports arbitrary `SessionMeta` extensions via the JSON structure
4. **Command Execution**: `execFileSync()` patterns established for git, tmux, and other binaries
5. **File Watching**: Chokidar integration for real-time event streaming
6. **WebSocket Server**: Custom HTTP server handles WebSocket upgrades; could add new channels easily
7. **State Persistence**: JSON file pattern with atomic writes + locks for concurrent safety

---

### 11. Missing for Diff/PR Features

**Not Yet Implemented**:

1. **Diff Generation**
   - `git diff` parsing
   - Diff visualization component
   - Staged vs. unstaged comparison
   - Commit diff viewing

2. **Git Operations**
   - `git add/reset` (staging)
   - `git commit` with message
   - `git push`
   - Branch switching
   - Merge/rebase

3. **GitHub/GitLab/Bitbucket Integration**
   - OAuth authentication for platforms
   - API clients (octokit, gitlab, python-gitlab)
   - PR creation/editing
   - Branch/commit status checks
   - PR review comments

4. **UI Components**
   - Diff viewer component (two-column or inline)
   - PR form (title, description, reviewers)
   - Provider selector

5. **Custom Providers**
   - No generic provider interface pattern yet
   - Would need: auth config structure, API client abstraction, identity resolution, state persistence pattern

---

### File Paths Summary

**Key Existing Infrastructure**:

- `/src/lib/git-worktree.ts` — git operations
- `/src/lib/ai-sessions.ts` — session metadata
- `/src/lib/file-service.ts` — safe file I/O
- `/src/lib/auth.ts` — JWT + revocation
- `/src/app/api/sessions/route.ts` — session CRUD
- `/src/app/api/files/route.ts` — file listing
- `/server/index.ts` — custom HTTP/WebSocket server
- `/src/lib/telegram/` — provider pattern reference (3,919 lines)
- `/src/components/dashboard/DashboardView.tsx` — main UI (extensible)

This infrastructure provides a solid foundation for adding diff viewing and PR creation with minimal new code paths needed.

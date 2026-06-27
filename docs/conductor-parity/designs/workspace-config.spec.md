# Workspace Configuration (`.terminalx/settings.toml`) Specification

**Status:** Design Specification
**Date:** 2026-06-25
**Author:** TerminalX Team
**Version:** 1.0-draft
**Backing issue:** #5

---

## Executive Summary

TerminalX sessions today are created from the dashboard with a chosen `kind`
(`bash` | `claude` | `codex`), an optional cwd, and an optional git worktree —
but the repository itself carries no opinion about how it should be set up or
run. Every developer reconstructs "install deps, build, start the dev server,
which env vars matter" by hand, and per-workspace setup is invisible to the app.

This spec defines TerminalX's analog of **Conductor's committed repo config**:
a `.terminalx/settings.toml` file (User vs. Repo scope) that declares a **setup
script**, named **run scripts**, **environment variables**, the **default
session kind**, **files to copy** into a fresh worktree, and a per-workspace
injected **`TERMINALX_PORT`**. When a session is created against a git worktree,
TerminalX copies the declared files (including `.env` "if you have one"),
injects `TERMINALX_PORT`, and runs the setup script through the existing PTY
manager, streaming output to a panel. Run scripts surface in the existing
command palette for one-keystroke execution.

This mirrors Conductor 1:1 while using TerminalX naming and slotting into the
real code paths in `src/lib/ai-sessions.ts`, `src/lib/git-worktree.ts`,
`src/lib/pty-manager.ts`, `src/lib/tmux.ts`, and the `POST /api/sessions` route.

---

## Conductor UI reference (from screenshots)

These are the authoritative Conductor facts this feature mirrors. TerminalX
names are introduced where noted; everything below is the source of truth for UI
shape and behaviour.

- **Committed repo config in TOML.** Conductor stores repo-scoped configuration
  in a committed file, `.conductor/settings.toml`. Repo-scoped settings screens
  show a top-right **"Edit settings.toml"** button that opens the committed file
  for editing. TerminalX analog: **`.terminalx/settings.toml`** with an
  **"Edit settings.toml"** affordance.
- **User vs. Repo scope.** The settings shell has two top-level scope tabs,
  **"User"** and **"Repo"**. Settings exist at both scopes; repo scope is what
  lives in the committed TOML. TerminalX adopts the same User/Repo split for
  workspace config: user defaults layer under repo config.
- **Per-workspace injected port.** Conductor injects a per-workspace port via a
  **`CONDUCTOR_PORT`** environment variable so preview/run servers in different
  workspaces never collide. TerminalX analog: **`TERMINALX_PORT`**.
- **`.env` copy on workspace creation.** The Conductor review-panel session chat
  references copying an **`.env`** file into the workspace _"if you have one"_ as
  part of workspace setup. TerminalX analog: a `copyFiles` / `files-to-copy`
  list, with `.env` as the canonical default entry.
- **Settings left nav (User scope):** General, Account, Models, Harnesses
  (and a Providers entry on some captures), **Environment**, Git, Appearance;
  then a "More" group: Experimental, Advanced. Workspace config (setup/run/env)
  is the **Environment**-adjacent surface; in TerminalX it is a dedicated
  **"Workspace"** settings section with the same User/Repo scope tabs.
- **Setup output is a streamed surface.** Conductor surfaces setup/run output as
  live terminal output. TerminalX runs setup/run scripts through its existing PTY
  manager (`src/lib/pty-manager.ts`, attached to tmux) and streams to a panel,
  consistent with how every other TerminalX session renders.

> Naming note: every new on-disk artifact uses **`.terminalx/`** and
> **`TERMINALX_*`** (not `.conductor/` / `CONDUCTOR_*`). The Conductor analog is
> named inline so the mirroring is explicit.

---

## 1. Data Model

### 1.1 On-disk format

Repo config lives in a committed file at the **repo root**:

```
<repoRoot>/.terminalx/settings.toml
```

We mirror Conductor's choice of TOML for the committed file (human-editable,
diff-friendly, comment-friendly). User-scope config lives outside the repo in
TerminalX's data dir as JSON (consistent with `data/ai-sessions.json` written by
`src/lib/ai-sessions.ts`):

```
<process.cwd()>/data/workspace-config.json   # user-scope defaults (per server/user)
```

The TOML file is the source of truth for the repo; the JSON file holds the
**user-scope** overlay (defaults the user wants for any repo that omits a field).

### 1.2 `.terminalx/settings.toml` schema

```toml
# .terminalx/settings.toml — committed repo workspace config
# Conductor analog: .conductor/settings.toml

# Schema version for forward-compat migrations.
version = 1

[workspace]
# Default session kind for new workspaces created against this repo.
# One of: "bash" | "claude" | "codex" (must match SessionKind in
# src/lib/ai-sessions.ts). Invalid values fall back to "bash".
defaultKind = "claude"

# Files copied from the source checkout into a freshly created worktree.
# Conductor analog: copying ".env" "if you have one". Paths are repo-root
# relative; missing sources are skipped silently (they are optional by design).
copyFiles = [".env", ".env.local"]

[env]
# Static environment variables exported into every session for this repo.
# Values support ${VAR} interpolation against the already-resolved env
# (TERMINALX_PORT is available here). Secrets should NOT live here — keep
# those in copied .env files, which are git-ignored.
NODE_ENV = "development"
NEXT_PUBLIC_API_BASE = "http://localhost:${TERMINALX_PORT}"

# Setup script: run once when a workspace is first created, before the
# session's CLI starts. Streamed to a setup panel. Conductor analog: the
# repo setup script run on workspace creation.
[setup]
command = "npm ci && npm run build"
# Optional: seconds before the setup run is force-killed (default 1800).
timeoutSeconds = 1800

# Named run scripts. Each becomes a command-palette entry
# ("run · <name>") and can be executed on demand in the active workspace.
[scripts.dev]
description = "Start the dev server"
command = "npm run dev -- --port ${TERMINALX_PORT}"

[scripts.test]
description = "Run the test suite"
command = "npm test"

[scripts.build]
description = "Production build"
command = "npm run build"
```

### 1.3 TypeScript types

New module: `src/lib/workspace-config.ts`.

```typescript
import type { SessionKind } from "./ai-sessions";

/** Where a resolved config value came from (for the "Edit" affordance + UI). */
export type ConfigScope = "repo" | "user" | "default";

export interface RunScript {
  /** Stable key, e.g. "dev". Used in the palette id and execute route. */
  name: string;
  /** Human description shown in the palette and settings UI. */
  description?: string;
  /** Shell command, pre-interpolation. */
  command: string;
}

export interface SetupScript {
  command: string;
  /** Seconds before the setup run is force-killed. Default 1800 (30m). */
  timeoutSeconds?: number;
}

/** Raw, per-scope config as parsed from a single source (TOML or user JSON). */
export interface WorkspaceConfigSource {
  version: number;
  defaultKind?: SessionKind;
  copyFiles?: string[];
  env?: Record<string, string>;
  setup?: SetupScript;
  scripts?: Record<string, Omit<RunScript, "name">>;
}

/** Fully resolved config after layering default < user < repo. */
export interface ResolvedWorkspaceConfig {
  /** Absolute repo root the config was resolved for. */
  repoRoot: string;
  /** Absolute path to the committed file (may not exist). */
  configPath: string;
  /** True if .terminalx/settings.toml exists and parsed cleanly. */
  hasRepoConfig: boolean;
  defaultKind: SessionKind;
  copyFiles: string[];
  env: Record<string, string>;
  setup: SetupScript | null;
  scripts: RunScript[];
  /** Per-field provenance, so the UI can label "from repo" vs "from user". */
  provenance: {
    defaultKind: ConfigScope;
    copyFiles: ConfigScope;
    env: ConfigScope;
    setup: ConfigScope;
    scripts: ConfigScope;
  };
  /** Non-fatal parse/validation warnings to surface in the UI. */
  warnings: string[];
}
```

### 1.4 Extension to `SessionMeta`

`SessionMeta` (in `src/lib/ai-sessions.ts`) gains optional, backward-compatible
fields so the app remembers what setup was run and which port was injected. Old
`data/ai-sessions.json` records without these fields remain valid (they are all
optional, matching how `worktree?` is already optional).

```typescript
export interface SessionMeta {
  name: string;
  kind: SessionKind;
  createdAt: string;
  createdBy?: string;
  managed?: boolean;
  cwd?: string;
  worktree?: {
    repoRoot: string;
    path: string;
    branch: string;
  };

  // NEW (all optional → backward compatible):
  /** Per-workspace injected port. Conductor analog: CONDUCTOR_PORT. */
  port?: number;
  /** Setup run lifecycle for this workspace. */
  setup?: {
    status: "pending" | "running" | "succeeded" | "failed" | "skipped";
    startedAt?: string;
    finishedAt?: string;
    exitCode?: number;
  };
}
```

---

## 2. Config Resolution & Layering

### 2.1 Resolution order

For a given repo root, config is resolved by **layering** three sources,
last-wins per field:

```
built-in defaults  <  user-scope (data/workspace-config.json)  <  repo (.terminalx/settings.toml)
```

This matches Conductor's User-vs-Repo model: a user can set personal defaults
(e.g. `defaultKind = "bash"`), but the committed repo config wins where present.
`provenance` records which scope supplied each resolved field so the settings UI
can render "from repo" / "from your defaults" / "default" badges.

### 2.2 `resolveWorkspaceConfig`

```typescript
// src/lib/workspace-config.ts
import * as fs from "fs";
import * as path from "path";
import * as TOML from "@iarna/toml"; // see §10 Dependencies
import { isValidKind, type SessionKind } from "./ai-sessions";
import { assertNotSensitivePath, resolveSafePath } from "./file-service";

const BUILTIN: Required<
  Omit<
    ResolvedWorkspaceConfig,
    "repoRoot" | "configPath" | "hasRepoConfig" | "provenance" | "warnings"
  >
> = {
  defaultKind: "bash",
  copyFiles: [".env", ".env.local"],
  env: {},
  setup: null,
  scripts: [],
};

export function repoConfigPath(repoRoot: string): string {
  return path.join(repoRoot, ".terminalx", "settings.toml");
}

export function resolveWorkspaceConfig(repoRoot: string): ResolvedWorkspaceConfig {
  const safeRoot = resolveSafePath(repoRoot);
  assertNotSensitivePath(safeRoot);

  const warnings: string[] = [];
  const userSource = readUserScopeConfig(warnings);
  const repoSource = readRepoConfig(safeRoot, warnings);

  const pick = <T>(
    field: keyof WorkspaceConfigSource,
    repoV: T | undefined,
    userV: T | undefined,
    def: T
  ): [T, ConfigScope] => {
    if (repoV !== undefined) return [repoV, "repo"];
    if (userV !== undefined) return [userV, "user"];
    return [def, "default"];
  };

  const [defaultKind, kindScope] = pick(
    "defaultKind",
    validKind(repoSource?.defaultKind),
    validKind(userSource?.defaultKind),
    BUILTIN.defaultKind
  );
  const [copyFiles, copyScope] = pick(
    "copyFiles",
    repoSource?.copyFiles,
    userSource?.copyFiles,
    BUILTIN.copyFiles
  );
  const [env, envScope] = pick("env", repoSource?.env, userSource?.env, BUILTIN.env);
  const [setup, setupScope] = pick(
    "setup",
    normalizeSetup(repoSource?.setup),
    normalizeSetup(userSource?.setup),
    BUILTIN.setup
  );
  const [scriptsRecord, scriptsScope] = pick(
    "scripts",
    repoSource?.scripts,
    userSource?.scripts,
    undefined
  );

  const scripts: RunScript[] = scriptsRecord
    ? Object.entries(scriptsRecord).map(([name, s]) => ({ name, ...s }))
    : BUILTIN.scripts;

  return {
    repoRoot: safeRoot,
    configPath: repoConfigPath(safeRoot),
    hasRepoConfig: repoSource !== null,
    defaultKind,
    copyFiles,
    env,
    setup,
    scripts,
    provenance: {
      defaultKind: kindScope,
      copyFiles: copyScope,
      env: envScope,
      setup: setupScope,
      scripts: scriptsScope,
    },
    warnings,
  };
}

function validKind(k: unknown): SessionKind | undefined {
  return isValidKind(k) ? k : undefined;
}
```

`readRepoConfig` reads `repoConfigPath(repoRoot)`; on `ENOENT` it returns `null`
(no repo config, not an error). On a TOML parse error it returns `null` and
pushes a warning — **never throws** — so a malformed committed file degrades to
defaults instead of breaking session creation. This satisfies "handle missing or
invalid config gracefully (use defaults)."

### 2.3 Validation rules

- `version` must be `1`; unknown versions emit a warning and parse best-effort.
- `defaultKind` must satisfy `isValidKind` (from `ai-sessions.ts`); otherwise
  the field is dropped (falls through to the next scope), with a warning.
- `copyFiles` entries must be **repo-root-relative, non-absolute, no `..`**.
  Each is validated by `copyConfiguredFiles`' own traversal check at copy time
  (see §4.5): the entry is rejected if it is absolute or contains a `..`
  segment, the resolved **source** is confined to `sourceRoot` and the resolved
  **dest** is confined to the worktree path. Entries that escape either root are
  skipped with a warning. **`copyFiles` is deliberately NOT routed through
  `assertNotSensitivePath`** — `isSensitivePath` (`src/lib/file-service.ts`
  line 50) flags any path whose basename is `.env` or starts with `.env.`, so
  passing the canonical defaults `.env` / `.env.local` to `assertNotSensitivePath`
  would throw `"Access denied to sensitive path"` (`file-service.ts` lines
  67-70) and make the headline parity feature ("copy `.env` if you have one")
  impossible for exactly the files Conductor copies. The only built-in override
  is `TERMINALX_ALLOW_SENSITIVE_FILE_ACCESS=true` (`file-service.ts` line 36),
  which we do **not** require operators to set; see §4.5 and §9.
- `setup.command` and `scripts.*.command` are non-empty strings. Empty/invalid
  scripts are dropped with a warning.
- `env` keys must match `^[A-Za-z_][A-Za-z0-9_]*$`. `TERMINALX_*` and
  reserved keys (`PATH`, `HOME`, `SHELL`, `TERM`, `TERMINALX_PORT`) cannot be
  overridden by config — attempts are ignored with a warning.

---

## 3. Per-Workspace Port Injection (`TERMINALX_PORT`)

Conductor analog: `CONDUCTOR_PORT`. TerminalX injects a unique port per managed
workspace so multiple `run · dev` servers across worktrees never collide.

### 3.1 Allocation

```typescript
// src/lib/workspace-port.ts
import * as net from "net";
import { listMetadata } from "./ai-sessions";

const PORT_BASE = Number(process.env.TERMINALX_PORT_BASE ?? 4100);
const PORT_RANGE = Number(process.env.TERMINALX_PORT_RANGE ?? 900); // 4100–4999

/** Allocate a free, not-currently-claimed port for a new workspace. */
export async function allocateWorkspacePort(): Promise<number> {
  const claimed = new Set(
    listMetadata()
      .map((m) => m.port)
      .filter((p): p is number => Number.isInteger(p))
  );
  for (let i = 0; i < PORT_RANGE; i++) {
    const candidate = PORT_BASE + i;
    if (claimed.has(candidate)) continue;
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error("No free workspace port in TERMINALX_PORT range");
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}
```

The chosen port is persisted on `SessionMeta.port` so it is stable for the life
of the workspace (a `run · dev` re-run reuses the same port). The port is
released implicitly when the session metadata is deleted (`deleteMeta`), since
allocation only consults live metadata.

### 3.2 Injection points

- **Setup run** (§4): `TERMINALX_PORT` is in the setup process env.
- **Run scripts** (§5): same.
- **The session's interactive shell** (the tmux session created in
  `createSession`): `TERMINALX_PORT` is exported so anything the user runs by
  hand sees it.

Because `src/lib/pty-manager.ts` deliberately builds a **sanitized allowlist
env** (it must not spread `process.env`, which holds server secrets), the
allowlist is extended to include the workspace env. Rather than widen the
generic allowlist, the setup/run executors pass an explicit `extraEnv` map that
is merged on top of the existing `safeEnv` (see §4.2). `TERMINALX_PORT` is also
added to the `createSession` invocation by prefixing the command with an export
(see §4.4) so the interactive shell inherits it without touching the PTY
allowlist.

---

## 4. Setup Execution

Setup runs **once**, when a workspace (worktree-backed session) is first created,
after files are copied and before the session CLI takes over. It mirrors
Conductor running the repo setup script on workspace creation.

### 4.1 Where it hooks into session creation

The existing `POST /api/sessions` flow (`src/app/api/sessions/route.ts`) already:

1. validates name/kind,
2. resolves `startDir` and optionally creates a worktree via
   `createGitWorktreeForSession` (`src/lib/git-worktree.ts`),
3. calls `createSession(finalName, command, startDir)` (`src/lib/tmux.ts`),
4. `saveMeta(...)`.

Workspace config slots in between steps 2 and 3:

```
2.  startDir / createdWorktree resolved
2a. config = resolveWorkspaceConfig(createdWorktree.repoRoot)   // worktree only
2b. port = await allocateWorkspacePort()
2c. copyConfiguredFiles(sourceRoot, createdWorktree.worktreePath, config.copyFiles)
2d. command = commandForKind(kind, opts) with TERMINALX_PORT + config.env prefix
3.  createSession(finalName, command, startDir)
4.  saveMeta({ ..., port, setup: { status: "pending" } })
4a. fire-and-stream the setup run (async), updating SessionMeta.setup
```

Setup only applies to **worktree-backed** creations (where we have a definite
`repoRoot`). For a plain `cwd` session in an existing checkout, config is still
resolved (so env + run scripts work) but the **setup script is not auto-run** —
re-running install/build in a checkout the user is already using would be
destructive. The user can trigger setup explicitly via the palette
("workspace · run setup").

### 4.2 Setup executor

Setup runs as a **dedicated, transient tmux session** created via the existing
`createSession` + attached through `pty-manager`, so output streams to a panel
exactly like any other session, then the transient session exits.

```typescript
// src/lib/workspace-setup.ts
import { createSession, killSession } from "./tmux";
import { saveMeta, getMeta } from "./ai-sessions";

/**
 * Runs the setup command in a transient tmux session named
 * "<sessionName>--setup", streaming to the PTY/terminal bus. Resolves when the
 * command exits. Updates SessionMeta.setup throughout.
 */
export async function runSetup(opts: {
  sessionName: string;
  cwd: string;
  command: string;
  env: Record<string, string>; // includes TERMINALX_PORT + config.env
  timeoutSeconds: number;
}): Promise<{ exitCode: number }> {
  const setupName = `${opts.sessionName}--setup`;
  await patchSetupStatus(opts.sessionName, { status: "running", startedAt: now() });

  // Build a wrapped command that exports env, runs setup, prints the exit
  // marker, then exits (transient — no "exec bash -l" tail).
  const exports = Object.entries(opts.env)
    .map(([k, v]) => `export ${k}=${shellQuote(v)}`)
    .join("; ");
  const wrapped =
    `bash -lc '${exports}; ${escapeSingle(opts.command)}; ` +
    `ec=$?; echo; echo "[setup exited with code $ec]"; exit $ec'`;

  createSession(setupName, wrapped, opts.cwd);
  const { exitCode } = await waitForSetupExit(setupName, opts.timeoutSeconds);

  await patchSetupStatus(opts.sessionName, {
    status: exitCode === 0 ? "succeeded" : "failed",
    finishedAt: now(),
    exitCode,
  });
  try {
    killSession(setupName);
  } catch {
    /* already gone */
  }
  return { exitCode };
}
```

`shellQuote` / `escapeSingle` reuse the single-quote escaping pattern already
used in `commandForKind` (`bash -lc '...'` with `'` → `'\''`). `env` values are
single-quoted; never interpolated into the command string unescaped (command
injection mitigation — see §9).

### 4.3 Streaming to a panel

The setup tmux session is attachable like any other through
`src/lib/pty-manager.ts` (`createPty` → `tmux attach-session`). The
`--setup`-suffixed session is shown to the user as a transient "Setup" tab/panel
in the workspace. The same WebSocket terminal pipe used for normal sessions
carries setup output — no new transport is required. When the setup session
exits, the panel shows the `[setup exited with code N]` marker and the
`SessionMeta.setup.status` flips, which the dashboard/workspace polls via
`GET /api/sessions`.

### 4.4 Injecting env into the main session

The user-facing session command keeps the existing
`commandForKind(kind, opts)` shape but is **prefixed** with the workspace env
exports so the interactive shell inherits `TERMINALX_PORT` and `config.env`:

```typescript
// In POST /api/sessions, replacing the bare `commandForKind(...)`:
const base = commandForKind(sessionKind, { dangerouslySkipPermissions });
const command = base
  ? withWorkspaceEnv(base, { TERMINALX_PORT: String(port), ...config.env })
  : withWorkspaceEnv("exec bash -l", { TERMINALX_PORT: String(port), ...config.env });
```

`withWorkspaceEnv` wraps the inner command in a `bash -lc 'export …; <inner>'`
so the allowlist in `pty-manager` is untouched (the exports live inside the tmux
session's own shell, not in the node-pty env). For `kind: "bash"` (where
`commandForKind` returns `null`), we synthesize an env-prefixed login shell.

### 4.5 File copy (`copyConfiguredFiles`) — and why it bypasses `assertNotSensitivePath`

The headline parity feature is copying `.env` (and `.env.local`) "if you have
one" into a fresh worktree. This **cannot** go through the generic
`file-service.ts` guards: `isSensitivePath` returns `true` for any path whose
basename is `.env` or starts with `.env.` (`src/lib/file-service.ts` line 50),
and `assertNotSensitivePath` throws `"Access denied to sensitive path"` for such
paths (lines 67-70). Routing the default `copyFiles` entries through
`assertNotSensitivePath` would therefore reject the exact files the feature
exists to copy. The only built-in escape hatch is
`TERMINALX_ALLOW_SENSITIVE_FILE_ACCESS=true` (line 36), and we do **not** want to
force operators to globally disable the sensitive-path guard just to copy env
files.

Instead, `copyConfiguredFiles` is a **dedicated copy routine** that applies only
the traversal checks this feature needs — reject absolute paths and `..`, confine
the **source** to `sourceRoot` and the **dest** to the worktree path — and then
reads/writes bytes with `fs` directly. It does **not** call
`assertNotSensitivePath`, and it does **not** depend on
`TERMINALX_ALLOW_SENSITIVE_FILE_ACCESS`.

```typescript
// src/lib/workspace-config.ts (or a small src/lib/workspace-copy.ts)
import * as fs from "fs";
import * as path from "path";

/**
 * Copy repo-root-relative files from a source checkout into a fresh worktree.
 * Confines source within `sourceRoot` and dest within `destRoot`; never touches
 * the global sensitive-path guard (which would reject .env by design). Missing
 * sources are skipped silently (Conductor's ".env if you have one"). Returns
 * non-fatal warnings for rejected/failed entries.
 */
export function copyConfiguredFiles(
  sourceRoot: string,
  destRoot: string,
  files: string[]
): { copied: string[]; warnings: string[] } {
  const copied: string[] = [];
  const warnings: string[] = [];
  const srcRootAbs = path.resolve(sourceRoot);
  const destRootAbs = path.resolve(destRoot);

  const within = (root: string, p: string) => p === root || p.startsWith(root + path.sep);

  for (const rel of files) {
    // Reject absolute paths and any `..` traversal up front.
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
      warnings.push(`copyFiles: "${rel}" is not a repo-root-relative path; skipped`);
      continue;
    }
    const srcAbs = path.resolve(srcRootAbs, rel);
    const destAbs = path.resolve(destRootAbs, rel);
    if (!within(srcRootAbs, srcAbs) || !within(destRootAbs, destAbs)) {
      warnings.push(`copyFiles: "${rel}" escapes the repo/worktree root; skipped`);
      continue;
    }
    try {
      const stat = fs.statSync(srcAbs); // throws ENOENT if no source
      if (!stat.isFile()) {
        warnings.push(`copyFiles: "${rel}" is not a regular file; skipped`);
        continue;
      }
      if (fs.existsSync(destAbs)) {
        warnings.push(`copyFiles: "${rel}" already exists in the worktree; skipped`);
        continue;
      }
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.copyFileSync(srcAbs, destAbs);
      copied.push(rel);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") continue; // optional source: ".env if you have one"
      warnings.push(`copyFiles: failed to copy "${rel}": ${e.message}`);
    }
  }
  return { copied, warnings };
}
```

This is the routine referenced by step `2c` in §4.1. Note: `resolveSafePath` +
`assertNotSensitivePath` are still used for the **repo root** in
`resolveWorkspaceConfig` (§2.2) and for the **TOML write target** in §7.2 — those
are non-`.env` paths and are correctly subject to the sensitive-path guard. Only
the per-file `copyFiles` copy bypasses it, using the narrower checks above.

---

## 5. Run Scripts & Command Palette

### 5.1 Surfacing in the palette

`src/components/layout/CommandPalette.tsx` builds its item list from
`useSessions()` plus a static `base`. We add a third group, **run scripts for
the active workspace**, fetched from the resolved config of the active session's
repo:

```typescript
// inside the items useMemo, after attachItems:
const runItems: Item[] = workspaceScripts.map((s) => ({
  id: `run-${s.name}`,
  label: `run · ${s.name}`,
  hint: s.description ?? "script",
  action: () => {
    onClose();
    void executeRunScript(activeSession, s.name);
  },
}));
return [...attachItems, ...runItems, ...base];
```

`workspaceScripts` comes from a new hook `useWorkspaceConfig(activeSession)` that
calls `GET /api/workspace/config?session=<name>`. When there is no active
workspace or no scripts, the group is empty (palette behaves exactly as today).

### 5.2 Executing a run script

A run script executes in its **own transient tmux session**
(`<sessionName>--run-<scriptName>-<ts>`) so the user's primary session isn't
hijacked, streamed to a panel like setup. Unlike setup, run scripts keep the
session alive on exit (drop to bash, matching `commandForKind`'s tail) so a
crashed `dev` server can be inspected.

```typescript
async function executeRunScript(sessionName: string, scriptName: string) {
  await fetch(`/api/workspace/scripts/${encodeURIComponent(scriptName)}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: sessionName }),
  });
  // server creates the transient run session; client navigates/attaches to it.
}
```

---

## 6. Environment Variable Interpolation

`${VAR}` references inside `env` values and inside `setup`/`scripts` commands are
expanded against the **already-resolved** environment (workspace env merged on
top of the sanitized base), with `TERMINALX_PORT` always available:

```typescript
export function interpolate(value: string, scope: Record<string, string>): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_, name) => scope[name] ?? process.env[name] ?? ""
  );
}
```

- Interpolation is **single-pass** (no recursive expansion → no infinite loops).
- Unknown variables expand to empty string (a warning is emitted once per key).
- Interpolation runs in `resolveWorkspaceConfig` for `env` values and at execute
  time for `command` strings, so `TERMINALX_PORT` (known only at create time) is
  available to commands like `npm run dev -- --port ${TERMINALX_PORT}`.

---

## 7. API Routes

All new routes live under `src/app/api/workspace/` and follow the existing
route conventions (NextRequest/NextResponse, `getUserScoping`, `audit`,
`TERMINUS_READ_ONLY` guard on mutating routes).

> **Required precondition — extend the `AuditEvent` union.** The three audit
> calls below (`workspace_config_edited`, `workspace_script_run`,
> `workspace_setup_run`) are new event names. `AuditEvent` in
> `src/lib/audit-log.ts` (lines 6-34) is a **closed** string-literal union
> (`login_success` … `device_revoked`) and `audit()` only accepts an
> `AuditEvent`, so calling `audit("workspace_config_edited", …)` without first
> adding these three literals to the union is a **TypeScript compile error**.
> Add the three literals to the union before wiring any route (see the §14
> checklist item).

### 7.1 `GET /api/workspace/config`

`src/app/api/workspace/config/route.ts`

Query params:

- `session=<name>` — resolve config for the repo backing this session's worktree.
- or `repoRoot=<path>` — resolve config for an explicit repo root (validated via
  `resolveSafePath` + `assertNotSensitivePath`).

Response `200`:

```jsonc
{
  "hasRepoConfig": true,
  "configPath": "/abs/repo/.terminalx/settings.toml",
  "defaultKind": "claude",
  "copyFiles": [".env", ".env.local"],
  "env": { "NODE_ENV": "development" },
  "setup": { "command": "npm ci && npm run build", "timeoutSeconds": 1800 },
  "scripts": [
    {
      "name": "dev",
      "description": "Start the dev server",
      "command": "npm run dev -- --port ${TERMINALX_PORT}",
    },
  ],
  "provenance": {
    "defaultKind": "repo",
    "scripts": "repo",
    "env": "repo",
    "setup": "repo",
    "copyFiles": "default",
  },
  "warnings": [],
}
```

Secrets are never returned: the route returns the **config**, not the contents of
copied `.env` files. (`env` values declared in the committed TOML are returned
as-is; this is why §2.3 forbids putting secrets in `[env]`.)

### 7.2 `GET /api/workspace/config/raw` and `PUT /api/workspace/config/raw`

Backs the **"Edit settings.toml"** affordance.

- `GET …/raw?session=<name>` → `{ "path": "…/.terminalx/settings.toml",
"content": "<raw toml or empty>", "exists": true|false }`.
- `PUT …/raw` body `{ session, content }` → validates the TOML parses and passes
  §2.3 validation (returns `400` + `warnings` on failure), writes the file with
  mode `0o644`, audits `workspace_config_edited` (new `AuditEvent` literal — see
  the §7 precondition). Guarded by `TERMINUS_READ_ONLY`.

This reuses the existing file-write safety net (`assertNotSensitivePath`,
`resolveSafePath`) rather than the generic `POST /api/files` route, so the write
target is pinned to `<repoRoot>/.terminalx/settings.toml`.

### 7.3 `POST /api/workspace/scripts/{scriptName}/execute`

`src/app/api/workspace/scripts/[scriptName]/route.ts`

Body `{ session: string }`. Behaviour:

1. Resolve config for the session's worktree repo; find the named script (404 if
   absent).
2. Build env = sanitized base + `config.env` + `TERMINALX_PORT` from the
   session's `SessionMeta.port` (allocate if somehow missing).
3. Interpolate the command, create a transient run tmux session, return its name
   so the client can attach.
4. Guarded by `TERMINUS_READ_ONLY`; audited as `workspace_script_run` (new
   `AuditEvent` literal — see the §7 precondition) with detail
   `<session>/<scriptName>`.

### 7.4 `POST /api/workspace/setup`

`src/app/api/workspace/setup/route.ts` — manually (re)run the setup script for a
session's workspace (the palette "workspace · run setup" action and retry-on-fail
button). Body `{ session }`. Same guards; audited as `workspace_setup_run` (new
`AuditEvent` literal — see the §7 precondition).

### 7.5 Session-create integration (existing route, extended)

`POST /api/sessions` is extended per §4.1: resolve config, allocate port, copy
files, prefix env, persist `port` + `setup.status`, and kick off the setup run
when a worktree was created. The request body gains an optional
`skipSetup?: boolean` so the dashboard can offer "create without running setup".

---

## 8. UI

### 8.1 Settings → Workspace section (User/Repo scope)

A new **"workspace"** section is added to `src/components/settings/SettingsView.tsx`
using the existing `Section` / `Row` primitives (the file already defines a
`Section` component at line 38 and renders sections like "server", "terminal
engine", "telegram"). The section shows the two **User / Repo** scope tabs
(mirroring Conductor) and:

- **Repo tab:** read-only rendering of the resolved repo config (default kind,
  copy files, env keys, setup command, run scripts), each row tagged with a
  provenance badge ("from repo" / "from your defaults" / "default"). A top-right
  **"Edit settings.toml"** button (Conductor parity) opens the raw editor
  (§7.2) — when the file doesn't exist, the button label is **"Create
  settings.toml"** and seeds a commented template.
- **User tab:** editable defaults written to `data/workspace-config.json`
  (default kind, default copy files) that apply to repos lacking a committed
  config.

Warnings from `resolveWorkspaceConfig` render as an amber callout so a malformed
committed file is visible without breaking anything.

### 8.2 New-session dialog (DashboardView)

`src/components/dashboard/DashboardView.tsx` (the new-session UI) consumes the
resolved config when a repo/worktree is selected:

- The session-kind selector **defaults to `config.defaultKind`**.
- A "Run setup on create" checkbox (checked when `config.setup` exists; maps to
  the inverse of `skipSetup`).
- A small read-only summary: "Will copy: .env • inject TERMINALX_PORT • run
  setup: `npm ci && npm run build`".

### 8.3 Setup/run panels in the workspace

`src/components/workspace/WorkspaceView.tsx` already manages a tab strip over
`TerminalView`. Transient `--setup` / `--run-*` sessions appear as labelled tabs
(e.g. "setup", "run: dev") with a status dot driven by `SessionMeta.setup.status`
/ run exit code. They reuse `TerminalView` verbatim — same WebSocket terminal
pipe, no bespoke renderer.

### 8.4 Command palette

`src/components/layout/CommandPalette.tsx` gains the `run · <name>` group (§5.1)
and a `workspace · run setup` entry when the active session has a configured
setup script.

---

## 9. Security Considerations

| Threat                                              | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Arbitrary script execution from a committed file    | Scripts run only for **managed** sessions the user already created; commands run as the same OS user as any tmux session (no privilege escalation beyond existing TerminalX surface). Setup auto-runs **only** on explicit worktree creation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Command injection via `env` values / interpolation  | Env values are single-quoted (`'\''` escaping, same as `commandForKind`) and exported inside the tmux shell, never concatenated raw into the command. Interpolation is single-pass against a known scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Path traversal via `copyFiles`                      | Each entry is repo-root-relative, rejected if absolute or containing `..`; `copyConfiguredFiles` confines the resolved source within `sourceRoot` and the resolved dest within the worktree path before any FS read/write (§4.5). It deliberately does **not** call `assertNotSensitivePath`: that guard flags `.env`/`.env.*` (`file-service.ts` line 50) and would reject the canonical files this feature copies. The narrower traversal checks preserve the sandbox without forcing `TERMINALX_ALLOW_SENSITIVE_FILE_ACCESS=true`. The **repo root** (§2.2) and the **TOML write target** (§7.2) are still validated with `resolveSafePath` + `assertNotSensitivePath`, since those are non-`.env` paths. |
| Secret leakage via `GET /api/workspace/config`      | The route returns config, not file contents. Copied `.env` files are git-ignored and never read back over the API. `[env]` is documented as non-secret.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Server-secret leakage into scripts                  | The setup/run env starts from `pty-manager`'s sanitized allowlist + explicit workspace env only — `process.env` is never spread (preserving the existing rule that node-pty env must not carry JWT/admin secrets).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Reserved env override (`PATH`, `TERMINALX_PORT`, …) | Config cannot override reserved keys (§2.3); attempts are dropped with a warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Read-only mode                                      | `PUT /…/config/raw`, `POST /…/scripts/.../execute`, `POST /…/setup`, and setup-on-create are all gated by `TERMINUS_READ_ONLY === "true"`, matching the existing `POST/DELETE /api/sessions` guards.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Port exhaustion / collision                         | Ports are allocated from a bounded range, checked free via a transient listener, and persisted per workspace; collisions across workspaces are impossible because each port is claimed in `SessionMeta`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

---

## 10. Dependencies

- **TOML parser/serializer** for `.terminalx/settings.toml`. Recommended:
  `@iarna/toml` (parse + stringify, no native deps). This is the only new
  runtime dependency; user-scope JSON uses built-in `JSON`.
- No other new dependencies — file copy uses `fs`, port probing uses `net`,
  execution reuses `tmux` + `node-pty` already wired through `pty-manager.ts`.

---

## 11. Configuration (env)

New environment variables (to document in `AGENTS.md` alongside the existing
`TERMINUS_*` / `PORT` table):

| Variable               | Default | Description                                                                                          |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `TERMINALX_PORT_BASE`  | `4100`  | First port in the per-workspace allocation range (Conductor analog: the `CONDUCTOR_PORT` pool base). |
| `TERMINALX_PORT_RANGE` | `900`   | Size of the per-workspace port range (`4100`–`4999` by default).                                     |

`TERMINALX_PORT` itself is **not** a server config var — it is the per-workspace
value injected into each session, the direct analog of `CONDUCTOR_PORT`.

---

## 12. Acceptance Criteria

- [ ] `resolveWorkspaceConfig(repoRoot)` reads `.terminalx/settings.toml`,
      layers user-scope JSON and built-in defaults, and records per-field
      provenance.
- [ ] A missing **or** malformed `.terminalx/settings.toml` resolves to defaults
      with warnings and **never throws** during session creation.
- [ ] Creating a worktree-backed session copies `config.copyFiles` (including
      `.env` and `.env.local` "if you have one") into the new worktree via
      `copyConfiguredFiles` (§4.5), skipping missing sources. The copy succeeds
      for `.env`/`.env.*` **without** setting `TERMINALX_ALLOW_SENSITIVE_FILE_ACCESS`
      and is **not** routed through `assertNotSensitivePath` (which would reject
      those files).
- [ ] Each managed workspace gets a unique, persisted `TERMINALX_PORT`, injected
      into the setup run, run scripts, and the interactive session shell.
- [ ] On worktree creation with a configured `setup`, the setup command runs once
      through the PTY manager, streams to a panel, and updates
      `SessionMeta.setup.status` to `succeeded`/`failed`.
- [ ] Run scripts appear in the command palette as `run · <name>` and execute in
      a transient streamed session on selection.
- [ ] `GET /api/workspace/config` returns the resolved config (no secrets);
      `GET/PUT /api/workspace/config/raw` back an "Edit settings.toml" editor with
      validation.
- [ ] Settings shows a "workspace" section with User/Repo scope tabs and an
      "Edit settings.toml" (or "Create settings.toml") button.
- [ ] All mutating routes respect `TERMINUS_READ_ONLY` and emit audit events.
- [ ] Existing `data/ai-sessions.json` records without the new fields load and
      operate unchanged (backward compatibility).

---

## 13. Edge Cases

- **No `.terminalx/` dir:** `hasRepoConfig=false`; defaults used; "Edit" button
  becomes "Create settings.toml" and seeds a template (creates the dir).
- **Plain `cwd` session (no worktree):** config (env + scripts) still resolves;
  setup is **not** auto-run (no destructive install in a live checkout); the user
  can run it via the palette.
- **`defaultKind` invalid:** field dropped → falls through to user/default;
  warning surfaced.
- **`copyFiles` source missing:** skipped silently (optional by design, matching
  Conductor's ".env if you have one").
- **`copyFiles` destination already exists** (re-create into a fresh worktree):
  worktrees are always new dirs (`git-worktree.ts` rejects existing paths), so no
  overwrite conflict; if a manual re-copy hits an existing file, it is skipped
  with a warning (never clobbers user edits).
- **Port range exhausted:** session creation fails with a clear error; user can
  widen `TERMINALX_PORT_RANGE`.
- **Setup times out:** the transient setup session is killed at
  `setup.timeoutSeconds`; status → `failed` with a timeout note; the primary
  session is unaffected and still usable.
- **Setup fails:** primary session still starts (so the user can debug); status →
  `failed`; the workspace shows a "retry setup" affordance (`POST /…/setup`).
- **Interpolation of unknown `${VAR}`:** expands to empty string + one-time
  warning; never errors.
- **Concurrent setup runs for the same session:** the `<name>--setup` tmux name
  is unique per primary session; a second create is impossible (names are unique)
  and a manual re-run kills/recreates the prior `--setup` session.
- **Read-only mode:** setup/run/edit are blocked with `403`; config still reads.

---

## 14. Implementation Checklist

### Core

- [ ] `src/lib/workspace-config.ts` — types, `resolveWorkspaceConfig`,
      readers (TOML + user JSON), validation, `interpolate`.
- [ ] `src/lib/workspace-port.ts` — `allocateWorkspacePort`, `isPortFree`.
- [ ] `src/lib/workspace-setup.ts` — `runSetup`, `executeScript`, transient
      session lifecycle + status patching.
- [ ] Extend `SessionMeta` in `src/lib/ai-sessions.ts` with `port?` + `setup?`.
- [ ] Extend the `AuditEvent` union in `src/lib/audit-log.ts` (closed union,
      lines 6-34) with `"workspace_config_edited"`, `"workspace_script_run"`,
      and `"workspace_setup_run"` **before** any route calls `audit(...)` with
      these names — otherwise it is a TypeScript compile error (§7).
- [ ] Add `@iarna/toml` dependency.

### File copy

- [ ] `copyConfiguredFiles(sourceRoot, destRoot, files)` (§4.5) with traversal
      guards only (reject absolute / `..`, confine source to `sourceRoot` and
      dest to the worktree path). Reads/writes bytes with `fs` directly; does
      **not** call `assertNotSensitivePath` and does **not** require
      `TERMINALX_ALLOW_SENSITIVE_FILE_ACCESS`, so `.env` / `.env.local` copy.

### API

- [ ] `GET /api/workspace/config` (`route.ts`).
- [ ] `GET`/`PUT /api/workspace/config/raw` (`raw/route.ts`).
- [ ] `POST /api/workspace/scripts/[scriptName]/route.ts`.
- [ ] `POST /api/workspace/setup/route.ts`.
- [ ] Extend `POST /api/sessions` (resolve config, port, copy, env-prefix,
      kick setup, `skipSetup`).

### UI

- [ ] Settings "workspace" section with User/Repo tabs + Edit/Create button.
- [ ] `useWorkspaceConfig(session)` hook.
- [ ] Command palette `run · <name>` group + `workspace · run setup`.
- [ ] DashboardView: default kind from config, "run setup on create", summary.
- [ ] WorkspaceView: transient setup/run tabs with status dots.

### Docs / config

- [ ] Document `TERMINALX_PORT_BASE` / `TERMINALX_PORT_RANGE` in `AGENTS.md`.
- [ ] Author a `.terminalx/settings.toml` example in repo docs.

### Tests

- [ ] Resolution + layering + provenance unit tests.
- [ ] Malformed/missing TOML → defaults + warnings (no throw).
- [ ] `copyFiles` traversal rejection (absolute / `..` / escaping source or
      dest root) **and** a positive test that `.env` / `.env.local` copy
      successfully with `TERMINALX_ALLOW_SENSITIVE_FILE_ACCESS` unset.
- [ ] Port allocation uniqueness + reuse on re-run.
- [ ] Setup status transitions (success/fail/timeout).
- [ ] Interpolation (single-pass, unknown var, `TERMINALX_PORT`).
- [ ] Read-only mode gating on all mutating routes.

---

## 15. Conductor Parity Map

| Conductor                                          | TerminalX                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.conductor/settings.toml` (committed repo config) | `.terminalx/settings.toml` (committed repo config)                                                                                                                                    |
| "Edit settings.toml" button (repo scope)           | "Edit settings.toml" / "Create settings.toml" button (Settings → Workspace, Repo tab)                                                                                                 |
| User vs. Repo scope tabs                           | User vs. Repo scope tabs on the Workspace settings section                                                                                                                            |
| `CONDUCTOR_PORT` injected per workspace            | `TERMINALX_PORT` injected per workspace (`SessionMeta.port`)                                                                                                                          |
| Copy `.env` "if you have one" on workspace create  | `copyFiles` list (default `[".env", ".env.local"]`) copied into a fresh worktree via `copyConfiguredFiles` (§4.5), which bypasses the `.env`-rejecting `assertNotSensitivePath` guard |
| Repo setup script run on workspace creation        | `[setup]` command run once via PTY manager, streamed to a panel                                                                                                                       |
| Run/preview servers per workspace                  | `[scripts.*]` exposed in the command palette, run in transient streamed sessions                                                                                                      |

---

End of Specification

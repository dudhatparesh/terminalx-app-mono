// Harness/provider registry types (issue #4).
//
// A "harness" is a CLI runtime that drives a tmux session. This replaces the
// old hard-coded `SessionKind` union + `CLI_BINS` table + `commandForKind`
// switch in `src/lib/ai-sessions.ts` with a data-driven descriptor list so
// adding a runtime is a single registry edit (see registry.ts).

/** Authentication strategy mirrored from Conductor's Claude Code tab. */
export type HarnessAuthMethod = "cli" | "api-key" | "none";

/** Options consumed by the command builder; gated per-harness via optionFlags. */
export interface CommandOptions {
  /** claude-only today; data-driven via optionFlags. */
  dangerouslySkipPermissions?: boolean;
}

/** How the session command is built for a harness. */
export interface HarnessCommandSpec {
  /** Binary resolved from PATH, e.g. "claude". null => plain login shell (bash). */
  bin: string | null;
  /** Extra args appended unconditionally. */
  baseArgs?: string[];
  /**
   * Flags that are conditionally appended from CommandOptions.
   * Keeps the `--dangerously-skip-permissions` special-case data-driven
   * instead of a hard-coded `kind === "claude"` check.
   */
  optionFlags?: Array<{
    /** key in CommandOptions that gates this flag */
    when: keyof CommandOptions;
    flag: string;
  }>;
}

export interface HarnessDescriptor {
  /** Stable id, persisted as SessionMeta.kind. e.g. "bash" | "claude" | "codex" | "opencode". */
  id: string;
  /** Tab/button label, e.g. "Claude Code", "Codex", "Cursor", "OpenCode". */
  label: string;
  /** Conductor-style "NEW" badge on the tab. */
  badge?: "NEW";
  /** Theme color used by the dashboard toggle + session-row chip. */
  color: string;
  /** Authentication descriptor surfaced in the settings tab. */
  auth: HarnessAuthMethod;
  /** Command-builder spec. */
  command: HarnessCommandSpec;
  /**
   * Marks the OpenCode-style harness that hosts a nested provider registry
   * + install/version detection + executable-path override (see opencode-providers.ts).
   */
  hostsProviders?: boolean;
  /** Docs link shown in the harness tab header (Conductor "Docs ↗"). */
  docsUrl?: string;
}

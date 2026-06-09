import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Bot } from "grammy";
import { watch, FSWatcher } from "chokidar";
import { escapeMarkdownV2 } from "./render";
import { listTopics } from "./state";

interface AssistantEntry {
  type: "assistant";
  message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
}

interface ThinkingEntry {
  type: "thinking";
  message?: { content?: Array<{ type: string; text?: string }> };
}

interface ToolResultEntry {
  type: "tool_result";
  message?: { content?: Array<{ type: string; text?: string }> };
}

interface UserEntry {
  type: "user";
  timestamp?: string;
  message?: { content?: string | Array<{ type: string; text?: string }> };
}

type TranscriptEntry =
  | AssistantEntry
  | ThinkingEntry
  | ToolResultEntry
  | UserEntry
  | { type: string; timestamp?: string };

interface WatcherRecord {
  watcher: FSWatcher;
  offset: number;
  jsonl: string;
}

const watchers = new Map<number, WatcherRecord>();

/**
 * Per-topic minimum-spacing send queue. Telegram allows ~1 message/sec to
 * a chat (groups stricter on bursts). We spread messages out + respect
 * 429 retry-after.
 */
const sendQueues = new Map<number, Promise<void>>();
const cooldownUntil = new Map<number, number>();

const MIN_GAP_MS = 1100;

async function enqueueSend(
  bot: Bot,
  chatId: number,
  topicId: number,
  text: string,
  parseMode: "MarkdownV2" | undefined
): Promise<void> {
  const prev = sendQueues.get(topicId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const cool = cooldownUntil.get(topicId) ?? 0;
    const waitMs = Math.max(0, cool - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    try {
      await bot.api.sendMessage(chatId, text, {
        message_thread_id: topicId,
        parse_mode: parseMode,
      });
      await sleep(MIN_GAP_MS);
    } catch (err) {
      const e = err as { error_code?: number; parameters?: { retry_after?: number } };
      if (e.error_code === 429) {
        const retry = e.parameters?.retry_after ?? 30;
        cooldownUntil.set(topicId, Date.now() + (retry + 1) * 1000);
        // Drop this message rather than queue forever — the user can /snap
        // or wait for fresh entries.
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[telegram/claude] send failed:", msg);
    }
  });
  sendQueues.set(topicId, next);
  return next;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

/**
 * Claude Code stores transcripts under
 * `~/.claude/projects/<cwd-with-slashes-as-dashes>/<sessionId>.jsonl`.
 * For `/home/agent/code/foo` the directory is `-home-agent-code-foo`.
 */
function projectDirForCwd(cwd: string): string {
  const transformed = cwd.replace(/[\\/]/g, "-");
  return path.join(PROJECTS_DIR, transformed);
}

interface JsonlCandidate {
  path: string;
  ctimeMs: number;
  mtimeMs: number;
}

interface JsonlMatch {
  path: string;
  offset?: number;
}

interface PromptMatch {
  timestampMs: number;
  offset: number;
}

function listJsonlIn(dir: string): JsonlCandidate[] {
  if (!fs.existsSync(dir)) return [];
  const out: JsonlCandidate[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const p = path.join(dir, name);
    try {
      const s = fs.statSync(p);
      const ctime = s.birthtimeMs && s.birthtimeMs > 0 ? s.birthtimeMs : s.ctimeMs;
      out.push({ path: p, ctimeMs: ctime, mtimeMs: s.mtimeMs });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

function claimedJsonls(skipTopicId?: number): Set<string> {
  const set = new Set<string>();
  for (const [tid, rec] of watchers.entries()) {
    if (tid === skipTopicId) continue;
    set.add(rec.jsonl);
  }
  return set;
}

/**
 * JSONLs this topic must never tail: ones with a running watcher owned by
 * another topic AND ones merely *bound* on disk by another topic. At boot
 * the watchers map fills in one topic at a time, so an in-memory check
 * alone races with the resume loop — a topic resolving fresh could grab a
 * sibling topic's file before its watcher has been registered.
 */
function excludedJsonls(skipTopicId?: number): Set<string> {
  const set = claimedJsonls(skipTopicId);
  for (const t of listTopics()) {
    if (t.topicId === skipTopicId) continue;
    if (t.jsonlPath) set.add(t.jsonlPath);
  }
  return set;
}

function normalizePrompt(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function userText(entry: TranscriptEntry): string | null {
  if (entry.type !== "user") return null;
  const content = (entry as UserEntry).message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n");
    return text || null;
  }
  return null;
}

function findPromptMatch(jsonl: string, promptText: string, sinceMs: number): PromptMatch | null {
  const expected = normalizePrompt(promptText);
  if (!expected) return null;

  try {
    const stat = fs.statSync(jsonl);
    const scanBytes = Math.min(stat.size, 2 * 1024 * 1024);
    const start = stat.size - scanBytes;
    const fd = fs.openSync(jsonl, "r");
    const buf = Buffer.alloc(scanBytes);
    fs.readSync(fd, buf, 0, scanBytes, start);
    fs.closeSync(fd);

    let offset = start;
    let best: PromptMatch | null = null;
    const lines = buf.toString("utf-8").split("\n");
    for (const line of lines) {
      const lineBytes = Buffer.byteLength(line + "\n");
      const nextOffset = offset + lineBytes;
      offset = nextOffset;
      if (!line) continue;

      let entry: TranscriptEntry;
      try {
        entry = JSON.parse(line) as TranscriptEntry;
      } catch {
        continue;
      }

      const text = userText(entry);
      if (text === null || normalizePrompt(text) !== expected) continue;

      const timestamp = (entry as { timestamp?: string }).timestamp;
      const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN;
      if (Number.isFinite(timestampMs) && timestampMs + 30_000 < sinceMs) continue;
      const match = {
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : stat.mtimeMs,
        offset: nextOffset,
      };
      if (!best || Math.abs(match.timestampMs - sinceMs) < Math.abs(best.timestampMs - sinceMs)) {
        best = match;
      }
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Find the JSONL that belongs to a specific tmux session. We narrow to
 * the project directory derived from the session's cwd, exclude JSONLs
 * already claimed by other topics, and pick the one whose ctime is just
 * after `sinceMs` (claude writes the first line within milliseconds of
 * starting). If that match is ambiguous, do not guess: a missing Telegram
 * transcript is safer than sending one session's answer into another topic.
 */
function resolveJsonlForSession(opts: {
  cwd: string;
  sinceMs: number;
  exclude: Set<string>;
  promptText?: string;
}): JsonlMatch | null {
  const { cwd, sinceMs, exclude, promptText } = opts;
  const dir = projectDirForCwd(cwd);
  const candidates = listJsonlIn(dir).filter((c) => !exclude.has(c.path));
  if (candidates.length === 0) return null;

  if (promptText) {
    const promptMatches = candidates
      .map((candidate) => {
        const match = findPromptMatch(candidate.path, promptText, sinceMs);
        return match ? { candidate, match } : null;
      })
      .filter((match): match is { candidate: JsonlCandidate; match: PromptMatch } => !!match)
      .sort(
        (a, b) =>
          Math.abs(a.match.timestampMs - sinceMs) - Math.abs(b.match.timestampMs - sinceMs) ||
          a.candidate.ctimeMs - b.candidate.ctimeMs
      );

    if (promptMatches.length > 0) {
      const best = promptMatches[0]!;
      return { path: best.candidate.path, offset: best.match.offset };
    }
  }

  // Allow a few seconds of clock skew between tmux and the file system,
  // but require the transcript to appear shortly after the session/CLI was
  // observed. Long-lived topics in the same cwd may have many Claude JSONLs.
  const grace = 5000;
  const maxStartLag = 60_000;
  const created = candidates
    .filter((c) => c.ctimeMs + grace >= sinceMs && c.ctimeMs <= sinceMs + maxStartLag)
    .sort(
      (a, b) =>
        Math.abs(a.ctimeMs - sinceMs) - Math.abs(b.ctimeMs - sinceMs) || a.ctimeMs - b.ctimeMs
    );
  if (created.length > 0) return { path: created[0]!.path };
  return candidates.length === 1 ? { path: candidates[0]!.path } : null;
}

export function findJsonlForSession(opts: {
  cwd: string;
  sinceMs: number;
  exclude: Set<string>;
  promptText?: string;
}): string | null {
  return resolveJsonlForSession(opts)?.path ?? null;
}

function renderEntry(entry: TranscriptEntry): string | null {
  // chat mode = "Claude's reply only" — skip tool_use, tool_result, and
  // thinking blocks. The user can /view screen or look at the web UI for
  // the full play-by-play.
  if (entry.type === "assistant") {
    const e = entry as AssistantEntry;
    const parts = e.message?.content ?? [];
    const text = parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => escapeMarkdownV2(p.text!))
      .join("\n\n");
    return text || null;
  }
  return null;
}

export interface StartTranscriptOpts {
  /** tmux pane cwd — used to narrow JSONL search to one project dir. */
  cwd?: string;
  /** Unix ms for either tmux session creation or the Telegram prompt send. */
  sinceMs?: number;
  /** Prompt text to match against Claude's user transcript entries. */
  promptText?: string;
  /** Resume from a previously-stored path (skip rediscovery). */
  persistedJsonl?: string;
  /** Resume byte offset — skip replaying entries we've already sent. */
  initialOffset?: number;
}

/**
 * Tail a JSONL transcript and forward each new entry as a topic message.
 * The JSONL is identified per-session: each topic gets its own file,
 * matched by `cwd + sinceMs`, with already-claimed files excluded so two
 * topics in the same project never tail the same JSONL.
 *
 * Returns null if no candidate JSONL is found yet — callers (the streamer's
 * 5 s flush loop) will retry on the next tick, by which time claude will
 * have written its first line.
 */
export function startClaudeTranscript(
  bot: Bot,
  chatId: number,
  topicId: number,
  opts: StartTranscriptOpts = {}
): { stop: () => void; jsonl: string } | null {
  // If this topic already has a watcher, don't double-start — caller
  // should have stopped it first if they meant to swap.
  if (watchers.has(topicId)) return null;

  let match: JsonlMatch | null = null;
  if (opts.cwd && typeof opts.sinceMs === "number" && opts.promptText) {
    match = resolveJsonlForSession({
      cwd: opts.cwd,
      sinceMs: opts.sinceMs,
      exclude: excludedJsonls(topicId),
      promptText: opts.promptText,
    });
  }
  if (!match) {
    if (
      opts.persistedJsonl &&
      fs.existsSync(opts.persistedJsonl) &&
      !excludedJsonls(topicId).has(opts.persistedJsonl)
    ) {
      match = { path: opts.persistedJsonl };
    } else if (opts.cwd && typeof opts.sinceMs === "number") {
      match = resolveJsonlForSession({
        cwd: opts.cwd,
        sinceMs: opts.sinceMs,
        exclude: excludedJsonls(topicId),
      });
    }
  }
  if (!match) return null;

  const jsonl = match.path;

  let offset: number;
  if (opts.initialOffset && opts.initialOffset > 0) {
    offset = opts.initialOffset;
  } else if (typeof match.offset === "number") {
    offset = match.offset;
  } else {
    // Start at EOF — only forward entries written from now on.
    try {
      offset = fs.statSync(jsonl).size;
    } catch {
      offset = 0;
    }
  }

  const flush = async () => {
    try {
      const stat = fs.statSync(jsonl!);
      if (stat.size < offset) {
        offset = 0; // file was rotated/truncated
      }
      if (stat.size === offset) return;
      const fd = fs.openSync(jsonl!, "r");
      const buf = Buffer.alloc(stat.size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      offset = stat.size;
      const lines = buf.toString("utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        let entry: TranscriptEntry;
        try {
          entry = JSON.parse(line) as TranscriptEntry;
        } catch {
          continue;
        }
        const md = renderEntry(entry);
        if (!md) continue;
        await enqueueSend(bot, chatId, topicId, md, "MarkdownV2");
      }
    } catch (err) {
      console.error("[telegram/claude] flush failed", err);
    }
  };

  const watcher = watch(jsonl, { ignoreInitial: true });
  watcher.on("change", () => void flush());
  watcher.on("add", () => void flush());

  watchers.set(topicId, { watcher, offset, jsonl });
  // First flush picks up any tail since the persisted offset.
  void flush();
  return {
    jsonl,
    stop: () => {
      void watcher.close();
      watchers.delete(topicId);
    },
  };
}

/**
 * When Claude Code is restarted inside the same tmux session — the user
 * typed `/exit` or hit Ctrl-D and ran `claude` again — it starts a new
 * session id and therefore writes to a brand-new JSONL file. The bound
 * one is left frozen, and a watcher still tailing it silently black-holes
 * every later assistant message.
 *
 * The project dir is shared by EVERY claude session with the same cwd —
 * including sessions that belong to other topics or to no topic at all —
 * so "a newer, recently-active sibling exists" is NOT enough to rotate:
 * that heuristic steals unrelated sessions' transcripts and cross-routes
 * their replies into this topic. Rotation therefore requires hard restart
 * evidence tied to this topic's own pane:
 *
 *  1. a `claude` process is running on the pane's tty (claudeStartMs),
 *  2. it started AFTER the bound file's last write — i.e. the bound file
 *     cannot be the current process's transcript,
 *  3. the candidate was created after that process started (with a small
 *     clock-skew grace), so it is a file this process could have written,
 *  4. the candidate is unambiguous — if several siblings qualify we refuse
 *     to guess.
 *
 * Returns the replacement path, or null when the bound file still looks
 * live or the evidence is ambiguous. Conservative on purpose — a false
 * rotation is far worse than a missed one (the user can re-tap /sessions).
 */
export function findLiveReplacementJsonl(
  topicId: number,
  currentJsonlPath: string,
  claudeStartMs: number | null
): string | null {
  const STALE_GAP_MS = 60_000;
  const RECENT_ACTIVITY_MS = 5 * 60 * 1000;
  const CTIME_GRACE_MS = 5000;
  // No claude process on this topic's pane → the bound file froze because
  // the session ended, not because of a restart. Never rotate.
  if (claudeStartMs === null) return null;
  let boundMtime: number;
  try {
    boundMtime = fs.statSync(currentJsonlPath).mtimeMs;
  } catch {
    return null;
  }
  // The bound file was written after the current claude started → it is
  // (or plausibly was) this very process's transcript. No restart happened;
  // a newer sibling can only belong to someone else.
  if (claudeStartMs <= boundMtime) return null;
  const now = Date.now();
  const dir = path.dirname(currentJsonlPath);
  const exclude = excludedJsonls(topicId);
  const candidates: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".jsonl")) continue;
      const p = path.join(dir, entry);
      if (p === currentJsonlPath || exclude.has(p)) continue;
      try {
        const s = fs.statSync(p);
        const ctime = s.birthtimeMs && s.birthtimeMs > 0 ? s.birthtimeMs : s.ctimeMs;
        if (
          ctime >= claudeStartMs - CTIME_GRACE_MS &&
          s.mtimeMs > boundMtime + STALE_GAP_MS &&
          now - s.mtimeMs < RECENT_ACTIVITY_MS
        ) {
          candidates.push(p);
        }
      } catch {
        /* skip unreadable */
      }
    }
  } catch {
    /* skip unreadable dir */
  }
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length > 1) {
    console.error(
      `[telegram/claude] topic ${topicId}: ${candidates.length} JSONLs created since claude restart — ambiguous, not rotating`
    );
  }
  return null;
}

export function stopClaudeTranscript(topicId: number): void {
  const w = watchers.get(topicId);
  if (!w) return;
  void w.watcher.close();
  watchers.delete(topicId);
}

/** Idempotent — start the watcher only if one isn't already running. */
export function isClaudeTranscriptRunning(topicId: number): boolean {
  return watchers.has(topicId);
}

export function stopAllClaudeTranscripts(): void {
  for (const w of watchers.values()) void w.watcher.close();
  watchers.clear();
}

/**
 * Read a topic's own JSONL transcript backwards and return the last
 * assistant text entry, MarkdownV2-escaped.
 *
 * Caps the scan at the last 256 KB so we don't read 100 MB to find a
 * quote.
 */
export function readLastAssistantText(jsonlPath?: string): string | null {
  const jsonl = jsonlPath && fs.existsSync(jsonlPath) ? jsonlPath : null;
  if (!jsonl) return null;
  try {
    const stat = fs.statSync(jsonl);
    const tailBytes = Math.min(stat.size, 256 * 1024);
    const start = stat.size - tailBytes;
    const fd = fs.openSync(jsonl, "r");
    const buf = Buffer.alloc(tailBytes);
    fs.readSync(fd, buf, 0, tailBytes, start);
    fs.closeSync(fd);
    const lines = buf.toString("utf-8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]!) as TranscriptEntry;
        const md = renderEntry(entry);
        if (md) return md;
      } catch {
        /* skip non-JSON line */
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

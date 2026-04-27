import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Bot } from "grammy";
import { watch, FSWatcher } from "chokidar";
import { escapeMarkdownV2 } from "./render";

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

type TranscriptEntry = AssistantEntry | ThinkingEntry | ToolResultEntry | { type: string };

const watchers = new Map<number, { watcher: FSWatcher; offset: number; jsonl: string }>();

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

/** Find the most recently modified JSONL anywhere under ~/.claude/projects/. */
function findLatestJsonl(): string | null {
  if (!fs.existsSync(PROJECTS_DIR)) return null;
  let latest: { p: string; mtime: number } | null = null;
  for (const dir of fs.readdirSync(PROJECTS_DIR)) {
    const full = path.join(PROJECTS_DIR, dir);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    for (const name of fs.readdirSync(full)) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(full, name);
      try {
        const fstat = fs.statSync(file);
        if (!latest || fstat.mtimeMs > latest.mtime) {
          latest = { p: file, mtime: fstat.mtimeMs };
        }
      } catch {
        // skip
      }
    }
  }
  return latest?.p ?? null;
}

function renderEntry(entry: TranscriptEntry): string | null {
  if (entry.type === "assistant") {
    const e = entry as AssistantEntry;
    const parts = e.message?.content ?? [];
    const out: string[] = [];
    for (const p of parts) {
      if (p.type === "text" && p.text) out.push(escapeMarkdownV2(p.text));
      if (p.type === "tool_use") {
        const args = p.input ? JSON.stringify(p.input).slice(0, 400) : "";
        out.push(`🔧 *${escapeMarkdownV2(p.name ?? "tool")}*\n\`\`\`\n${args}\n\`\`\``);
      }
    }
    return out.join("\n\n") || null;
  }
  if (entry.type === "thinking") {
    const e = entry as ThinkingEntry;
    const text = e.message?.content?.find((c) => c.type === "thinking")?.text ?? "";
    if (!text) return null;
    // MarkdownV2 expandable blockquote: each line prefixed with `**>` on first, `>` after.
    const lines = escapeMarkdownV2(text)
      .split("\n")
      .map((l, i) => (i === 0 ? `**>${l}` : `>${l}`))
      .join("\n");
    return lines + "||";
  }
  if (entry.type === "tool_result") {
    const e = entry as ToolResultEntry;
    const text = e.message?.content?.find((c) => c.type === "text")?.text ?? "";
    if (!text) return null;
    const truncated = text.length > 400 ? text.slice(0, 400) + "…" : text;
    return `↳ \`\`\`\n${truncated}\n\`\`\``;
  }
  return null;
}

/**
 * Tail a JSONL transcript and forward each new entry as a topic message.
 * For v1 we use the most-recently-modified JSONL globally — works for the
 * common case of one active claude session.
 */
export function startClaudeTranscript(
  bot: Bot,
  chatId: number,
  topicId: number,
  initialOffset = 0
): { stop: () => void; jsonl: string } | null {
  const jsonl = findLatestJsonl();
  if (!jsonl) return null;

  let offset = initialOffset || 0;
  const flush = async () => {
    try {
      const stat = fs.statSync(jsonl);
      if (stat.size < offset) {
        offset = 0; // file was rotated/truncated
      }
      if (stat.size === offset) return;
      const fd = fs.openSync(jsonl, "r");
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
        try {
          await bot.api.sendMessage(chatId, md, {
            parse_mode: "MarkdownV2",
            message_thread_id: topicId,
          });
        } catch (err) {
          console.error("[telegram/claude] send failed", err);
        }
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

export function stopClaudeTranscript(topicId: number): void {
  const w = watchers.get(topicId);
  if (!w) return;
  void w.watcher.close();
  watchers.delete(topicId);
}

export function stopAllClaudeTranscripts(): void {
  for (const w of watchers.values()) void w.watcher.close();
  watchers.clear();
}

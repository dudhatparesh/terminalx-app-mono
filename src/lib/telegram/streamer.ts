import { execFileSync } from "child_process";
import type { Bot } from "grammy";
import { hasSession, capturePaneHistory } from "@/lib/tmux";
import { asCodeBlock } from "./render";
import { attachedKeyboard } from "./keyboard";
import { getTopic, listTopics, patchTopic, deleteTopic, getForumChatId } from "./state";

const FLUSH_INTERVAL_MS = 5000;
const TMUX = "tmux";

/**
 * Per-topic streamer state — kept in-process; persisted bits (pinnedMsgId,
 * jsonlOffset) live in `state.ts`.
 */
interface RuntimeState {
  topicId: number;
  flushTimer: NodeJS.Timeout;
  flushBusy: boolean;
  lastRendered: string;
  lastFlushAt: number;
}

const runtimes = new Map<number, RuntimeState>();

function tmuxSend(sessionName: string, args: string[]): void {
  try {
    execFileSync(TMUX, ["send-keys", "-t", sessionName, ...args], { timeout: 2000 });
  } catch (err) {
    console.error("[telegram/streamer] send-keys failed", err);
  }
}

/** Send a literal string (handles all printable chars, no key parsing). */
export function sendText(sessionName: string, text: string, withEnter = true): void {
  tmuxSend(sessionName, ["-l", text]);
  if (withEnter) tmuxSend(sessionName, ["Enter"]);
}

/** Send a named key sequence (Tab, Enter, C-c, C-d, Up, Down, Left, Right). */
export function sendKey(sessionName: string, key: string): void {
  tmuxSend(sessionName, [key]);
}

/**
 * Page through tmux's copy-mode scrollback. action: "up" | "down" | "cancel".
 * Mirrors the WS scroll handler in `server/index.ts` so behaviour matches the web.
 */
export function scroll(sessionName: string, action: "up" | "down" | "cancel"): void {
  try {
    if (action === "cancel") {
      execFileSync(TMUX, ["send-keys", "-t", sessionName, "-X", "cancel"], { timeout: 2000 });
      return;
    }
    execFileSync(TMUX, ["copy-mode", "-t", sessionName], { timeout: 2000 });
    const cmd = action === "up" ? "page-up" : "page-down";
    execFileSync(TMUX, ["send-keys", "-t", sessionName, "-X", cmd], { timeout: 2000 });
  } catch (err) {
    console.error("[telegram/streamer] scroll failed", err);
  }
}

/**
 * Render the live screen for a topic and edit the pinned message. If the
 * pinned message has been deleted by the user (or never existed), send a
 * fresh one and store the new id.
 */
async function renderAndFlush(bot: Bot, topicId: number): Promise<void> {
  const rt = runtimes.get(topicId);
  if (!rt || rt.flushBusy) return;
  const binding = getTopic(topicId);
  const chatId = getForumChatId();
  if (!binding || !chatId) return;

  // Detach if the tmux session vanished (user typed `exit`, or it crashed).
  if (!hasSession(binding.sessionName)) {
    await stopStreamer(topicId);
    try {
      await bot.api.sendMessage(chatId, "session ended.", {
        message_thread_id: topicId,
      });
      await bot.api.closeForumTopic(chatId, topicId);
    } catch {
      // ignore — topic may already be closed
    }
    await deleteTopic(topicId);
    return;
  }

  rt.flushBusy = true;
  try {
    const ansi = capturePaneHistory(binding.sessionName, 50);
    if (!ansi) return;
    const rendered = asCodeBlock(ansi);
    if (rendered === rt.lastRendered) return;

    const tryEdit = async (msgId: number) => {
      await bot.api.editMessageText(chatId, msgId, rendered, {
        parse_mode: "MarkdownV2",
        reply_markup: attachedKeyboard(),
      });
    };

    if (binding.pinnedMsgId) {
      try {
        await tryEdit(binding.pinnedMsgId);
        rt.lastRendered = rendered;
        rt.lastFlushAt = Date.now();
        return;
      } catch (err) {
        const desc = String((err as { description?: string })?.description ?? err);
        if (desc.includes("message is not modified")) {
          rt.lastRendered = rendered;
          return;
        }
        // fall through to send a new pinned message
      }
    }

    const sent = await bot.api.sendMessage(chatId, rendered, {
      parse_mode: "MarkdownV2",
      message_thread_id: topicId,
      reply_markup: attachedKeyboard(),
    });
    await patchTopic(topicId, { pinnedMsgId: sent.message_id });
    rt.lastRendered = rendered;
    rt.lastFlushAt = Date.now();
  } catch (err) {
    console.error("[telegram/streamer] flush failed", err);
  } finally {
    rt.flushBusy = false;
  }
}

/** Start (or restart) the 5s flush timer for a topic. */
export function startStreamer(bot: Bot, topicId: number): void {
  stopStreamerSync(topicId);
  const rt: RuntimeState = {
    topicId,
    flushBusy: false,
    lastRendered: "",
    lastFlushAt: 0,
    flushTimer: setInterval(() => {
      void renderAndFlush(bot, topicId);
    }, FLUSH_INTERVAL_MS),
  };
  runtimes.set(topicId, rt);
  // Fire the first flush right away so the user sees something <5s.
  void renderAndFlush(bot, topicId);
}

/** Force a flush now (used by `/snap` and after key/scroll input). */
export function snap(bot: Bot, topicId: number): void {
  void renderAndFlush(bot, topicId);
}

function stopStreamerSync(topicId: number): void {
  const rt = runtimes.get(topicId);
  if (!rt) return;
  clearInterval(rt.flushTimer);
  runtimes.delete(topicId);
}

export async function stopStreamer(topicId: number): Promise<void> {
  stopStreamerSync(topicId);
}

/** Clean shutdown — used from the server SIGTERM/SIGINT handler. */
export function stopAllStreamers(): void {
  for (const rt of runtimes.values()) clearInterval(rt.flushTimer);
  runtimes.clear();
}

/** Restart streamers for every persisted topic — called on bot startup. */
export function resumePersistedStreamers(bot: Bot): void {
  for (const t of listTopics()) startStreamer(bot, t.topicId);
}

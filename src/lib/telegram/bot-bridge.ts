import type { BotIdentity } from "./auth";
import type { ViewMode } from "./state";
import type { EnsureTopicResult } from "./bot";

/**
 * The Telegram bot — and the streamers / transcripts it spawns — lives in the
 * custom `tsx server` module graph. The Next.js API routes run in a separately
 * bundled graph where that `bot` is null. If a web-initiated attach ran its own
 * copy of `ensureTopicForSession`, the streamer would be owned by the Next.js
 * graph: it would use a throwaway `Bot`, and Telegram-side controls (/detach,
 * /view, /kill) handled by the server graph could not stop it.
 *
 * To keep a single owner, the server registers its real implementation here at
 * startup and the API route prefers it, so web attaches execute in the bot
 * instance. Both graphs run in one Node process and therefore share globalThis,
 * which is the only state these helpers touch.
 */
export type EnsureTopicFn = (
  identity: BotIdentity,
  sessionName: string,
  viewMode?: ViewMode
) => Promise<EnsureTopicResult>;

const KEY = "__terminalxEnsureTopic";

type BridgeHost = typeof globalThis & { [KEY]?: EnsureTopicFn };

/** Called once by the custom server after the bot starts. */
export function registerEnsureTopic(fn: EnsureTopicFn): void {
  (globalThis as BridgeHost)[KEY] = fn;
}

/** Returns the bot instance's implementation, or undefined when unbridged. */
export function getEnsureTopic(): EnsureTopicFn | undefined {
  return (globalThis as BridgeHost)[KEY];
}

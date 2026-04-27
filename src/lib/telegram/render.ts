/**
 * Output rendering helpers shared between live-screen flushes and
 * Claude transcript messages.
 *
 * Patterns ported from ccbot's `terminal_parser.py` + `telegram_sender.py`.
 */

const TELEGRAM_MAX = 4096;

/**
 * Strip ANSI / VT escape sequences from a string. Covers CSI (`ESC [ ...`),
 * OSC (`ESC ] ... BEL` or `ESC ] ... ST`), and standalone single-char
 * controls. Bytes outside printable / whitespace get dropped too.
 */
export function stripAnsi(input: string): string {
  // CSI: ESC [ <params> <intermediates> <final-byte 0x40-0x7E>
  // OSC: ESC ] <params> (BEL | ESC \)
  // Plus a few short standalone escapes we want to drop.
  return input
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[PX^_][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[=>78cDEFHM]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/**
 * Escape a string so it's safe inside Telegram MarkdownV2 outside any
 * formatting context. Per the Bot API docs the special chars are:
 *
 *   _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * Plus the escape char itself.
 */
export function escapeMarkdownV2(input: string): string {
  return input.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

/**
 * Escape only what's dangerous *inside* a fenced code block. Inside ``` ```
 * blocks Telegram only treats the backtick and backslash as special.
 */
export function escapeMarkdownV2Code(input: string): string {
  return input.replace(/[`\\]/g, (c) => `\\${c}`);
}

/**
 * Wrap a chunk of plain text as a MarkdownV2 fenced code block. Truncates
 * to fit Telegram's 4096-char message limit, keeping the *latest* content
 * (typical use is "tail of terminal output").
 */
export function asCodeBlock(text: string, max = 3500): string {
  const sliced = text.length > max ? text.slice(text.length - max) : text;
  return "```\n" + escapeMarkdownV2Code(sliced) + "\n```";
}

/**
 * Split a MarkdownV2-formatted message into ≤4096-char chunks, preferring
 * newline boundaries and re-opening / closing code fences across splits so
 * each chunk is independently valid.
 */
export function splitForTelegram(text: string, max = TELEGRAM_MAX): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let buf = "";
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("```")) inFence = !inFence;
    const candidate = buf ? buf + "\n" + line : line;
    if (candidate.length + (inFence ? 4 : 0) > max) {
      // Flush buffer; close fence if we're mid-fence so the chunk stays
      // valid, then re-open in the next chunk.
      if (inFence && !buf.endsWith("```")) {
        out.push(buf + "\n```");
        buf = "```\n" + line;
      } else {
        out.push(buf);
        buf = line;
      }
      // Pathologically long single line: hard split.
      while (buf.length > max) {
        out.push(buf.slice(0, max));
        buf = buf.slice(max);
      }
    } else {
      buf = candidate;
    }
  }
  if (buf) out.push(buf);
  return out;
}

import type { InlineKeyboardMarkup } from "grammy/types";
import type { TmuxSession } from "@/lib/tmux";

/**
 * Callback-data prefixes. We keep them short — Telegram caps callback_data
 * at 64 bytes and we sometimes pack a session name in.
 */
export const CB = {
  CTRL_C: "k:^c",
  CTRL_D: "k:^d",
  TAB: "k:tab",
  ENTER: "k:cr",
  UP: "k:up",
  DOWN: "k:dn",
  LEFT: "k:lt",
  RIGHT: "k:rt",
  SCROLL_UP: "s:up",
  SCROLL_DOWN: "s:dn",
  SNAP: "s:snap",
  VIEW: "s:view",
  DETACH: "s:det",
  KILL: "s:kil",
  ATTACH_PREFIX: "a:", // a:<sessionName>
  KILL_PREFIX: "x:", // x:<sessionName>
} as const;

/** Inline keyboard pinned beneath the live-screen message. */
export function attachedKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "^C", callback_data: CB.CTRL_C },
        { text: "^D", callback_data: CB.CTRL_D },
        { text: "Tab", callback_data: CB.TAB },
        { text: "↵", callback_data: CB.ENTER },
      ],
      [
        { text: "↑", callback_data: CB.UP },
        { text: "↓", callback_data: CB.DOWN },
        { text: "←", callback_data: CB.LEFT },
        { text: "→", callback_data: CB.RIGHT },
      ],
      [
        { text: "⬆ scroll", callback_data: CB.SCROLL_UP },
        { text: "⬇ scroll", callback_data: CB.SCROLL_DOWN },
        { text: "snap", callback_data: CB.SNAP },
      ],
      [
        { text: "toggle view", callback_data: CB.VIEW },
        { text: "detach", callback_data: CB.DETACH },
        { text: "kill", callback_data: CB.KILL },
      ],
    ],
  };
}

/** Session list keyboard for /sessions in the General topic. */
export function sessionsKeyboard(sessions: TmuxSession[]): InlineKeyboardMarkup {
  const rows = sessions.map((s) => [
    {
      text: `📎 ${s.name}${s.attached ? " · live" : ""}`,
      callback_data: `${CB.ATTACH_PREFIX}${s.name}`,
    },
    {
      text: "✕",
      callback_data: `${CB.KILL_PREFIX}${s.name}`,
    },
  ]);
  return { inline_keyboard: rows };
}

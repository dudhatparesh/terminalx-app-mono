import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileSync = vi.fn();

vi.mock("child_process", () => ({
  execFileSync,
}));

describe("telegram streamer input", () => {
  beforeEach(() => {
    execFileSync.mockReset();
  });

  it("sends generic Telegram text followed by Enter to the exact tmux session", async () => {
    const { sendText } = await import("@/lib/telegram/streamer");

    sendText("shell-a", "hello shell", true);

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      "tmux",
      ["send-keys", "-t", "=shell-a:", "-l", "hello shell"],
      { timeout: 2000 }
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "tmux",
      ["send-keys", "-t", "=shell-a:", "Enter"],
      { timeout: 2000 }
    );
  });

  it("submits Codex Telegram text with Ctrl-M instead of Enter", async () => {
    const { sendCodexText } = await import("@/lib/telegram/streamer");

    sendCodexText("codex-a", "hello codex");

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      "tmux",
      ["send-keys", "-t", "=codex-a:", "-l", "hello codex"],
      { timeout: 2000 }
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "tmux",
      ["send-keys", "-t", "=codex-a:", "C-m"],
      { timeout: 2000 }
    );
  });
});

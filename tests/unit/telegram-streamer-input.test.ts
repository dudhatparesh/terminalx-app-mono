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
    execFileSync.mockReturnValueOnce("idle prompt");

    await sendCodexText("codex-a", "hello codex");

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      "tmux",
      ["capture-pane", "-p", "-e", "-J", "-t", "=codex-a:"],
      { encoding: "utf-8", timeout: 5000, maxBuffer: 4 * 1024 * 1024 }
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "tmux",
      ["send-keys", "-t", "=codex-a:", "-l", "hello codex"],
      { timeout: 2000 }
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      3,
      "tmux",
      ["send-keys", "-t", "=codex-a:", "C-m"],
      { timeout: 2000 }
    );
  });

  it("queues Codex Telegram text with Tab while Codex is working", async () => {
    const { sendCodexText } = await import("@/lib/telegram/streamer");
    execFileSync.mockReturnValueOnce("Working (12s - esc to interrupt)");

    await sendCodexText("codex-a", "follow up");

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      "tmux",
      ["capture-pane", "-p", "-e", "-J", "-t", "=codex-a:"],
      { encoding: "utf-8", timeout: 5000, maxBuffer: 4 * 1024 * 1024 }
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "tmux",
      ["send-keys", "-t", "=codex-a:", "-l", "follow up"],
      { timeout: 2000 }
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      3,
      "tmux",
      ["send-keys", "-t", "=codex-a:", "Tab"],
      { timeout: 2000 }
    );
  });
});

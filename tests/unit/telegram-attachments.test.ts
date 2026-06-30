import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Bot } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("telegram attachment forwarding", () => {
  let root: string;
  let oldRoot: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "terminalx-tg-attachments-"));
    oldRoot = process.env.TERMINUS_ROOT;
    process.env.TERMINUS_ROOT = root;
  });

  afterEach(() => {
    if (oldRoot === undefined) {
      delete process.env.TERMINUS_ROOT;
    } else {
      process.env.TERMINUS_ROOT = oldRoot;
    }
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("extracts local image and document references but ignores URLs", async () => {
    const { extractTelegramAttachmentPaths } = await import("@/lib/telegram/attachments");

    expect(
      extractTelegramAttachmentPaths(
        [
          "screenshot: ![preview](artifacts/screen.png)",
          'document: [brief](docs/report.pdf "Quarterly report")',
          "notes: `docs/notes.md`",
          "external: https://example.com/image.png",
        ].join("\n")
      )
    ).toEqual(["artifacts/screen.png", "docs/report.pdf", "docs/notes.md"]);
  });

  it("sends referenced images as photos and docs as documents from the session cwd", async () => {
    const cwd = path.join(root, "workspace");
    fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "screen.png"), "png");
    fs.writeFileSync(path.join(cwd, "docs", "report.pdf"), "pdf");

    const bot = {
      api: {
        sendPhoto: vi.fn().mockResolvedValue({}),
        sendDocument: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Bot;
    const { sendReferencedAttachments } = await import("@/lib/telegram/attachments");

    const count = await sendReferencedAttachments(
      bot,
      10,
      20,
      "Done: `screen.png` and [report](docs/report.pdf)",
      { baseDir: cwd }
    );

    expect(count).toBe(2);
    expect(bot.api.sendPhoto).toHaveBeenCalledWith(
      10,
      expect.anything(),
      expect.objectContaining({ message_thread_id: 20, caption: "workspace/screen.png" })
    );
    expect(bot.api.sendDocument).toHaveBeenCalledWith(
      10,
      expect.anything(),
      expect.objectContaining({ message_thread_id: 20, caption: "workspace/docs/report.pdf" })
    );
  });

  it("deduplicates repeated paths and does not send missing files", async () => {
    const cwd = path.join(root, "workspace");
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(cwd, "screen.png"), "png");

    const bot = {
      api: {
        sendPhoto: vi.fn().mockResolvedValue({}),
        sendDocument: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Bot;
    const { sendReferencedAttachments } = await import("@/lib/telegram/attachments");

    const count = await sendReferencedAttachments(
      bot,
      10,
      20,
      "See `screen.png`, screen.png, and missing.pdf",
      { baseDir: cwd }
    );

    expect(count).toBe(1);
    expect(bot.api.sendPhoto).toHaveBeenCalledTimes(1);
    expect(bot.api.sendDocument).not.toHaveBeenCalled();
  });
});

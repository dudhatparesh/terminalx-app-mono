import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { forumTopicExists } from "@/lib/telegram/topic-health";

function mockBot(reopen: (chatId: number, topicId: number) => Promise<unknown>): Bot {
  return { api: { reopenForumTopic: vi.fn(reopen) } } as unknown as Bot;
}

describe("forumTopicExists", () => {
  it("returns true when the topic reopens cleanly (existed, was closed)", async () => {
    const b = mockBot(async () => true);
    expect(await forumTopicExists(b, -100, 42)).toBe(true);
  });

  it("returns true when Telegram replies TOPIC_NOT_MODIFIED (already open)", async () => {
    const b = mockBot(async () => {
      throw { description: "Bad Request: TOPIC_NOT_MODIFIED" };
    });
    expect(await forumTopicExists(b, -100, 42)).toBe(true);
  });

  it("returns false when the topic id is invalid (deleted in Telegram)", async () => {
    const b = mockBot(async () => {
      throw { description: "Bad Request: TOPIC_ID_INVALID" };
    });
    expect(await forumTopicExists(b, -100, 42)).toBe(false);
  });

  it("returns false on 'message thread not found'", async () => {
    const b = mockBot(async () => {
      throw new Error("Call to 'sendMessage' failed! (400: Bad Request: message thread not found)");
    });
    expect(await forumTopicExists(b, -100, 42)).toBe(false);
  });

  it("assumes alive on unknown/transient errors so a live topic is never orphaned", async () => {
    const b = mockBot(async () => {
      throw { description: "Too Many Requests: retry after 5" };
    });
    expect(await forumTopicExists(b, -100, 42)).toBe(true);
  });

  it("forwards the chat id and topic id to reopenForumTopic", async () => {
    const reopen = vi.fn(async () => true);
    const b = mockBot(reopen);
    await forumTopicExists(b, -1003928735866, 632);
    expect(reopen).toHaveBeenCalledWith(-1003928735866, 632);
  });
});

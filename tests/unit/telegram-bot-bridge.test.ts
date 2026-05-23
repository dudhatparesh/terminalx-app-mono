import { describe, it, expect, afterEach } from "vitest";
import { registerEnsureTopic, getEnsureTopic, type EnsureTopicFn } from "@/lib/telegram/bot-bridge";

describe("telegram bot bridge", () => {
  afterEach(() => {
    // The bridge stores its hook on globalThis; clear it between tests.
    delete (globalThis as Record<string, unknown>).__terminalxEnsureTopic;
  });

  it("returns undefined when no implementation is registered", () => {
    expect(getEnsureTopic()).toBeUndefined();
  });

  it("returns the registered implementation and forwards its result", async () => {
    const impl: EnsureTopicFn = async (_identity, sessionName, viewMode) => ({
      topic: {
        topicId: 7,
        sessionName,
        viewMode: viewMode ?? "chat",
        url: `https://t.me/c/1/7`,
        created: true,
      },
    });
    registerEnsureTopic(impl);

    const got = getEnsureTopic();
    expect(got).toBe(impl);

    const result = await got!({ username: "admin", role: "admin" }, "admin-x", "screen");
    expect(result.topic.topicId).toBe(7);
    expect(result.topic.sessionName).toBe("admin-x");
    expect(result.topic.viewMode).toBe("screen");
  });
});

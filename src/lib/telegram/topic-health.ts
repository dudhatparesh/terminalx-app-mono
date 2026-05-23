import type { Bot } from "grammy";

/**
 * Check whether a Telegram forum topic still exists.
 *
 * Telegram's Bot API has no read-only "get forum topic" call, so we probe with
 * `reopenForumTopic`: it is a harmless no-op when the topic is already open
 * (Telegram replies `TOPIC_NOT_MODIFIED`), reopens a closed one — which is what
 * we want when re-attaching — and fails with `TOPIC_ID_INVALID` /
 * `message thread not found` once the topic has been deleted in Telegram.
 *
 * Any other error (transient network failure, rate limit, missing
 * `can_manage_topics`, ...) is treated as "alive" so we never tear down a
 * binding to a real topic and recreate over it.
 */
export async function forumTopicExists(b: Bot, chatId: number, topicId: number): Promise<boolean> {
  try {
    await b.api.reopenForumTopic(chatId, topicId);
    return true;
  } catch (err) {
    const desc = (
      (err as { description?: string })?.description ??
      (err as Error)?.message ??
      ""
    ).toLowerCase();
    if (desc.includes("topic_not_modified")) return true; // already open → exists
    if (desc.includes("topic_id_invalid") || desc.includes("thread not found")) return false;
    return true; // unknown/transient error → assume alive, never orphan a live topic
  }
}

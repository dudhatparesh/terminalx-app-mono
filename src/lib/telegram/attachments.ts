import * as fs from "fs";
import * as path from "path";
import type { Bot } from "grammy";
import { assertNotSensitivePath, resolveSafePath } from "@/lib/file-service";
import { sendFromServer } from "./files";

const ATTACHMENT_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".pdf",
  ".doc",
  ".docx",
  ".odt",
  ".rtf",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".xls",
  ".xlsx",
  ".ods",
  ".ppt",
  ".pptx",
  ".odp",
]);

const EXT_PATTERN =
  "png|jpe?g|gif|webp|bmp|svg|pdf|docx?|odt|rtf|txt|md|markdown|csv|xlsx?|ods|pptx?|odp";
const MARKDOWN_LINK_RE = /!?\[[^\]]*]\(([^)\n]+)\)/g;
const CODE_SPAN_RE = /`([^`\n]+)`/g;
const ANGLE_REF_RE = /<([^>\n]+)>/g;
const BARE_REF_RE = new RegExp(
  `[^\\s<>()\\[\\]{}\`"']+\\.(?:${EXT_PATTERN})(?::\\d+(?::\\d+)?)?[\\],.;:!?)]*`,
  "gi"
);
const MAX_AUTO_ATTACHMENTS = 6;

function isUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function stripMarkdownTitle(value: string): string {
  const match = value.match(/^(.+?)\s+["'][^"']*["']$/);
  return match?.[1]?.trim() ?? value;
}

function stripLineSuffix(value: string): string {
  const match = value.match(/^(.+\.[a-z0-9]{1,12}):\d+(?::\d+)?$/i);
  return match?.[1] ?? value;
}

function normalizeCandidate(raw: string): string | null {
  let candidate = raw.trim();
  if (!candidate) return null;
  candidate = candidate.replace(/^<(.+)>$/, "$1").trim();
  candidate = candidate.replace(/^["'](.+)["']$/, "$1").trim();
  candidate = stripMarkdownTitle(candidate);
  candidate = candidate.replace(/[\],.;:!?)]*$/g, "");
  candidate = stripLineSuffix(candidate);
  if (!candidate || isUrl(candidate)) return null;
  const ext = path.extname(candidate).toLowerCase();
  return ATTACHMENT_EXTS.has(ext) ? candidate : null;
}

function addCandidate(out: string[], seen: Set<string>, raw: string): void {
  const candidate = normalizeCandidate(raw);
  if (!candidate || seen.has(candidate)) return;
  seen.add(candidate);
  out.push(candidate);
}

export function extractTelegramAttachmentPaths(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(MARKDOWN_LINK_RE)) {
    if (match[1]) addCandidate(out, seen, match[1]);
  }
  for (const match of text.matchAll(CODE_SPAN_RE)) {
    if (match[1]) addCandidate(out, seen, match[1]);
  }
  for (const match of text.matchAll(ANGLE_REF_RE)) {
    if (match[1]) addCandidate(out, seen, match[1]);
  }
  for (const match of text.matchAll(BARE_REF_RE)) {
    if (match[0]) addCandidate(out, seen, match[0]);
  }

  return out;
}

function requestPaths(candidate: string, baseDir?: string): string[] {
  if (path.isAbsolute(candidate) || candidate.startsWith("~/")) return [candidate];
  return baseDir ? [path.join(baseDir, candidate), candidate] : [candidate];
}

function resolveExistingFile(requestedPath: string): string | null {
  try {
    const safe = resolveSafePath(requestedPath);
    assertNotSensitivePath(safe);
    return fs.statSync(safe).isFile() ? safe : null;
  } catch {
    return null;
  }
}

export async function sendReferencedAttachments(
  bot: Bot,
  chatId: number,
  topicId: number,
  text: string,
  opts: { baseDir?: string; maxAttachments?: number } = {}
): Promise<number> {
  const maxAttachments = opts.maxAttachments ?? MAX_AUTO_ATTACHMENTS;
  const sent = new Set<string>();
  let count = 0;

  for (const candidate of extractTelegramAttachmentPaths(text)) {
    if (count >= maxAttachments) break;
    for (const requestedPath of requestPaths(candidate, opts.baseDir)) {
      const safe = resolveExistingFile(requestedPath);
      if (!safe || sent.has(safe)) continue;
      try {
        await sendFromServer(bot, chatId, topicId, safe);
        sent.add(safe);
        count++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[telegram/attachments] send failed:", msg);
      }
      break;
    }
  }

  return count;
}

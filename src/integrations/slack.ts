import { WebClient } from "@slack/web-api";
import type { KnownBlock } from "@slack/web-api";
import { slackifyMarkdown } from "slackify-markdown";
import { config } from "../config.js";

const client = new WebClient(config.slack.botToken);

// Slack hard limits: a section's text maxes out at 3000 chars, and a message
// allows up to 50 blocks. We chunk long briefs across multiple section blocks.
const SECTION_CHAR_LIMIT = 2900;

/** Convert GitHub-flavored markdown (what Claude emits) into Slack mrkdwn. */
export function toSlackMarkdown(markdown: string): string {
  return slackifyMarkdown(markdown).trim();
}

/** Split mrkdwn text into <=3000-char chunks, breaking on paragraph boundaries. */
function chunkText(text: string, limit = SECTION_CHAR_LIMIT): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    const candidate = current ? `${current}\n\n${p}` : p;
    if (candidate.length > limit && current) {
      chunks.push(current);
      current = p;
    } else if (candidate.length > limit) {
      // A single paragraph longer than the limit — hard-split it.
      for (let i = 0; i < p.length; i += limit) chunks.push(p.slice(i, i + limit));
      current = "";
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Convert a markdown body into mrkdwn section blocks (no header). */
export function buildSectionBlocks(markdownBody: string): KnownBlock[] {
  return chunkText(toSlackMarkdown(markdownBody)).map((chunk) => ({
    type: "section",
    text: { type: "mrkdwn", text: chunk },
  }));
}

/**
 * Build Block Kit blocks from a title + a markdown body. The title becomes a
 * header block; the body is converted to mrkdwn and split into section blocks.
 */
export function buildBriefBlocks(title: string, markdownBody: string): KnownBlock[] {
  return [
    { type: "header", text: { type: "plain_text", text: title.slice(0, 150), emoji: true } },
    ...buildSectionBlocks(markdownBody),
  ];
}

/** Post a formatted reply into a thread (used by the @mention bot). */
export async function replyInThread(
  channel: string,
  threadTs: string,
  markdownBody: string,
): Promise<void> {
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: markdownBody.slice(0, 200), // notification fallback
    blocks: buildSectionBlocks(markdownBody),
    unfurl_links: false,
    unfurl_media: false,
  });
}

/**
 * A user's timezone as Slack knows it. `tz` is an IANA name (e.g.
 * "Europe/Berlin") set by the user in their Slack profile; `tzOffset` is the
 * current offset from UTC in seconds. This is the BD's own configured zone,
 * which is exactly what we need to compute their local 8am for morning prep.
 */
export interface SlackUserTz {
  tz: string | null; // IANA timezone, e.g. "Europe/Berlin"
  tzLabel: string | null; // human label, e.g. "Central European Time"
  tzOffset: number | null; // seconds from UTC, e.g. 3600
}

/** Read a single user's timezone from their Slack profile. */
export async function getUserTimezone(userId: string): Promise<SlackUserTz> {
  const res = await client.users.info({ user: userId });
  const u = res.user as { tz?: string; tz_label?: string; tz_offset?: number } | undefined;
  return {
    tz: u?.tz ?? null,
    tzLabel: u?.tz_label ?? null,
    tzOffset: typeof u?.tz_offset === "number" ? u.tz_offset : null,
  };
}

/** Look up a Slack user id by their email address. */
export async function findUserIdByEmail(email: string): Promise<string> {
  const res = await client.users.lookupByEmail({ email });
  const id = res.user?.id;
  if (!id) throw new Error(`No Slack user found for email: ${email}`);
  return id;
}

/**
 * Send a direct message to a user (by Slack user id). Slack opens/uses the
 * DM channel automatically when you post to a user id.
 */
export async function sendDirectMessage(userId: string, text: string): Promise<void> {
  await client.chat.postMessage({
    channel: userId,
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
}

/** Convenience: DM someone by email in one call. */
export async function dmByEmail(email: string, text: string): Promise<void> {
  const userId = await findUserIdByEmail(email);
  await sendDirectMessage(userId, text);
}

/**
 * DM a richly-formatted meeting brief (header + sections) to a user by email.
 * `fallbackText` is what shows in notifications and on clients that can't
 * render blocks.
 */
export async function dmBriefByEmail(
  email: string,
  title: string,
  markdownBody: string,
): Promise<void> {
  const userId = await findUserIdByEmail(email);
  await client.chat.postMessage({
    channel: userId,
    text: title, // notification fallback
    blocks: buildBriefBlocks(title, markdownBody),
    unfurl_links: false,
    unfurl_media: false,
  });
}

import { App, LogLevel } from "@slack/bolt";
import { config } from "./config.js";
import { answerQuestion } from "./qa/answer.js";
import { buildSectionBlocks } from "./integrations/slack.js";
import { startOAuthServer } from "./oauth/server.js";
import { startScheduler } from "./meetingPrep/scheduler.js";

if (!config.slack.appToken) {
  throw new Error(
    "SLACK_APP_TOKEN is required for Socket Mode. Generate one in your Slack app " +
      "(Basic Information → App-Level Tokens, scope connections:write).",
  );
}

const app = new App({
  token: config.slack.botToken,
  appToken: config.slack.appToken,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

/** Strip the bot's @mention (and any other user mentions) from the message text. */
function cleanQuestion(text: string): string {
  return text.replace(/<@[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

app.event("app_mention", async ({ event, client, say, logger }) => {
  const question = cleanQuestion(event.text ?? "");
  const threadTs = event.thread_ts ?? event.ts;

  if (!question) {
    await say({
      thread_ts: threadTs,
      text: "Ask me about a deal or client — e.g. “is there a blocker on client ABC?”",
    });
    return;
  }

  logger.info(`@mention question: "${question}"`);

  // Acknowledge quickly with a thinking indicator (the LLM calls take a few seconds).
  let placeholderTs: string | undefined;
  try {
    const ack = await client.chat.postMessage({
      channel: event.channel,
      thread_ts: threadTs,
      text: ":hourglass_flowing_sand: Looking into that…",
    });
    placeholderTs = ack.ts;
  } catch (err) {
    logger.warn("Could not post placeholder message", err);
  }

  try {
    const answer = await answerQuestion(question);
    if (placeholderTs) {
      await client.chat.update({
        channel: event.channel,
        ts: placeholderTs,
        text: answer.slice(0, 200),
        blocks: buildSectionBlocks(answer),
      });
    } else {
      await say({ thread_ts: threadTs, text: answer, blocks: buildSectionBlocks(answer) });
    }
  } catch (err) {
    logger.error("Failed to answer question", err);
    const msg = `:warning: Sorry, I hit an error answering that: ${(err as Error).message}`;
    if (placeholderTs) {
      await client.chat.update({ channel: event.channel, ts: placeholderTs, text: msg });
    } else {
      await say({ thread_ts: threadTs, text: msg });
    }
  }
});

async function main() {
  // One process runs all three surfaces of the service:
  //  1. the OAuth web server (BDs connect their Google Calendar once),
  //  2. the per-timezone 9am morning-prep scheduler,
  //  3. the Slack @mention bot (Socket Mode, outbound only).
  startOAuthServer();
  console.log(
    `🔐 OAuth server listening on :${config.port} ` +
      `(/oauth/google/start, /oauth/google/callback).`,
  );

  startScheduler();

  await app.start();
  console.log("⚡ Salesfie @mention bot is running (Socket Mode).");
}

main().catch((err) => {
  console.error("Failed to start Salesfie bot:");
  console.error(err);
  process.exit(1);
});

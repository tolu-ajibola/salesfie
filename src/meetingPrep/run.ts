import { getBd } from "../data/roster.js";
import { listTodaysEvents } from "../integrations/google.js";
import { isClientCall, buildBriefForEvent, externalDomains } from "./prep.js";
import { dmBriefByEmail } from "../integrations/slack.js";

export interface PrepResult {
  email: string;
  tz: string;
  events: number;
  calls: number;
  sent: number;
}

/**
 * Run the morning meeting-prep for one BD: read their calendar for today (in
 * their own timezone), find client calls, build a Pipedrive- and knowledge-base-grounded
 * brief for each, and DM it on Slack. This is the per-BD job the scheduler fires
 * at each BD's local 9am, and the same job the CLI script runs for testing.
 *
 * `dryRun` prints briefs instead of DMing. `log` lets the caller prefix output
 * (the scheduler tags each line with the BD it is processing).
 */
export async function runMorningPrep(
  email: string,
  opts: { dryRun?: boolean; log?: (msg: string) => void } = {},
): Promise<PrepResult> {
  const log = opts.log ?? ((m: string) => console.log(m));

  const bd = await getBd(email);
  const tz = bd?.timezone || "UTC";
  if (!bd) log(`(note: ${email} not in roster; defaulting timezone to UTC)`);

  const allEvents = await listTodaysEvents(email, tz);

  // Show everything the calendar returned, so the counts are explainable.
  log(`${email}: ${allEvents.length} event(s) on the calendar today in ${tz}:`);
  for (const e of allEvents) {
    const tags = [
      e.allDay ? "all-day" : "",
      e.selfResponse === "declined" ? "declined" : "",
      isClientCall(e) ? `client: ${externalDomains(e).join(", ")}` : "internal",
    ].filter(Boolean);
    log(`  - ${e.summary}  [${tags.join(", ")}]`);
  }

  // Prep only real client calls we haven't declined.
  const calls = allEvents.filter((e) => isClientCall(e) && e.selfResponse !== "declined");
  log(`${calls.length} client call(s) to prep.`);

  let sent = 0;
  for (const ev of calls) {
    const brief = await buildBriefForEvent(ev);
    if (!brief) {
      log(`  No Pipedrive match for "${ev.summary}", skipping.`);
      continue;
    }
    const title = `🌅 Prep: ${ev.summary}`;
    if (opts.dryRun) {
      log(`\n${title}\n${"-".repeat(title.length)}\n${brief}\n`);
    } else {
      await dmBriefByEmail(email, title, brief);
      sent++;
      log(`  Brief DM'd: ${ev.summary}`);
    }
  }

  return { email, tz, events: allEvents.length, calls: calls.length, sent };
}

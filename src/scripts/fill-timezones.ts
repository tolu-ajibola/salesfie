import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getUserTimezone } from "../integrations/slack.js";

/**
 * Fill the `timezone` column in data/bds.csv from each BD's Slack profile.
 *
 * The morning-prep scheduler needs to know each BD's local zone so it can fire
 * at their local 8am. The cleanest source we have right now is the timezone the
 * BD set in their own Slack profile (IANA name like "Europe/Berlin"), read via
 * users.info. No Google access required, so this unblocks the scheduler ahead
 * of Phase 2's calendar work.
 *
 * Usage: npm run fill-timezones
 * Re-runnable: it overwrites the timezone column each time (safe to re-run as
 * BDs change their Slack zone or new BDs are added).
 */

const here = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(here, "../../data/bds.csv");

interface Row {
  email: string;
  slackId: string;
  timezone: string;
}

function parseCsv(text: string): { header: string[]; rows: Row[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0].split(",").map((c) => c.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(",");
    return {
      email: (cols[0] ?? "").trim(),
      slackId: (cols[1] ?? "").trim(),
      timezone: (cols[2] ?? "").trim(),
    };
  });
  return { header, rows };
}

function toCsv(rows: Row[]): string {
  const header = "email,slack_id,timezone";
  const body = rows.map((r) => `${r.email},${r.slackId},${r.timezone}`).join("\n");
  return `${header}\n${body}\n`;
}

async function main(): Promise<void> {
  const raw = await readFile(CSV_PATH, "utf8");
  const { rows } = parseCsv(raw);
  console.log(`Read ${rows.length} BDs from ${CSV_PATH}\n`);

  let filled = 0;
  let failed = 0;

  // Sequential to stay well under Slack rate limits (users.info is Tier 4).
  for (const row of rows) {
    if (!row.slackId) {
      console.log(`- ${row.email}: no slack_id, skipped`);
      failed++;
      continue;
    }
    try {
      const { tz, tzLabel } = await getUserTimezone(row.slackId);
      if (tz) {
        row.timezone = tz;
        filled++;
        console.log(`- ${row.email}: ${tz}${tzLabel ? ` (${tzLabel})` : ""}`);
      } else {
        console.log(`- ${row.email}: Slack returned no tz`);
        failed++;
      }
    } catch (err) {
      console.log(`- ${row.email}: lookup failed (${(err as Error).message})`);
      failed++;
    }
  }

  await writeFile(CSV_PATH, toCsv(rows), "utf8");
  console.log(`\nDone. Filled ${filled}, missing/failed ${failed}. Wrote ${CSV_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

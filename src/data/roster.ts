import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reads the BD roster from data/bds.csv (email, slack_id, timezone). The
 * timezone column is filled from Slack profiles via `npm run fill-timezones`
 * and tells the scheduler each BD's local zone (for their local 9am).
 */

export interface Bd {
  email: string;
  slackId: string;
  timezone: string; // IANA name, e.g. "Europe/Berlin"
}

const here = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(here, "../../data/bds.csv");

export async function allBds(): Promise<Bd[]> {
  const raw = await readFile(CSV_PATH, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.slice(1).map((line) => {
    const c = line.split(",");
    return {
      email: (c[0] ?? "").trim(),
      slackId: (c[1] ?? "").trim(),
      timezone: (c[2] ?? "").trim(),
    };
  });
}

export async function getBd(email: string): Promise<Bd | null> {
  const all = await allBds();
  return all.find((b) => b.email.toLowerCase() === email.toLowerCase()) ?? null;
}

import { allBds } from "../data/roster.js";
import { runMorningPrep } from "./run.js";
import { lastPrepDate, markPrepDate } from "../storage/prepRuns.js";
import { getTokens } from "../storage/tokens.js";

/**
 * Per-timezone morning-prep scheduler.
 *
 * BDs span many timezones, so we cannot fire on one global clock. Every minute we
 * check each BD's *local* time; when it is 9:00 in their zone and we have not run
 * them yet today, we run their prep. Dedup is by (BD, local date) persisted to
 * disk, so restarts never double-send.
 *
 * We mark the day as done BEFORE running. A duplicate DM to a BD is worse than a
 * missed brief, and runs take several seconds (LLM calls) so two ticks could
 * otherwise overlap. The tradeoff: a hard failure loses that BD's brief for the
 * day (they can still use the @mention bot).
 */

const PREP_HOUR = 9; // local hour to fire morning prep
const TICK_MS = 60_000;

/** The BD's current local date (YYYY-MM-DD) and hour, per their IANA timezone. */
function localParts(tz: string): { date: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  // en-CA formats the date as YYYY-MM-DD. Intl returns "24" for midnight; normalize to 0.
  const hour = Number(parts.hour) % 24;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour };
}

async function tick(): Promise<void> {
  const bds = await allBds();
  for (const bd of bds) {
    if (!bd.timezone) continue;

    let local: { date: string; hour: number };
    try {
      local = localParts(bd.timezone);
    } catch {
      continue; // unrecognized timezone string
    }

    if (local.hour !== PREP_HOUR) continue;
    if ((await lastPrepDate(bd.email)) === local.date) continue; // already ran today
    if (!(await getTokens(bd.email))) continue; // BD hasn't connected Google yet

    await markPrepDate(bd.email, local.date); // mark first to avoid double-fire
    try {
      const r = await runMorningPrep(bd.email, {
        log: (m) => console.log(`[prep ${bd.email}] ${m}`),
      });
      console.log(`[scheduler] ${bd.email}: ${r.sent} brief(s) sent (${r.calls} client call(s)).`);
    } catch (err) {
      console.error(`[scheduler] ${bd.email} failed: ${(err as Error).message}`);
    }
  }
}

/** Start the minute-by-minute scheduler. Returns the interval handle. */
export function startScheduler(): NodeJS.Timeout {
  console.log(`🕘 Morning-prep scheduler started (fires at ${PREP_HOUR}:00 local time per BD).`);
  tick().catch((e) => console.error("[scheduler] tick error", e));
  return setInterval(() => tick().catch((e) => console.error("[scheduler] tick error", e)), TICK_MS);
}

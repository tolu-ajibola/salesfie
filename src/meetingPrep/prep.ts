import { COMPANY_EMAIL_DOMAIN } from "../config.js";
import type { CalendarEvent } from "../integrations/google.js";
import { lookupClientDeals, type DealSummary } from "../integrations/pipedrive.js";
import { summarizeDealBrief, expandSearchQueries } from "../integrations/claude.js";
import { retrieveMulti, snippetsToContext } from "../integrations/kb.js";

/**
 * Meeting-prep logic: decide which calendar events are client calls and turn
 * each into a Pipedrive-grounded prep brief, enriched with knowledge-base context.
 *
 * Client-call rule (locked): an event is a client call if any attendee's email
 * domain is NOT our own. We also ignore Google's pseudo-domains (meeting rooms,
 * group calendars), which aren't real external people.
 */

const NON_CLIENT_SUFFIXES = [
  COMPANY_EMAIL_DOMAIN, // your company domain
  "resource.calendar.google.com", // meeting rooms / resources
  "group.calendar.google.com", // shared/group calendars
];

// Words that carry no client identity in a meeting title, so we drop them before
// searching Pipedrive (otherwise we match deals on noise like "weekly" or our
// own name). Includes our company name, since titles read "Acme <> X".
const TITLE_FILLER = new Set([
  "acme", "meeting", "call", "sync", "intro", "introduction", "catch", "catchup",
  "up", "weekly", "biweekly", "monthly", "quarterly", "check", "checkin", "kickoff", "kick",
  "off", "demo", "followup", "follow", "prep", "review", "chat", "touchpoint", "standup",
  "the", "and", "with", "vs", "for", "our", "new",
]);

/** External (non-company, non-resource) attendee domains on an event. */
export function externalDomains(event: CalendarEvent): string[] {
  const domains = new Set<string>();
  for (const a of event.attendees) {
    const domain = a.email.split("@")[1]?.toLowerCase();
    if (!domain) continue;
    if (NON_CLIENT_SUFFIXES.some((s) => domain === s || domain.endsWith(`.${s}`))) continue;
    domains.add(domain);
  }
  return [...domains];
}

export function isClientCall(event: CalendarEvent): boolean {
  return externalDomains(event).length > 0;
}

/** Company-name guess from a domain: "abc-travel.com" -> "abc-travel". */
export function companyFromDomain(domain: string): string {
  return domain.split(".")[0];
}

/** Significant tokens from a string: lowercased, length >= 3, not filler. */
function significantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[<>|/&,.]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 3 && !TITLE_FILLER.has(t));
}

/**
 * Guard against Pipedrive's fuzzy search matching on a generic word: only accept
 * the matched deals if at least one deal's title or org actually contains one of
 * our search tokens. (e.g. a title "Acme <> XYZ transport" should NOT
 * adopt unrelated deals just because they happen to contain "transport".)
 */
function dealsAreRelevant(deals: DealSummary[], tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  return deals.some((d) => {
    const hay = `${d.title ?? ""} ${d.orgName ?? ""}`.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  });
}

/**
 * Best-effort the knowledge base enrichment for a brief. Pulls product deep-dives and trading
 * numbers for the client/products. Degrades to undefined if the knowledge base is unreachable
 * (e.g. running off the internal network), so the brief still works without it.
 */
async function gatherKbForBrief(
  client: string,
  dealContext: string,
): Promise<string | undefined> {
  try {
    const seed = `${client}\n\n${dealContext.slice(0, 800)}`;
    let queries = [seed, client];
    try {
      const expanded = await expandSearchQueries(
        `Product details, deep-dive, and trading numbers for ${client}`,
        dealContext.slice(0, 600),
      );
      queries = [seed, ...expanded];
    } catch {
      // expansion failed; fall back to seed + client name
    }
    const ctx = snippetsToContext(await retrieveMulti(queries, 6, 12));
    if (ctx.startsWith("(no relevant")) {
      console.log(`  Knowledge base: reached, but no relevant docs for "${client}".`);
      return undefined;
    }
    console.log(`  Knowledge base: enriched brief with ${ctx.length} chars of internal docs.`);
    return ctx;
  } catch {
    console.log("  Knowledge base: unreachable (not reachable from here?), brief uses Pipedrive only.");
    return undefined; // the knowledge base unreachable; brief proceeds on Pipedrive alone
  }
}

/**
 * Build a prep brief for a client-call event. We map the event to a Pipedrive
 * deal by trying the cleaned meeting title first, then the external attendee's
 * company (from their email domain), per the locked calendar->Pipedrive rule.
 * A relevance guard rejects fuzzy false matches. Returns null if nothing maps.
 */
export async function buildBriefForEvent(event: CalendarEvent): Promise<string | null> {
  const candidates: string[] = [];
  const titleTerm = significantTokens(event.summary).join(" ").trim();
  if (titleTerm) candidates.push(titleTerm);
  for (const d of externalDomains(event)) candidates.push(companyFromDomain(d));

  for (const candidate of candidates) {
    const tokens = significantTokens(candidate);
    const result = await lookupClientDeals(candidate).catch(() => null);
    if (!result) continue;
    if (!dealsAreRelevant(result.deals, tokens)) continue; // skip fuzzy false match

    const header =
      result.deals.length > 1
        ? `Found ${result.deals.length} deals (matched on "${result.matchedTerm}"). ` +
          `Summarize across all of them.\n\n`
        : "";
    const dealContext = header + result.context;
    const kbContext = await gatherKbForBrief(candidate, result.context);
    return summarizeDealBrief(candidate, dealContext, kbContext);
  }
  return null;
}

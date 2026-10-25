import { config } from "../config.js";

const BASE = `https://${config.pipedrive.companyDomain}.pipedrive.com/api/v1`;

/** A trimmed view of a Pipedrive deal that's useful for a meeting brief. */
export interface DealSummary {
  id: number;
  title: string;
  status: string;
  stageName?: string;
  value?: number;
  currency?: string;
  orgName?: string;
  ownerName?: string;
  expectedCloseDate?: string;
  updatedAt?: string;
}

export interface DealActivity {
  subject?: string;
  type?: string;
  done: boolean;
  dueDate?: string;
  note?: string;
}

export interface DealEmail {
  subject?: string;
  from?: string;
  to?: string;
  snippet?: string;
  timestamp?: string;
  direction?: string; // "incoming" | "outgoing" when Pipedrive reports it
}

/** Build a fully-qualified Pipedrive URL with the api_token query param. */
function url(path: string, params: Record<string, string | number> = {}): string {
  const u = new URL(`${BASE}${path}`);
  u.searchParams.set("api_token", config.pipedrive.apiToken);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const res = await fetch(url(path, params));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pipedrive ${path} failed: ${res.status} ${res.statusText} ${body}`);
  }
  const json = (await res.json()) as { success: boolean; data: T; error?: string };
  if (json.success === false) {
    throw new Error(`Pipedrive ${path} returned error: ${json.error ?? "unknown"}`);
  }
  return json.data;
}

/**
 * Search deals by free-text term (e.g. a client name parsed from a meeting title).
 * Returns the matched deals' basic info, best match first.
 */
export async function searchDeals(term: string): Promise<{ id: number; title: string }[]> {
  if (term.trim().length < 2) return []; // Pipedrive requires >= 2 chars
  type SearchResp = { items?: { item: { id: number; title: string } }[] };
  const data = await get<SearchResp>("/deals/search", { term: term.trim(), limit: 5 });
  return (data.items ?? []).map((i) => ({ id: i.item.id, title: i.item.title }));
}

/**
 * Search deals, but if the full term finds nothing, progressively drop trailing
 * words and retry — e.g. "EFE Central Chile" -> "EFE Central" -> "EFE".
 * This catches cases where the deal is named after just the company.
 */
export async function searchDealsSmart(
  term: string,
): Promise<{ matches: { id: number; title: string }[]; matchedTerm: string }> {
  const cleaned = term.trim();
  const direct = await searchDeals(cleaned);
  if (direct.length > 0) return { matches: direct, matchedTerm: cleaned };

  const words = cleaned.split(/\s+/).filter(Boolean);
  for (let n = words.length - 1; n >= 1; n--) {
    const shorter = words.slice(0, n).join(" ");
    if (shorter.length < 2) continue;
    const matches = await searchDeals(shorter);
    if (matches.length > 0) return { matches, matchedTerm: shorter };
  }
  return { matches: [], matchedTerm: cleaned };
}

/**
 * Search organizations by term — used as a fallback when a meeting title
 * doesn't match a deal but an attendee's email domain gives us a company name.
 */
export async function searchOrganizations(term: string): Promise<{ id: number; name: string }[]> {
  type SearchResp = { items?: { item: { id: number; name: string } }[] };
  const data = await get<SearchResp>("/organizations/search", { term, limit: 5 });
  return (data.items ?? []).map((i) => ({ id: i.item.id, name: i.item.name }));
}

/** List the most recently updated deals (used to sample real data in dev). */
export async function listRecentDeals(limit = 8): Promise<{ id: number; title: string }[]> {
  const data = await get<any[]>("/deals", { limit, sort: "update_time DESC" });
  return (data ?? []).map((d) => ({ id: d.id, title: d.title }));
}

// Stages rarely change, so fetch the id->name map once and cache it for the
// process lifetime. Pipedrive deals only carry a numeric stage_id.
let stageMapCache: Map<number, string> | null = null;

export async function getStageMap(): Promise<Map<number, string>> {
  if (stageMapCache) return stageMapCache;
  const data = await get<any[]>("/stages").catch(() => [] as any[]);
  stageMapCache = new Map((data ?? []).map((s) => [s.id, s.name as string]));
  return stageMapCache;
}

/** Fetch full detail for one deal and shape it into a DealSummary. */
export async function getDeal(id: number): Promise<DealSummary> {
  // Pipedrive returns many fields; we pick the brief-relevant ones.
  const [d, stages] = await Promise.all([get<any>(`/deals/${id}`), getStageMap()]);
  // stage_id is normally a number; guard against the object form just in case.
  const stageId = typeof d.stage_id === "object" ? d.stage_id?.id : d.stage_id;
  return {
    id: d.id,
    title: d.title,
    status: d.status,
    stageName: stages.get(stageId) ?? d.stage_id?.name ?? d.stage_name ?? undefined,
    value: d.value,
    currency: d.currency,
    orgName: d.org_id?.name ?? d.org_name,
    ownerName: d.owner_id?.name ?? d.user_id?.name,
    expectedCloseDate: d.expected_close_date ?? undefined,
    updatedAt: d.update_time ?? undefined,
  };
}

/** Render a deal + its activities + recent emails into a context block for an LLM. */
export function formatDealContext(
  deal: DealSummary,
  activities: DealActivity[],
  emails: DealEmail[] = [],
): string {
  const lines: string[] = [];
  lines.push(`Deal title: ${deal.title}`);
  lines.push(`Organization: ${deal.orgName ?? "unknown"}`);
  lines.push(`Status: ${deal.status}`);
  lines.push(`Stage: ${deal.stageName ?? "unknown"}`);
  lines.push(
    `Value: ${deal.value != null ? `${deal.value} ${deal.currency ?? ""}`.trim() : "unknown"}`,
  );
  lines.push(`Owner: ${deal.ownerName ?? "unknown"}`);
  lines.push(`Expected close: ${deal.expectedCloseDate ?? "unknown"}`);
  lines.push(`Last updated: ${deal.updatedAt ?? "unknown"}`);
  lines.push("");
  lines.push("Recent activities:");
  if (activities.length === 0) {
    lines.push("  (none found)");
  } else {
    for (const a of activities) {
      const status = a.done ? "done" : "open";
      lines.push(
        `  - [${status}] ${a.type ?? "activity"}: ${a.subject ?? "(no subject)"}` +
          (a.dueDate ? ` (due ${a.dueDate})` : "") +
          (a.note ? ` — ${a.note.replace(/<[^>]+>/g, "").slice(0, 200)}` : ""),
      );
    }
  }
  lines.push("");
  lines.push("Recent emails:");
  if (emails.length === 0) {
    lines.push("  (none synced to this deal)");
  } else {
    for (const m of emails) {
      const dir = m.direction ? `[${m.direction}] ` : "";
      lines.push(
        `  - ${dir}${m.timestamp ?? ""} ${m.subject ?? "(no subject)"}` +
          (m.from ? ` from ${m.from}` : "") +
          (m.snippet ? `: ${m.snippet.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").slice(0, 200)}` : ""),
      );
    }
  }
  return lines.join("\n");
}

export interface ClientDealsResult {
  deals: DealSummary[];
  context: string;
  matchedTerm: string;
}

/**
 * Look up ALL deals for a client/company name and return their combined context.
 * A client often has several deals (e.g. different products), so we fetch each
 * matched deal's detail + recent activities and concatenate them with clear
 * separators, letting the LLM summarize across all of them. Returns null if
 * nothing matches.
 */
export async function lookupClientDeals(
  clientName: string,
  maxDeals = 5,
): Promise<ClientDealsResult | null> {
  const { matches, matchedTerm } = await searchDealsSmart(clientName);
  if (matches.length === 0) return null;

  const details = await Promise.all(
    matches.slice(0, maxDeals).map(async (m) => {
      const [deal, activities, emails] = await Promise.all([
        getDeal(m.id),
        getDealActivities(m.id),
        getDealEmails(m.id),
      ]);
      return { deal, context: formatDealContext(deal, activities, emails) };
    }),
  );

  const deals = details.map((d) => d.deal);
  const context =
    details.length === 1
      ? details[0].context
      : details
          .map(
            (d, i) =>
              `=== Deal ${i + 1} of ${details.length}: ${d.deal.title} ===\n${d.context}`,
          )
          .join("\n\n");

  return { deals, context, matchedTerm };
}

/** Recent activities (calls, meetings, tasks, notes) attached to a deal. */
export async function getDealActivities(dealId: number, limit = 10): Promise<DealActivity[]> {
  const data = await get<any[]>(`/deals/${dealId}/activities`, { limit, start: 0 }).catch(
    () => [] as any[],
  );
  return (data ?? []).map((a) => ({
    subject: a.subject,
    type: a.type,
    done: Boolean(a.done),
    dueDate: a.due_date,
    note: a.note,
  }));
}

/**
 * Emails synced to a deal (Pipedrive's email sync / smart Bcc). Returns [] if
 * the account has no mailbox sync or the token's user can't see them, so the
 * brief degrades gracefully. Pipedrive nests sender/recipients as arrays of
 * { email_address, name }.
 */
export async function getDealEmails(dealId: number, limit = 10): Promise<DealEmail[]> {
  const data = await get<any[]>(`/deals/${dealId}/mailMessages`, { limit, start: 0 }).catch(
    () => [] as any[],
  );
  const party = (arr: any): string | undefined =>
    Array.isArray(arr)
      ? arr.map((p) => p.email_address ?? p.name).filter(Boolean).join(", ") || undefined
      : undefined;
  return (data ?? []).map((m) => {
    const d = m.data ?? m; // some Pipedrive responses wrap the message in `data`
    return {
      subject: d.subject,
      from: party(d.from),
      to: party(d.to),
      snippet: d.snippet ?? d.body ?? undefined,
      timestamp: d.message_time ?? d.add_time ?? undefined,
      direction: d.mail_message_direction ?? undefined,
    };
  });
}

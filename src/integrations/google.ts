import { google } from "googleapis";
import { config } from "../config.js";
import { getTokens, saveTokens } from "../storage/tokens.js";

// Derive the client type from googleapis' own bundled google-auth-library so we
// don't clash with the separate top-level copy (which has incompatible private
// fields under structural typing).
type GoogleOAuthClient = InstanceType<typeof google.auth.OAuth2>;

/**
 * Per-BD Google Calendar access via OAuth.
 *
 * Flow: a BD opens the consent URL (getAuthUrl), approves read-only calendar
 * access, Google redirects to our callback with a code, we exchange it for
 * tokens (exchangeCodeAndStore) and persist them encrypted. Later we build an
 * authed client from the stored tokens to read their calendar; the google
 * library refreshes the access token automatically and we re-persist it.
 */

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

export function createOAuthClient(): GoogleOAuthClient {
  const { clientId, clientSecret, redirectUri } = config.google;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, " +
        "and GOOGLE_REDIRECT_URI in .env.",
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Build the consent URL a BD visits to grant calendar access. */
export function getAuthUrl(stateEmail: string): string {
  return createOAuthClient().generateAuthUrl({
    access_type: "offline", // request a refresh token
    prompt: "consent", // force a refresh token even on re-consent
    scope: SCOPES,
    state: stateEmail, // echoed back to the callback so we know who connected
    login_hint: stateEmail, // pre-select the right Google account
  });
}

/** Exchange an OAuth code for tokens and store them for this BD. */
export async function exchangeCodeAndStore(code: string, email: string): Promise<void> {
  const { tokens } = await createOAuthClient().getToken(code);
  await saveTokens(email, tokens);
}

/** An authed client for a BD, auto-refreshing and re-persisting tokens. */
async function authedClientFor(email: string): Promise<GoogleOAuthClient> {
  const stored = await getTokens(email);
  if (!stored?.refresh_token && !stored?.access_token) {
    throw new Error(`No Google tokens stored for ${email}. They need to connect their calendar first.`);
  }
  const client = createOAuthClient();
  client.setCredentials(stored);
  // When the library refreshes the access token, persist the new credentials.
  client.on("tokens", (t) => {
    void saveTokens(email, t);
  });
  return client;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start?: string; // ISO datetime, or a date for all-day events
  end?: string;
  allDay: boolean;
  attendees: { email: string; responseStatus?: string }[];
  selfResponse?: string; // this BD's RSVP: accepted | declined | tentative | needsAction
  organizerEmail?: string;
  hangoutLink?: string;
  location?: string;
}

/**
 * List a BD's events for "today" in their own timezone. `timeZone` is an IANA
 * name from data/bds.csv (e.g. "Europe/Berlin"), so "today" means their local
 * day, not UTC.
 */
export async function listTodaysEvents(email: string, timeZone: string): Promise<CalendarEvent[]> {
  const auth = await authedClientFor(email);
  const calendar = google.calendar({ version: "v3", auth });
  const { timeMin, timeMax } = localDayBounds(timeZone);
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    singleEvents: true, // expand recurring events into instances
    orderBy: "startTime",
    maxResults: 50,
  });
  return (res.data.items ?? [])
    .filter((e) => e.status !== "cancelled") // drop cancelled instances
    .map((e) => ({
      id: e.id ?? "",
      summary: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? undefined,
      end: e.end?.dateTime ?? e.end?.date ?? undefined,
      allDay: Boolean(e.start?.date && !e.start?.dateTime), // all-day events use `date`
      attendees: (e.attendees ?? []).map((a) => ({
        email: a.email ?? "",
        responseStatus: a.responseStatus ?? undefined,
      })),
      selfResponse: (e.attendees ?? []).find((a) => a.self)?.responseStatus ?? undefined,
      organizerEmail: e.organizer?.email ?? undefined,
      hangoutLink: e.hangoutLink ?? undefined,
      location: e.location ?? undefined,
    }));
}

/** Start/end of "today" in a given IANA timezone, as RFC3339 strings. */
function localDayBounds(timeZone: string): { timeMin: string; timeMax: string } {
  const now = new Date();
  // YYYY-MM-DD for "today" in the target zone (en-CA formats as ISO date).
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const offset = tzOffset(timeZone, now);
  return {
    timeMin: `${dateStr}T00:00:00${offset}`,
    timeMax: `${dateStr}T23:59:59${offset}`,
  };
}

/** Current UTC offset of a timezone as "+02:00" / "-05:00". */
function tzOffset(timeZone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(at);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = name.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : "+00:00";
}

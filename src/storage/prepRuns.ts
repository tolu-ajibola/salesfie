import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Per-day dedup for morning prep. Records the last local date (YYYY-MM-DD, in the
 * BD's own timezone) on which we sent that BD their prep, so the scheduler fires
 * once per BD per day even across restarts. Not sensitive, so stored as plain
 * JSON (unlike OAuth tokens, which are encrypted).
 */

const here = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = resolve(here, "../../data/prep-runs.json");

type Store = Record<string, string>; // lowercased email -> last local date prep ran

async function load(): Promise<Store> {
  try {
    return JSON.parse(await readFile(STORE_PATH, "utf8")) as Store;
  } catch {
    return {};
  }
}

export async function lastPrepDate(email: string): Promise<string | null> {
  return (await load())[email.toLowerCase()] ?? null;
}

export async function markPrepDate(email: string, localDate: string): Promise<void> {
  const store = await load();
  store[email.toLowerCase()] = localDate;
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

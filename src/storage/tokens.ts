import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

/**
 * Per-BD Google OAuth token storage.
 *
 * Tokens (especially the long-lived refresh_token) are encrypted at rest with
 * AES-256-GCM using ENCRYPTION_KEY, and kept in a local JSON file for now. This
 * is the interim store; the data model calls for Postgres in production, and
 * this module is the single place to swap the backend without touching callers.
 *
 * The file (data/oauth-tokens.json) is gitignored and must never be committed.
 */

export interface StoredTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string;
  token_type?: string | null;
}

const here = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = resolve(here, "../../data/oauth-tokens.json");

function key(): Buffer {
  const k = config.encryptionKey;
  if (!k) throw new Error("ENCRYPTION_KEY is not set; cannot encrypt OAuth tokens.");
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes (generate with: openssl rand -base64 32).");
  }
  return buf;
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

function decrypt(blob: string): string {
  const [ivB, tagB, dataB] = blob.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
}

type Store = Record<string, string>; // lowercased email -> encrypted JSON blob

async function loadStore(): Promise<Store> {
  try {
    return JSON.parse(await readFile(STORE_PATH, "utf8")) as Store;
  } catch {
    return {}; // file not created yet
  }
}

async function saveStore(store: Store): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export async function saveTokens(email: string, tokens: StoredTokens): Promise<void> {
  // Google only returns a refresh_token on the first consent; on later refreshes
  // it omits it. Preserve the one we already have so we never lose it.
  if (!tokens.refresh_token) {
    const existing = await getTokens(email);
    if (existing?.refresh_token) tokens = { ...tokens, refresh_token: existing.refresh_token };
  }
  const store = await loadStore();
  store[email.toLowerCase()] = encrypt(JSON.stringify(tokens));
  await saveStore(store);
}

export async function getTokens(email: string): Promise<StoredTokens | null> {
  const blob = (await loadStore())[email.toLowerCase()];
  if (!blob) return null;
  try {
    return JSON.parse(decrypt(blob)) as StoredTokens;
  } catch {
    return null; // corrupt or key changed
  }
}

export async function listConnected(): Promise<string[]> {
  return Object.keys(await loadStore());
}

import dotenv from "dotenv";

// Load .env and let it override any pre-existing shell vars (e.g. an empty
// ANTHROPIC_API_KEY exported in your shell profile). On Railway there is no
// .env file, so the real platform env vars remain authoritative there.
dotenv.config({ override: true });

/** Read a required env var, throwing a clear error if missing. */
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

/** Read an optional env var (used for things not yet provisioned, e.g. Google). */
function optional(name: string): string | undefined;
function optional(name: string, fallback: string): string;
function optional(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (value && value.trim() !== "") return value;
  return fallback;
}

export const config = {
  slack: {
    botToken: required("SLACK_BOT_TOKEN"),
    appToken: optional("SLACK_APP_TOKEN"),
    signingSecret: optional("SLACK_SIGNING_SECRET"),
  },
  pipedrive: {
    apiToken: required("PIPEDRIVE_API_TOKEN"),
    companyDomain: required("PIPEDRIVE_COMPANY_DOMAIN"),
  },
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
  },
  google: {
    clientId: optional("GOOGLE_CLIENT_ID"),
    clientSecret: optional("GOOGLE_CLIENT_SECRET"),
    redirectUri: optional("GOOGLE_REDIRECT_URI"),
  },
  kb: {
    // RAG service (Chroma DB wrapper) over your own docs.
    baseUrl: optional("KB_API_URL", "http://localhost:8000"),
    tenant: optional("KB_TENANT", "default"),
    database: optional("KB_DATABASE", "kb"),
    collection: optional("KB_COLLECTION", "documents"),
  },
  databaseUrl: optional("DATABASE_URL"),
  port: Number(process.env.PORT ?? 3000),
  encryptionKey: optional("ENCRYPTION_KEY"),
  testBdEmail: optional("TEST_BD_EMAIL"),
} as const;

/** Our own email domain — anyone NOT on this domain is treated as a client. */
export const COMPANY_EMAIL_DOMAIN = "example.com";

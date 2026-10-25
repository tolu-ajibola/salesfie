import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const MODEL = "claude-sonnet-4-5";

/**
 * Summarize structured deal context into a concise meeting-prep brief.
 * `context` is a plain-text dump of everything we gathered (deal, activities, etc.).
 * `kbContext` (optional) is internal-knowledge enrichment from the knowledge base: product
 * deep-dives, trading numbers, and other docs relevant to the client/product.
 */
export async function summarizeDealBrief(
  clientName: string,
  context: string,
  kbContext?: string,
): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "You are a sales assistant preparing a business development rep for a client call. " +
      "Write a tight, skimmable meeting-prep brief. " +
      "Do NOT include a top-level title or the client name as a heading (that is added separately). " +
      "Use exactly these four bold section headers, each prefixed with its emoji: " +
      "'📊 Deal Status', '🗓️ Recent Activity', '⚠️ Risks/Blockers', '💬 Suggested Talking Points' (2-3 points). " +
      "Use bullet points; keep it concise. " +
      "Base 'Recent Activity' on both logged activities AND synced emails when present. " +
      "IMPORTANT: a deal value of 0 does NOT mean commercials have not been discussed. Commercial terms here " +
      "are things like transaction fee, commission, payment fee, and average ticket price, which appear in " +
      "activities or emails, not the deal value field. Only flag commercials as open if the context genuinely " +
      "has no mention of fees, commission, or pricing. Never infer 'no commercial terms' from a 0 value alone. " +
      "If internal knowledge (knowledge base) is provided, fold in the relevant product details and trading " +
      "numbers (booking volumes, revenue) where they sharpen the brief, and mention the source when you do. " +
      "Be concrete; never invent facts not in the context. If something important is unknown, say so briefly. " +
      "Avoid em-dashes; use commas, periods, or parentheses instead.",
    messages: [
      {
        role: "user",
        content:
          `Client/deal: ${clientName}\n\n` +
          `--- Pipedrive deal context ---\n${context}\n\n` +
          (kbContext ? `--- Internal knowledge (knowledge base) ---\n${kbContext}\n\n` : "") +
          `Write the prep brief.`,
      },
    ],
  });

  return textOf(message);
}

/**
 * Pull the client/company/deal name a question is about, so we can search
 * Pipedrive for it. Returns null when the question isn't about a specific client.
 */
export async function extractClientName(question: string): Promise<string | null> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 60,
    system:
      "Extract the client, company, or deal name the user is asking about. " +
      "Reply with ONLY that name and nothing else. " +
      "If there is no specific client/company/deal, reply with exactly: NONE",
    messages: [{ role: "user", content: question }],
  });
  const text = textOf(message);
  return !text || /^none$/i.test(text) ? null : text;
}

/**
 * Generate a few varied, keyword-focused search queries for the internal
 * knowledge base. The knowledge base's vector search is phrasing-sensitive, so issuing
 * several rephrasings (surfacing concrete product/carrier/topic names) and
 * unioning the hits improves recall.
 *
 * Beyond rephrasing the question, we deliberately ask for queries that pull the
 * kinds of deal intelligence BDs care about even when the question doesn't name
 * them explicitly: trading numbers (booking volumes, GMV, passenger/segment
 * counts, revenue) and product deep-dives (feature docs, setup guides, how a
 * product works). Returns up to 6 queries.
 */
export async function expandSearchQueries(
  question: string,
  dealContext: string,
): Promise<string[]> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 280,
    system:
      "You generate search queries for an internal knowledge base covering products, " +
      "carriers, integrations, finance, trading/booking numbers, and tenders at a travel-distribution " +
      "company. Given a user's question (and optional deal context), output short, keyword-focused " +
      "search queries that would retrieve relevant documents. Surface concrete entities (client, " +
      "carrier, and product names) found in the input. Produce: " +
      "(1) two or three rephrasings targeting the specific question; " +
      "(2) when a specific client/company is present, one query for that client's trading numbers " +
      "(booking volume, GMV, passengers, segments, revenue); " +
      "(3) when a product or carrier is present, one query for its product deep-dive (features, " +
      "setup, how it works). Skip (2) or (3) if no client/product is in the input. " +
      "Output ONLY the queries, one per line, with no numbering, quotes, or extra text.",
    messages: [
      {
        role: "user",
        content: `Question: ${question}\n\nDeal context (optional):\n${dealContext.slice(0, 600)}`,
      },
    ],
  });
  return textOf(message)
    .split("\n")
    .map((line) => line.replace(/^[-*\d.\)\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * Answer a BD's ad-hoc question about a deal/client, grounded in Pipedrive deal
 * context and the knowledge base (internal knowledge) context. Output is Slack-friendly markdown.
 */
export async function answerDealQuestion(
  question: string,
  dealContext: string,
  kbContext: string,
): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "You are Salesfie, a deal-intelligence assistant for business development reps, " +
      "answering questions in Slack. Be concise and direct — a few sentences or tight bullets. " +
      "Ground every claim in the provided context (Pipedrive deal data and internal knowledge from the knowledge base). " +
      "Never invent facts. If the context doesn't answer the question, say so plainly and suggest where to look. " +
      "When you use internal knowledge, mention the source if one is given. " +
      "If the client has multiple deals, give a brief cross-deal summary and call out per-deal specifics " +
      "(stage, value, blockers) where they differ. " +
      "Avoid em-dashes; use commas, periods, or parentheses instead.",
    messages: [
      {
        role: "user",
        content:
          `Question: ${question}\n\n` +
          `--- Pipedrive deal context ---\n${dealContext}\n\n` +
          `--- Internal knowledge (knowledge base) ---\n${kbContext}\n\n` +
          `Answer the question.`,
      },
    ],
  });
  return textOf(message);
}

/** Concatenate the text blocks of a Claude response. */
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

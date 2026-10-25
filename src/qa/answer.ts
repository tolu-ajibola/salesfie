import { lookupClientDeals } from "../integrations/pipedrive.js";
import { retrieveMulti, snippetsToContext } from "../integrations/kb.js";
import { extractClientName, answerDealQuestion, expandSearchQueries } from "../integrations/claude.js";

/**
 * Answer a BD's ad-hoc question about a deal/client.
 *
 * Pipeline:
 *   1. Ask Claude which client/company the question is about.
 *   2. Look that client up in Pipedrive (deal + recent activities).
 *   3. Semantically retrieve relevant internal docs from the knowledge base for the question.
 *   4. Have Claude answer, grounded in both contexts.
 *
 * Both data sources degrade gracefully: if Pipedrive finds nothing or the knowledge base is
 * unreachable (e.g. running off the internal network), we still answer with
 * whatever context we have.
 */
export async function answerQuestion(question: string): Promise<string> {
  // Pipedrive first: it surfaces deal specifics (e.g. product names like
  // "a named product") that we then use to seed a more relevant the knowledge base search.
  const dealContext = await gatherDealContext(question);
  const kbContext = await gatherKbContext(question, dealContext);

  return answerDealQuestion(question, dealContext, kbContext);
}

async function gatherDealContext(question: string): Promise<string> {
  let client: string | null = null;
  try {
    client = await extractClientName(question);
  } catch {
    return "(could not determine which client this is about)";
  }
  if (!client) return "(no specific client identified in the question)";

  try {
    const result = await lookupClientDeals(client);
    if (!result) return `No Pipedrive deal found matching "${client}".`;
    const header =
      result.deals.length > 1
        ? `Found ${result.deals.length} deals for "${client}" (matched on "${result.matchedTerm}"). ` +
          `Summarize across all of them.\n\n`
        : "";
    return header + result.context;
  } catch (err) {
    return `Pipedrive lookup for "${client}" failed: ${(err as Error).message}`;
  }
}

async function gatherKbContext(question: string, dealContext: string): Promise<string> {
  try {
    // Deal specifics surfaced by Pipedrive (product names, notes) help target
    // the search even when the question itself doesn't name the product.
    const usableDealContext =
      dealContext.startsWith("(") || dealContext.startsWith("No Pipedrive")
        ? ""
        : dealContext.slice(0, 800);
    const seed = usableDealContext ? `${question}\n\n${usableDealContext}` : question;

    // Build a set of varied queries (vector search is phrasing-sensitive), then
    // union their hits. The original question + seeded query are always included;
    // Claude adds keyword-focused rephrasings on top.
    let queries = [seed, question];
    try {
      const expanded = await expandSearchQueries(question, usableDealContext);
      queries = [seed, ...expanded];
    } catch {
      // If expansion fails, fall back to the seed + raw question.
    }

    // Slightly higher final cap than before: the query set now spans question
    // rephrasings plus trading-numbers and product-deepdive angles, so we leave
    // room for hits from each category to survive dedup.
    const snippets = await retrieveMulti(queries, 6, 12);
    return snippetsToContext(snippets);
  } catch {
    // Most likely cause when developing: not on the internal network, so the
    // the knowledge base host doesn't resolve. The bot still answers from Pipedrive context.
    return "(internal knowledge base unreachable, likely not on the internal network)";
  }
}

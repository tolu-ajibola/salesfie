/**
 * Knowledge-base probe — run this where the service is reachable to confirm the live response shape so we can
 * finalize the parser in src/integrations/kb.ts.
 *
 * Usage:
 *   npm run kb -- "What Google Sheet is used for Global Markets pipeline deal exports?"
 */
import { config } from "../config.js";
import { rawRetrieve, parseSnippets, snippetsToContext } from "../integrations/kb.js";

async function main() {
  const query =
    process.argv.slice(2).join(" ").trim() ||
    "What Google Sheet is used for Global Markets pipeline deal exports?";

  console.log(`Knowledge base endpoint: ${config.kb.baseUrl}/v2/retrieve`);
  console.log(
    `tenant=${config.kb.tenant} database=${config.kb.database} collection=${config.kb.collection}`,
  );
  console.log(`\nQuery: "${query}"\n`);

  const raw = await rawRetrieve(query, 5);
  console.log("=== RAW RESPONSE ===");
  console.log(JSON.stringify(raw, null, 2));

  console.log("\n=== PARSED SNIPPETS ===");
  const snippets = parseSnippets(raw);
  console.log(`Parsed ${snippets.length} snippet(s).`);
  console.log(snippetsToContext(snippets));
}

main().catch((err) => {
  console.error("\nKnowledge-base probe failed (is the service reachable?):");
  console.error(err);
  process.exit(1);
});

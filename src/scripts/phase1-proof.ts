/**
 * Phase 1 proof: given a client/deal name, pull it from Pipedrive,
 * have Claude write a meeting-prep brief, and DM it to the test BD in Slack.
 *
 * Usage:
 *   npm run phase1 -- "Acme Corp"
 * If no name is passed, it lists a few recent deals so you can pick one.
 */
import { config } from "../config.js";
import {
  searchDealsSmart,
  listRecentDeals,
  getDeal,
  getDealActivities,
  formatDealContext,
} from "../integrations/pipedrive.js";
import { summarizeDealBrief } from "../integrations/claude.js";
import { dmBriefByEmail, toSlackMarkdown } from "../integrations/slack.js";

async function main() {
  const term = process.argv.slice(2).join(" ").trim();

  if (!term) {
    console.log("No client name given. Listing your most recent deals...\n");
    const sample = await listRecentDeals();
    if (sample.length === 0) {
      console.log("Couldn't find any deals to sample. Pass a name: npm run phase1 -- \"Acme\"");
      return;
    }
    console.log("Some deals you could try:");
    for (const d of sample) console.log(`  - ${d.title}`);
    console.log('\nRe-run with one, e.g.:  npm run phase1 -- "<deal or client name>"');
    return;
  }

  console.log(`Searching Pipedrive for "${term}"...`);
  const { matches, matchedTerm } = await searchDealsSmart(term);
  if (matches.length === 0) {
    console.log(`No deals matched "${term}". Try a different name.`);
    return;
  }
  if (matchedTerm !== term) {
    console.log(`No exact match for "${term}" — fell back to "${matchedTerm}".`);
  }

  const best = matches[0];
  console.log(`Best match: "${best.title}" (deal #${best.id}). Fetching detail...`);
  const [deal, activities] = await Promise.all([
    getDeal(best.id),
    getDealActivities(best.id),
  ]);

  const context = formatDealContext(deal, activities);
  console.log("\n--- Context gathered ---\n" + context + "\n------------------------\n");

  console.log("Asking Claude to write the prep brief...");
  const brief = await summarizeDealBrief(deal.orgName ?? deal.title, context);

  const title = `🌅 Meeting prep — ${deal.orgName ?? deal.title}`;

  if (!config.testBdEmail) {
    console.log("\nNo TEST_BD_EMAIL set — printing the converted Slack mrkdwn instead:\n");
    console.log(title + "\n\n" + toSlackMarkdown(brief));
    return;
  }

  console.log(`\nDMing the formatted brief to ${config.testBdEmail} on Slack...`);
  await dmBriefByEmail(config.testBdEmail, title, brief);
  console.log("Done — check your Slack DMs from Salesfie. ✅");
}

main().catch((err) => {
  console.error("\nPhase 1 proof failed:");
  console.error(err);
  process.exit(1);
});

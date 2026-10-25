/**
 * Dev tool: run the @mention bot's Q&A pipeline from the CLI (no Slack needed).
 *
 * Usage:
 *   npm run ask -- "is there a blocker on EFE Central Chile?"
 *
 * Note: off the internal network, the knowledge base is unreachable and is skipped gracefully,
 * so the answer comes from Pipedrive context only.
 */
import { answerQuestion } from "../qa/answer.js";

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.log('Pass a question, e.g.:  npm run ask -- "blocker on EFE Central Chile?"');
    return;
  }
  console.log(`Q: ${question}\n`);
  const answer = await answerQuestion(question);
  console.log("A:\n" + answer);
}

main().catch((err) => {
  console.error("ask failed:", err);
  process.exit(1);
});

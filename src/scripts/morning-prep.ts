import { config } from "../config.js";
import { runMorningPrep } from "../meetingPrep/run.js";

/**
 * Manually run the morning meeting-prep for one BD (testing aid). The scheduler
 * runs the same job automatically at each BD's local 9am once deployed.
 *
 * Usage:
 *   npm run morning-prep -- <email>            (defaults to TEST_BD_EMAIL)
 *   npm run morning-prep -- <email> --dry-run  (print briefs, do not DM)
 */
const email = process.argv[2]?.startsWith("--")
  ? config.testBdEmail
  : process.argv[2] ?? config.testBdEmail;
const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");

async function main(): Promise<void> {
  if (!email) {
    console.error("Usage: npm run morning-prep -- <email> [--dry-run]");
    process.exit(1);
  }
  await runMorningPrep(email, { dryRun });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

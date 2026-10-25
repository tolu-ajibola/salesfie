import { config } from "../config.js";
import { startOAuthServer } from "../oauth/server.js";

/**
 * Launch the OAuth server and print the consent URL for a BD to connect their
 * Google Calendar. Used to onboard a BD (and to connect your own calendar for
 * testing).
 *
 * Usage: npm run connect-google -- <email>   (defaults to TEST_BD_EMAIL)
 * Then open the printed URL, approve, and the callback stores the tokens.
 * Leave it running until you see the "Connected" page, then Ctrl+C.
 */
const email = process.argv[2] ?? config.testBdEmail;
if (!email) {
  console.error("Usage: npm run connect-google -- <email>  (or set TEST_BD_EMAIL in .env)");
  process.exit(1);
}

startOAuthServer(config.port);
const startUrl = `http://localhost:${config.port}/oauth/google/start?email=${encodeURIComponent(email)}`;

console.log(`OAuth server listening on http://localhost:${config.port}`);
console.log(`\nOpen this URL in your browser to connect ${email}'s calendar:\n`);
console.log(`  ${startUrl}\n`);
console.log("Waiting for Google to redirect back... (Ctrl+C once you see the Connected page)");

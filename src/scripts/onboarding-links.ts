import { allBds } from "../data/roster.js";
import { config } from "../config.js";

/**
 * Print a one-time "connect your Google Calendar" link for each BD in the roster.
 * Each BD opens their own link once; it sends them through Google consent and
 * stores their token. Share these privately (e.g. a Slack DM per BD).
 *
 * The host comes from PUBLIC_BASE_URL (the deployed internal host), falling back
 * to localhost for local testing.
 *
 *   PUBLIC_BASE_URL=https://salesfie.example.com npm run onboarding-links
 */
const base = (process.env.PUBLIC_BASE_URL ?? `http://localhost:${config.port}`).replace(/\/$/, "");

const bds = await allBds();
console.log(`Connect links (base: ${base})\n`);
for (const bd of bds) {
  const link = `${base}/oauth/google/start?email=${encodeURIComponent(bd.email)}`;
  console.log(`${bd.email}\n  ${link}\n`);
}
console.log(`${bds.length} BD(s). Each opens their own link once to connect their calendar.`);

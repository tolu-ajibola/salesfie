# Salesfie

A deal-intelligence agent for business development reps. Every BD starts the day with a short brief in Slack for each client call on their calendar, and can ask the bot anything about a deal without leaving Slack.

TypeScript on Node, with Claude for the writing and reasoning, Pipedrive for deal data, Google Calendar for meetings, a retrieval (RAG) service for internal docs, and a Slack bot in Socket Mode.

> **A sanitised reference version.** This is rebuilt from a system I designed and run in production. Company names, colleagues, internal hostnames and service names have been replaced with neutral stand-ins, and the BD roster is an example file.

> **Pipedrive, then Salesforce.** Built on Pipedrive, then rebuilt on Salesforce when the team moved CRMs. This repo shows the original Pipedrive version; the briefing and Q&A pipeline carried over to the Salesforce build.

## What it does

**1. Morning meeting prep.** At 9am in each BD's own timezone, the agent reads their calendar and picks out the client calls (meetings with attendees outside the company's domain). For each call it builds a brief from the CRM and the knowledge base:

- **Deal status:** stage, value and owner.
- **Recent activity:** the last few weeks, and what changed.
- **Risks and blockers:** stalled reviews, pending approvals, quiet stakeholders.
- **Suggested talking points:** concrete openers grounded in the latest activity.

The brief arrives as a Slack DM.

**2. Ask anything in Slack.** @mention the bot with a question like "what changed on this deal?" or "is there a blocker with this client?". It works in four steps:

1. Claude pulls out which client or deal the question is about.
2. The agent looks up the deal in the CRM.
3. It rewrites the question into several search queries for the knowledge base (vector search is sensitive to phrasing).
4. It answers in-thread, grounded only in what it found.

## Design choices

- **Grounded, not guessed.** Every brief and answer is built from retrieved deal data and documents, and the prompts forbid inventing facts. If the knowledge base is unreachable, it degrades gracefully to CRM-only answers.
- **Per-person, least-privilege access.** Each BD connects their own calendar once through an OAuth consent flow with read-only scope. Refresh tokens are encrypted at rest with AES-256-GCM.
- **Timezone-aware.** A minute-by-minute scheduler fires each BD's prep at their local morning, and records each run so nobody gets a brief twice.
- **Better retrieval through query rewriting.** One question becomes several targeted searches (product names, trading numbers, how-to angles), which are merged and de-duplicated.

## Structure

```
src/
  index.ts               Slack bot (Socket Mode) + scheduler start-up
  config.ts              env-based config
  meetingPrep/           find client calls, build and send briefs, per-timezone scheduler
  qa/answer.ts           the @mention question-answering pipeline
  integrations/          claude.ts, pipedrive.ts, google.ts, slack.ts, kb.ts (RAG retrieval)
  oauth/server.ts        Google OAuth consent + callback
  storage/               encrypted OAuth tokens, prep-run log
  data/roster.ts         BD roster loader (email, Slack ID, timezone)
  scripts/               one-off tools: ask from the CLI, probe the knowledge base, fill timezones
data/
  bds.example.csv        example roster; copy to bds.csv with your BDs
```

## Run it

```bash
npm install
cp .env.example .env                    # add your keys
cp data/bds.example.csv data/bds.csv    # your BDs: email, Slack ID, timezone
npm run typecheck
npm run dev                             # start the bot and the scheduler
npm run ask -- "what changed on the Acme deal?"   # try the Q&A from the terminal
```

## Built with

TypeScript, Node, the Claude API, the Slack API (Bolt, Socket Mode), the Pipedrive API, the Google Calendar API (OAuth), a Chroma-based retrieval service. Developed with Claude Code as an engineering pair.

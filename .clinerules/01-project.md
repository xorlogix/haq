# Haq — project rules for Cline

Haq is an AI caseworker for Indian citizens. A Cline SDK agent (server/agent/caseworker.ts) turns a civic problem into a complaint, an RTI application, deadlines and an escalation plan.

## Stack
- Node 22+, TypeScript run with `tsx` (no build step). Express API in `server/index.ts`.
- Front end: plain HTML/CSS/ES modules in `public/` — no framework, no bundler. Keep it that way.
- Agent: `@cline/sdk` `Agent` with custom tools from `server/agent/tools.ts` (created with `createTool` + zod v4 schemas).
- Knowledge base: `server/kb/authorities.json` and `server/kb/laws.json`, read fresh on every tool call.

## Commands
- `npm start` — run the app on http://localhost:3000
- `npm test` — end-to-end smoke test (runs real cases through the agent loop; demo model when no key)
- `npm run check` — TypeScript type check. Run it after every change.

## Rules
- Never let the LLM do date math: deadlines come from `server/deadlines.ts`.
- Every new document type needs checks in `server/agent/review.ts`; the agent must pass `review_draft` before finishing.
- Never invent phone numbers, portals or legal sections. New authority/law entries must cite something the human has verified; mark uncertain URLs as `null` with a note.
- Citizen-facing text must work in Hindi and other Indian languages — no English-only UI strings in the summary path.
- Keep the offline demo model (`server/agent/demoModel.ts`) working whenever tools change — it is the stage-demo fallback.

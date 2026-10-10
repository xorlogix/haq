# हक़ Haq — an AI caseworker for every Indian citizen

> Tell Haq your problem in your own language. It finds the office responsible, checks the law, writes a complaint and an RTI application that won't get rejected, tracks the legal deadlines, and drafts your appeal when the government doesn't reply.
>
> **Haq's caseworker is a Cline SDK agent.** It handles each case the way Cline handles a repo: it plans, uses tools, writes files into a case folder, checks its own work and fixes it.

Built for the **Cline AI Builder Hackathon, IIT Guwahati (10 Oct 2026)**.

---

## The problem

India has the laws to fix everyday problems, but people can't use them:

- A pothole sits outside a house for weeks. The family doesn't know whether it's the **municipal corporation, PWD or NHAI** that should fix it.
- A widow's pension stops. She goes to the block office twice and gets no answer. She has never heard of the **RTI Act**, or of the rule that the office must reply **within 30 days**.
- Someone loses ₹18,000 to a UPI scam. They don't know that reporting within **3 working days** can mean **zero liability** under RBI rules, or that **1930** can freeze the money.

The Right to Information Act, consumer law, electricity consumer rules, the RBI Ombudsman and Right-to-Services Acts all give citizens real power. But using that power means knowing **which office to approach, what to write, what the deadlines are and how to escalate**. That knowledge sits with lawyers, activists and a handful of RTI veterans. Everyone else gives up.

## The solution

Haq is a voice-first web app that works like a free, tireless caseworker:

1. **Tell it, or show it a notice.** Speak or type in Hindi, Hinglish, Assamese, Bengali, Tamil and other languages, attaching a photo of the pothole, notice or bill. Switch to **"Explain a notice I received"** mode and just attach a photo — Haq reads it and explains who sent it, what it wants, the deadline and what happens if you ignore it, without guessing anything it can't actually read.
2. **Watch it work.** A live log shows the agent's Plan → Act → Verify loop: finding the authority, looking up the law, drafting the papers, running the filing checklist and fixing anything it flags — rendered as readable text, not raw markdown.
3. **Get a case file** with:
   - a **plain-language summary in your language** that you can play aloud for low-literacy users, and the whole **interface itself in English or हिन्दी**,
   - the **responsible authority**, with the real portal, helpline and escalation ladder,
   - a **formal complaint** and an **RTI application under Sec. 6(1)**, always drafted in **English** (every office accepts it) — with a one-tap **"Get a copy in [your language]"** translation for your own understanding, never the file-ready version,
   - blanks for your details, a fill-in editor, print-to-PDF, WhatsApp sharing, and a **"Print full case file"** button that lays out the summary, steps, checklist and every document (one per page) for a single printout,
   - **statutory deadlines** worked out by code, not guessed by the LLM.
4. **Mark as filed.** Haq counts the days. When the 30-day RTI deadline passes, one tap tells the caseworker to draft the **First Appeal under Sec. 19(1)**, check it, and update your next steps and deadlines.
5. **Run it with zero setup.** No API key? Haq automatically reuses the Cline account already signed into this machine — judges and teammates get live AI with just `npm install && npm start`.

### What makes it different
| | Typical "AI legal chatbot" | Haq |
|---|---|---|
| Authority & helplines | Hallucinated from model memory | Grounded tool calls to a curated directory (city → state → national) |
| Drafts | Free text, often rejected (e.g. "why" questions in an RTI, over the word limit, missing PIN code) | A deterministic **filing checklist**, language-aware (English and Hindi), that the agent must pass. It rewrites the draft until it does |
| Deadlines | "Usually about a month" | Exact dates from the statute's rules (RTI 30 days → first appeal +30 → second appeal +90) |
| After the chat | Nothing | A persistent case with countdowns, one-tap escalation and a one-tap full-case printout |
| Language | English | Official papers always in English (accepted everywhere); the citizen's language for the summary, the UI, and an on-demand translated copy of any document |
| Notices | Can't read a photo of a government/bank/court notice | A dedicated mode reads the photo and explains sender, demand, deadline and consequences — or says plainly if it can't read it |
| Setup | Needs an API key from day one | Reuses the Cline account already signed into this machine — zero config |

## Cline inside the product

Every case is a Cline SDK `Agent` session (`server/agent/caseworker.ts`):

```ts
import { Agent } from "@cline/sdk";

const agent = new Agent({
  providerId: "cline",                  // or cline-pass, anthropic, gemini, ollama …
  modelId: "anthropic/claude-sonnet-5",
  apiKey: process.env.CLINE_API_KEY,
  systemPrompt: systemPrompt(),         // caseworker playbook: plan → act → verify
  tools: buildCaseTools(caseId),        // custom tools bound to this case folder
  toolExecution: "sequential",
  maxIterations: 24,
});
agent.subscribe(streamToCaseTrace);     // tool-started / tool-finished / text deltas → live UI over SSE
await agent.run(intakeMessageWithOptionalPhoto);
// later: await agent.continue("The RTI got no reply in 30 days — escalate.")
```

**Custom tools** (built with `createTool` and zod schemas, in `server/agent/tools.ts`):

| Tool | What it does |
|---|---|
| `find_authorities` | Ranks 20+ grievance bodies (municipal corporations, PWD, NHAI, DISCOMs, CPGRAMS, RBI Ombudsman, cyber crime 1930, consumer commissions, PDS, PM-JAY, local Assam bodies such as GMC, APDCL and RTPS) by category and location |
| `lookup_law` | Returns citable provisions (RTI Act, RTI Rules 2012, Consumer Protection Act, Electricity Consumer Rules 2020, RBI Ombudsman Scheme, NFSA, MGNREGA, RTE, MV Act 198A…) |
| `write_document` | Writes the complaint, RTI or appeal as Markdown files in the case folder |
| `review_draft` | Runs the filing checklist, in English or Hindi: Sec. 6(1) cited, fee/BPL mentioned, numbered requests, **no "why" questions**, **≤500 words** (RTI) / **≤450 words** (complaint), addressee, location, PIN code, dates, relief, enclosures, and — for notice explainers — who sent it plus a deadline (or that none was found) |
| `compute_deadlines` | Statutory date arithmetic (RTI, first appeal, CPGRAMS 21 days, bank 30 days, consumer 2 years…) |
| `read_case_file` | Gives the agent memory of the case for follow-ups and escalation |
| `finalize_case` | Publishes the structured summary, steps and checklist (in the citizen's language) to the dashboard |

This uses the harness the way the Cline team describes it: **the right tools at the right time, failure detection and self-correction** (the review → rewrite loop), and **a model you can swap**. The same app runs on Cline usage billing, ClinePass open-weight models, or fully local with Ollama for privacy.

**Offline demo model:** if no API key is set, Haq swaps in a scripted `AgentModel` (`server/agent/demoModel.ts`). Everything else is still real: the Cline agent loop, the tools, the knowledge base, the reviewer and the case folder. The UI labels these runs *"Offline demo model"*. It's a safety net for stage demos with bad Wi-Fi.

## Architecture

```mermaid
flowchart LR
  U[Citizen<br/>voice · text · photo<br/>any Indian language] -->|Web Speech API| W[Web app<br/>public/]
  W -->|POST /api/cases| S[Express API<br/>server/index.ts]
  S --> A[Cline SDK Agent<br/>caseworker.ts]
  A <-->|LLM calls| M[(Model via Cline SDK<br/>Cline · ClinePass · Ollama…)]
  A --> T1[find_authorities] --> KB1[(authorities.json)]
  A --> T2[lookup_law] --> KB2[(laws.json)]
  A --> T3[write_document] --> F[(Case folder<br/>data/cases/ID/*.md)]
  A --> T4[review_draft<br/>filing checklist]
  T4 -. issues .-> A
  A --> T5[compute_deadlines]
  A --> T6[finalize_case] --> F
  A -- events --> S -- SSE live log --> W
  W -->|Mark filed · Escalate| S -->|agent.continue| A
```

```
haq/
├── server/
│   ├── index.ts              # REST + SSE API
│   ├── config.ts             # provider/model selection (live vs offline demo)
│   ├── deadlines.ts          # statutory date rules
│   ├── agent/
│   │   ├── caseworker.ts     # Cline SDK Agent lifecycle, event → trace streaming, continue()
│   │   ├── credentials.ts    # env key → local Cline sign-in → offline demo, resolved per agent
│   │   ├── tools.ts          # 7 custom tools (createTool + zod)
│   │   ├── review.ts         # deterministic, language-aware filing checklist
│   │   ├── prompt.ts         # caseworker playbook
│   │   └── demoModel.ts      # scripted AgentModel for offline demos
│   ├── cases/store.ts        # file-based case folders + event bus
│   └── kb/                   # authorities.json, laws.json (+ search)
├── public/                   # index.html, styles.css, app.js, i18n.js (no build step)
├── scripts/smoke.ts          # end-to-end test through the agent loop
├── .clinerules/              # rules Cline follows when working on this repo
└── docs/                     # demo script, Cline build prompts, social post
```

## Tech stack
- **Agent:** `@cline/sdk` 0.0.92 (`Agent`, `createTool`, streaming runtime events)
- **Models:** any Cline SDK provider. Default `cline` → `anthropic/claude-sonnet-5`. Also works with ClinePass open-weight models (GLM, Qwen, DeepSeek, Kimi…) and local Ollama
- **Backend:** Node 22, TypeScript (tsx), Express, zod v4, server-sent events, file-based case storage
- **Frontend:** vanilla HTML/CSS/JS, an `i18n.js` dictionary for the English/Hindi interface chrome, Web Speech API (speech-to-text in Indian languages), SpeechSynthesis (read-aloud), on-device photo downscaling, print-to-PDF stylesheets (single document and full case file), WhatsApp share
- **Type:** Mukta (Ek Type, Devanagari + Latin) for the UI, Courier Prime for "typed" official drafts

## Setup

```bash
git clone <this repo> haq && cd haq
npm install
npm start                   # → http://localhost:3000
npm test                    # optional: end-to-end smoke test
```

Haq picks its credentials in this order, no `.env` required if you're already signed into Cline:

1. **`HAQ_API_KEY` / `CLINE_API_KEY`** (or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` for other providers) — copy `.env.example` to `.env` and set one if you want to pin a specific key.
2. **The Cline account this machine is already signed into** — if you've signed into the Cline app/extension on this machine, Haq reuses that sign-in automatically for the `cline` and `cline-pass` providers. Zero config for judges and teammates: just `npm install && npm start`.
3. **The offline demo model** — if neither of the above is available (or `HAQ_MODE=demo` is set), Haq falls back to the scripted offline model. The real agent loop and tools still run; only the LLM is replaced.

The credential source actually in use (env key / signed-in Cline account / offline demo) is printed on startup and returned by `GET /api/status` — never the token itself. The token is re-resolved every time a case's agent is created, so a sign-in completed or refreshed after Haq started is picked up without a restart.

- **Change the model:** `HAQ_PROVIDER` / `HAQ_MODEL`, e.g. `cline-pass` + `cline-pass/glm-5.3`.
- **Voice input** works in Chrome/Edge (desktop and Android). Use `localhost` or HTTPS so the browser allows the microphone.

## How Cline was used

### Inside the product
See [Cline inside the product](#cline-inside-the-product). The caseworker *is* a Cline SDK agent with seven custom tools, a self-review loop and multi-turn escalation through `agent.continue()`.

### In the build
Cline (Plan → Act mode, model **Claude Sonnet 5** via Cline usage billing) was the coding partner for every change after the initial scaffold. The scaffold code was written before our Cline sessions started; `208dfc2` is simply the first commit of that existing code into a fresh git repo, made in our first Cline session, not code Cline authored. Project conventions live in [`.clinerules/`](.clinerules) (no LLM date math, every document type needs reviewer checks, never invent helplines) and guided every session; Cline ran `npm run check` and `npm test` after each change to verify its own work before moving on.

Commit-by-commit, from the real git history (after `208dfc2`, the initial-scaffold commit):
- `9e1adf0` feat: reuse local Cline sign-in for the caseworker agent — added `server/agent/credentials.ts` to resolve env key → the Cline account already signed into the machine → offline demo, re-resolved per case agent so judges/teammates get live AI with zero config.
- `f63f6d5` feat: translated citizen copies + English official drafts — made official documents (complaint, RTI, appeals, letters) always English, added the `POST /api/cases/:id/translate` endpoint and "explainer" document type for a faithful, blank-preserving translation of any document into the citizen's language.
- `d119fd1` feat: Hindi interface, printable case file, stricter complaint checks — built `public/i18n.js`, wired an English/हिन्दी toggle into the whole UI, added the "Print full case file" view, and tightened the complaint checklist (PIN code, 450-word cap).
- `eca6cd2` chore: ignore server_out.log / server_err.log — housekeeping while running a live background server for end-to-end testing.
- `80927c1` feat: explain-a-notice mode + log/stamp polish — added the "Explain a notice I received" photo-only intake mode (reads a notice, explains sender/demand/deadline/consequences without guessing), plus safe-markdown rendering of the agent's log messages and a stamp/case-cover layout fix found during live testing.

Each of these was driven by a plain-English task description, implemented end to end by Cline (reading the relevant files, writing the diffs, checking types, running the test suite, fixing anything it broke), then reviewed and committed.

## Challenges
- **Hallucinated authorities are dangerous.** A wrong helpline wastes a poor person's day. We moved every fact the model might invent (offices, portals, helplines, laws, deadlines) into tools backed by curated data and code.
- **"Valid" isn't the same as "accepted".** RTI applications get rejected for asking "why", for going over the word limit, or for being sent to the wrong addressee. We encoded these failure modes in a reviewer the agent must pass, the same detect-and-fix loop Cline uses for failing tests.
- **Language vs. legal register.** Citizens think in Hindi or Assamese, but offices expect formal English. Haq writes the summary in the citizen's language and the official papers in English, with highlighted blanks for personal details.
- **Demos on hackathon Wi-Fi.** We wrote an offline `AgentModel` so the real agent loop and tools still run without network access.

## Future scope
- **WhatsApp and IVR channels**, so people without smartphones can call, speak and receive a PDF.
- **Direct filing integrations** (CPGRAMS, state CM portals, rtionline.gov.in) and automatic status checks.
- **Community map** of anonymised cases, so a ward with 40 pothole complaints becomes a ward-level escalation (and a dashcam feed could open these cases automatically).
- **State packs**: per-state RTI fee rules, word limits and Right-to-Services timelines; more NE-state authorities.
- **Agent teams**: a "senior caseworker" subagent that reviews high-stakes cases (evictions, medical refusals) and routes them to free legal aid (NALSA 15100).

## Disclaimer
Haq prepares drafts and points to official channels. It is not a lawyer and does not file on your behalf. Verify portal links and helplines before filing. For court matters, contact your District Legal Services Authority (free legal aid, 15100).

## License
MIT

# Demo video script (≈3 minutes)

**Setup:** Chrome, `npm start` running, `.env` with `CLINE_API_KEY` (live model). Set browser zoom to 90% and clear old cases (`data/` folder). Keep `HAQ_MODE=demo` ready as a fallback.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:20 | Photo of a pothole / title card "हक़ Haq" | "There's a pothole outside Ramesh's house in Guwahati. A scooter rider fell last night. Ramesh doesn't know if it's GMC, PWD or NHAI, has never filed an RTI, and doesn't write formal English. Millions of Indians are stuck exactly here. That's why we built Haq." |
| 0:20–0:45 | Home screen → tap **Speak**, say in Hindi: *"GS Road pe Ganeshguri flyover ke paas bada gaddha hai, teen hafte se. Kal ek scooter wala gir gaya."* Add a photo → **Open my case** | "He just speaks, in Hindi, and adds a photo." |
| 0:45–1:25 | The live log on the left: authority → law → complaint → checklist → RTI → **red check: 'why' question** → rewrite → green | "This is a Cline SDK agent working the case like a repo. It finds the responsible office in our grounded directory, so it doesn't invent helplines, and pulls the relevant law. Then it drafts the complaint and the RTI. Watch this: the filing checklist catches a 'why' question, which PIOs reject. The agent rewrites it as a request for records and re-checks until it passes. Plan, act, verify, the same harness loop Cline uses on code." |
| 1:25–1:55 | DRAFTED stamp lands. "What to do" tab → **Read aloud** (Hindi TTS) → steps with GMC link | "Ramesh gets everything in Hindi, read aloud if he can't read well. The right office, the exact filing steps, and what evidence to keep." |
| 1:55–2:15 | RTI tab → highlighted blanks → **Fill in / edit** → Print / WhatsApp | "The papers are ready to file. Blanks are highlighted, and he can print, save a PDF or send it on WhatsApp." |
| 2:15–2:40 | Deadlines tab → set filed date to 35 days ago → **Mark as filed** → red **No reply — draft my First Appeal** → agent drafts Sec. 19(1) appeal → APPEAL stamp | "Haq doesn't stop at a chat. The deadlines come from the statute, not the model. When the department stays silent past 30 days, one tap and the same agent continues the case and writes the First Appeal." |
| 2:40–2:55 | VS Code: Cline panel building feature #1 from `docs/CLINE_BUILD_PROMPTS.md` (Plan → Act, running `npm test`) | "We built Haq with Cline as our coding partner. Here it's adding translated copies of drafts, and it runs our tests to check its own work. Our `.clinerules` keep it from inventing helplines, the same rule the product follows." |
| 2:55–3:00 | Title: "Haq — every citizen's caseworker. Built with Cline." | "Haq. Your right, in your language." |

**Backup plan:** if the network drops, restart with `HAQ_MODE=demo npm start`. The agent loop, tools and checklist are the same, only the model is scripted. Say so honestly if asked.

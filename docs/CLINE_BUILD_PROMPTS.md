# Building Haq with Cline — session prompts

These are real features still on Haq's roadmap. Open the repo in VS Code with the Cline extension (or the Cline CLI). Start each one in **Plan mode**, review the plan, then switch to **Act**. Cline reads `.clinerules/` automatically.

Record your screen for at least two of them. The demo video must show Cline at work during the build. Commit after each feature (`git commit -m "feat: … (built with Cline)"`) so the history shows how the build went.

---

## 1. "Get it in my language" — a translated copy of any draft (≈20 min, visible in demo)
```
In Haq, add a "Get a copy in <citizen's language>" button to the document toolbar in public/app.js
(only when the case's user_language is not English). Clicking it should POST to a new endpoint
POST /api/cases/:id/translate { docId } in server/index.ts, which calls followUp() with an instruction
asking the caseworker agent to write a faithful translation of that document into the citizen's language
as a new document with doc_id "<docId>_<langcode>" and type "explainer", keeping the blanks in [brackets].
Make the offline demo model (server/agent/demoModel.ts) handle this instruction too: write a short
Hindi explainer of the document. Run npm run check and npm test when done.
```
Acceptance: new tab appears with the translated copy; it works in demo mode.

## 2. Hindi / English interface toggle (≈20 min)
```
Add a language toggle (English / हिन्दी) to the header of public/index.html. Move every UI string in
public/index.html and public/app.js into a small dictionary in public/i18n.js and translate them to
Hindi. Persist the choice in localStorage (wrapped in try/catch). Keep layout intact on mobile
(390px wide). Don't change agent output — only interface chrome.
```

## 3. "I got a notice" — explain any government/bank notice from a photo (≈30 min)
```
Add a second intake mode to Haq: "Explain a notice I received". When selected, the photo is required
and the intake message to the agent (startCase in server/agent/caseworker.ts) should ask the agent to
(1) read the notice in the image, (2) write an "explainer" document in the citizen's language: who sent
it, what it demands, by when, consequences of ignoring it, (3) if a reply is needed, draft it as a
"letter". Add review rules for type "explainer" in server/agent/review.ts (must mention a date/deadline
or say none found, must say who sent it). Update the prompt in server/agent/prompt.ts. Keep the demo
model working with a generic explainer.
```

## 4. Stronger complaint checklist (≈10 min)
```
In server/agent/review.ts add two checks for type "complaint": (a) a 6-digit Indian PIN code or a
[PIN code] blank must be present; (b) body under 400 words. Add unit-style assertions to
scripts/smoke.ts that a complaint missing a PIN fails review. Run npm test.
```

## 5. One-tap "case bundle" printout (≈15 min)
```
Add a "Print full case file" button to the case cover in public/index.html that opens a print view
containing the summary, next steps, checklist and every document, each starting on a new page
(CSS page-break-before). Reuse the existing md() renderer in public/app.js and the @media print rules.
```

## 6. More authorities for your region (≈15 min, needs your verification)
```
Add entries to server/kb/authorities.json for <your city/state> following the existing schema
(scope "city" or "state", categories, file_via, helpline, escalation). Only include URLs and helplines
that I confirm; set url to null with a note when unsure. Then run npm test.
```
Check every URL yourself before you commit it.

---

### Tips for the video
- Show the Plan → Act switch, Cline running `npm run check` / `npm test`, and Cline fixing a failing check by itself.
- Show `.clinerules/` and explain that the rules keep Cline from inventing helplines, which is the same principle the product follows.

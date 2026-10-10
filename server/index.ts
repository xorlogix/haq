import express from "express";
import { PORT, PUBLIC_DIR } from "./config.js";
import { createCase, listCases, loadCase, newCaseId, readDocument, saveImage, subscribe, updateCase, writeDocument, pushTrace } from "./cases/store.js";
import { startCase, followUp, isRunning, modelLabel, currentCredentials } from "./agent/caseworker.js";
import { credentialSourceLabel } from "./agent/credentials.js";
import { computeDeadlines, daysUntil, todayIST } from "./deadlines.js";
import { reviewDraft } from "./agent/review.js";
import { listCategories } from "./kb/index.js";

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/api/status", (_req, res) => {
  const creds = currentCredentials();
  res.json({
    mode: creds.mode,
    model: modelLabel(),
    credentialSource: credentialSourceLabel(creds.source),
    today: todayIST(),
    categories: listCategories(),
  });
});

app.post("/api/cases", (req, res) => {
  const { text, language, state, city, imageDataUrl, contactName } = req.body ?? {};
  if (typeof text !== "string" || text.trim().length < 8) {
    return res.status(400).json({ error: "Describe the problem in a sentence or two (what, where, since when)." });
  }
  const id = newCaseId();
  createCase({
    id,
    mode: currentCredentials().mode,
    model: modelLabel(),
    input: { text: text.trim().slice(0, 4000), language: language ?? "", state, city, hasImage: !!imageDataUrl, contactName },
  });
  const image = typeof imageDataUrl === "string" ? saveImage(id, imageDataUrl) : null;
  startCase(id, { text: text.trim().slice(0, 4000), language, state, city, contactName }, image ?? undefined);
  res.status(201).json({ id });
});

app.get("/api/cases", (_req, res) => {
  res.json(
    listCases().map((c) => ({
      id: c.id,
      title: c.title ?? c.input.text.slice(0, 80),
      status: c.status,
      urgency: c.urgency,
      createdAt: c.createdAt,
      filedAt: c.filedAt,
      nextDeadline: nextDeadline(c.deadlines),
    })),
  );
});

function nextDeadline(ds?: { date: string; label: string }[]) {
  if (!ds?.length) return null;
  const upcoming = ds.map((d) => ({ ...d, daysLeft: daysUntil(d.date) }));
  return upcoming.find((d) => d.daysLeft >= 0) ?? upcoming[upcoming.length - 1];
}

app.get("/api/cases/:id", (req, res) => {
  const c = loadCase(req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found" });
  const documents = c.documents.map((d) => ({ ...d, content: readDocument(c.id, d.id) ?? "" }));
  const deadlines = (c.deadlines ?? []).map((d) => ({ ...d, daysLeft: daysUntil(d.date) }));
  res.json({ ...c, documents, deadlines, running: isRunning(c.id) });
});

// Server-sent events: replay the trace, then stream live agent activity.
app.get("/api/cases/:id/events", (req, res) => {
  const c = loadCase(req.params.id);
  if (!c) return res.status(404).end();
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  for (const ev of c.trace) send(ev);
  const off = subscribe(c.id, send);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    off();
    clearInterval(ping);
  });
});

app.post("/api/cases/:id/filed", (req, res) => {
  const date = typeof req.body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : todayIST();
  try {
    const rec = updateCase(req.params.id, (r) => {
      r.filedAt = date;
      r.status = "filed";
      r.deadlines = computeDeadlines(r.deadline_tracks?.length ? r.deadline_tracks : ["rti", "follow_up"], date);
    });
    pushTrace(rec.id, { kind: "status", text: `Marked as filed on ${date}. Deadlines recalculated.` });
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

app.post("/api/cases/:id/resolved", (req, res) => {
  try {
    updateCase(req.params.id, (r) => {
      r.status = "resolved";
    });
    pushTrace(req.params.id, { kind: "status", text: "Marked as resolved 🎉" });
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

app.post("/api/cases/:id/message", (req, res) => {
  const c = loadCase(req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found" });
  if (isRunning(c.id)) return res.status(409).json({ error: "The caseworker is still working. Wait for it to finish." });
  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "Type a message." });
  updateCase(c.id, (r) => {
    if (r.status === "failed") r.status = "working";
  });
  followUp(c.id, text.slice(0, 2000));
  res.json({ ok: true });
});

app.post("/api/cases/:id/escalate", (req, res) => {
  const c = loadCase(req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found" });
  if (isRunning(c.id)) return res.status(409).json({ error: "The caseworker is still working." });
  updateCase(c.id, (r) => {
    r.status = "escalated";
  });
  followUp(
    c.id,
    `Escalate this case. The RTI was filed on ${c.filedAt ?? "[date]"} and no satisfactory reply has been received within 30 days. Draft the First Appeal under Section 19(1), review it, update deadlines and finalize the case again.`,
  );
  res.json({ ok: true });
});

// Language code suffix for a translated doc_id, e.g. "Hindi" -> "hi". Falls back to the
// first 2 letters if the language isn't in the map (keeps doc ids short and stable).
const LANG_CODE: Record<string, string> = {
  hindi: "hi",
  assamese: "as",
  bengali: "bn",
  tamil: "ta",
  telugu: "te",
  marathi: "mr",
  gujarati: "gu",
  kannada: "kn",
  malayalam: "ml",
  punjabi: "pa",
  odia: "or",
  urdu: "ur",
};

app.post("/api/cases/:id/translate", (req, res) => {
  const c = loadCase(req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found" });
  if (isRunning(c.id)) return res.status(409).json({ error: "The caseworker is still working. Wait for it to finish." });
  const docId = String(req.body?.docId ?? "").trim();
  const doc = c.documents.find((d) => d.id === docId);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  const lang = c.user_language || "";
  if (!lang || /^english$/i.test(lang)) return res.status(400).json({ error: "The citizen's language is English — no translation needed." });
  const code = LANG_CODE[lang.toLowerCase()] || lang.slice(0, 2).toLowerCase();
  const translatedId = `${docId}_${code}`;
  if (c.documents.some((d) => d.id === translatedId)) return res.status(409).json({ error: "That translation already exists." });
  followUp(
    c.id,
    `Write a faithful translation of the "${docId}" document into ${lang} for the citizen's own understanding. ` +
      `Save it with write_document using doc_id "${translatedId}" and type "explainer". Keep every [bracketed blank] exactly as in the English original — do not fill them in or translate the words inside the brackets. ` +
      `Add one line at the very top, in ${lang}, saying this is a translation for the citizen's understanding and that the English original ("${docId}") is the one to file. ` +
      `Do not change the English original. Call review_draft on "${translatedId}" afterwards.`,
  );
  res.json({ ok: true });
});

app.put("/api/cases/:id/documents/:docId", (req, res) => {
  const c = loadCase(req.params.id);
  const doc = c?.documents.find((d) => d.id === req.params.docId);
  if (!c || !doc) return res.status(404).json({ error: "Document not found" });
  const content = String(req.body?.content ?? "");
  const { file, createdAt, updatedAt, review, ...meta } = doc;
  writeDocument(c.id, meta, content);
  const r = reviewDraft(doc.type, content);
  updateCase(c.id, (rec) => {
    const d = rec.documents.find((x) => x.id === doc.id);
    if (d) d.review = r;
  });
  res.json({ ok: true, review: r });
});

app.listen(PORT, () => {
  const creds = currentCredentials();
  console.log(`\n  हक़  Haq is running →  http://localhost:${PORT}`);
  console.log(`  Caseworker model: ${modelLabel()}`);
  console.log(`  Credential source: ${credentialSourceLabel(creds.source)}`);
  if (creds.mode === "demo") {
    console.log(
      "  (No API key and no signed-in Cline account found — running the offline demo model. Set CLINE_API_KEY in .env, or sign in to Cline on this machine, for live AI.)\n",
    );
  }
});

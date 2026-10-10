/** Smoke test: runs full cases through the real Cline agent loop (demo model if no key) and checks the outputs. */
export {};
process.env.HAQ_DATA_DIR = process.env.HAQ_DATA_DIR ?? "data-test";
const { createCase, loadCase, newCaseId, readDocument, updateCase } = await import("../server/cases/store.js");
const { startCase, followUp, isRunning, modelLabel, currentCredentials } = await import("../server/agent/caseworker.js");
const { APPEAL_TRACKS, computeDeadlinesFromBases, daysUntil } = await import("../server/deadlines.js");

const wait = async (id: string) => { while (isRunning(id)) await new Promise((r) => setTimeout(r, 200)); };
const scenarios = [
  { text: "Mere ghar ke saamne GS Road pe bahut bada gaddha hai, 3 hafte se. Kal ek scooter wala gir gaya.", state: "Assam", city: "Guwahati", language: "Hindi" },
  { text: "Someone took Rs 18,000 from my account through a fake UPI collect request yesterday.", state: "Maharashtra", city: "Pune", language: "English" },
];
let failed = 0;
console.log("Model:", modelLabel());
for (const s of scenarios) {
  const id = newCaseId();
  createCase({ id, mode: currentCredentials().mode, model: modelLabel(), input: { ...s, hasImage: false } });
  await new Promise((r) => setTimeout(r, 10));
  startCase(id, s);
  await new Promise((r) => setTimeout(r, 50));
  await wait(id);
  const c = loadCase(id)!;
  const ok = c.status === "ready" && !!c.summary_for_citizen && c.documents.length >= 2 && c.documents.every((d) => d.review?.ok);
  console.log(`\n[${ok ? "PASS" : "FAIL"}] ${id} ${c.title} → ${c.primary_authority?.name}`);
  console.log("  docs:", c.documents.map((d) => `${d.id}(${d.review?.ok ? "✓" : "✗ " + d.review?.issues.join("|")})`).join(", "));
  console.log("  deadlines:", c.deadlines?.map((d) => `${d.date} ${d.kind}`).join(", "));
  console.log("  trace:", c.trace.filter((t) => t.kind === "tool-start").map((t) => t.tool).join(" → "));
  console.log("  summary:", c.summary_for_citizen?.slice(0, 160));
  const err = c.trace.find((t) => t.kind === "error"); if (err) console.log("  ERROR:", err.text);
  if (!ok) failed++;

  // Senior reviewer second opinion runs independently after finalize_case and must never
  // block the case from being "ready", even if it's still catching up.
  for (let i = 0; i < 40 && loadCase(id)!.second_opinion_status !== "done"; i++) await new Promise((r) => setTimeout(r, 100));
  const withOpinion = loadCase(id)!;
  const opinionOk =
    withOpinion.status === "ready" &&
    withOpinion.second_opinion_status === "done" &&
    !!withOpinion.second_opinion &&
    ["ready", "fix_first"].includes(withOpinion.second_opinion!.verdict) &&
    withOpinion.second_opinion!.score >= 1 &&
    withOpinion.second_opinion!.score <= 10 &&
    withOpinion.second_opinion!.points.length > 0 &&
    withOpinion.second_opinion!.points.length <= 5;
  console.log(`  [${opinionOk ? "PASS" : "FAIL"}] senior reviewer second opinion`, withOpinion.second_opinion);
  if (!opinionOk) failed++;

  if (s === scenarios[0]) {
    // The official RTI draft must be English even though the citizen wrote Hindi — "Get it in my language"
    // only translates a citizen-facing copy, it never changes what gets filed.
    const rtiEnglish = readDocument(id, "rti") ?? "";
    const rtiIsEnglish = !/[ऀ-ॿ]/.test(rtiEnglish);
    console.log(`  [${rtiIsEnglish ? "PASS" : "FAIL"}] official rti draft is in English (not the citizen's Hindi)`);
    if (!rtiIsEnglish) failed++;

    // Simulate an old RTI filing date (like the live bug report: filed long ago, now escalating),
    // so we can assert the appeal's own deadlines are NOT computed from that stale date.
    const oldFiledDate = "2026-09-01";
    updateCase(id, (r) => {
      r.filedAt = oldFiledDate;
      r.deadline_bases = { ...(r.deadline_bases ?? {}) };
      for (const track of r.deadline_tracks ?? []) {
        if (!APPEAL_TRACKS.has(track)) r.deadline_bases![track] = oldFiledDate;
      }
      r.deadlines = computeDeadlinesFromBases(r.deadline_bases!);
    });

    followUp(id, "Escalate: the RTI got no reply in 30 days. Draft the first appeal.");
    await new Promise((r) => setTimeout(r, 50));
    await wait(id);
    const c2 = loadCase(id)!;
    const appeal = c2.documents.find((d) => d.id === "first_appeal");
    console.log(`  [${appeal?.review?.ok ? "PASS" : "FAIL"}] escalation → first_appeal`, appeal?.review?.issues ?? "");
    if (!appeal?.review?.ok) failed++;
    console.log(readDocument(id, "rti")?.slice(0, 600));

    // Bug fix check: the first_appeal track's own base must not be the stale RTI filing date —
    // faa_decision must land in the future (computed from today, when the appeal was drafted).
    const faaDecision = c2.deadlines?.find((d) => d.kind === "faa_decision");
    const faaInFuture = !!faaDecision && daysUntil(faaDecision.date) >= 0;
    console.log(`  [${faaInFuture ? "PASS" : "FAIL"}] faa_decision (${faaDecision?.date ?? "missing"}) is in the future, not based on the stale RTI filing date ${oldFiledDate}`);
    if (!faaInFuture) failed++;

    // "Get a copy in Hindi" — the citizen asks for a translated copy of the RTI for their own understanding.
    // (Mirrors the message POST /api/cases/:id/translate sends via followUp().)
    followUp(
      id,
      `Write a faithful translation of the "rti" document into Hindi for the citizen's own understanding. ` +
        `Save it with write_document using doc_id "rti_hi" and type "explainer". Keep every [bracketed blank] exactly as in the English original — do not fill them in or translate the words inside the brackets. ` +
        `Add one line at the very top, in Hindi, saying this is a translation for the citizen's understanding and that the English original ("rti") is the one to file. ` +
        `Do not change the English original. Call review_draft on "rti_hi" afterwards.`,
    );
    await new Promise((r) => setTimeout(r, 50));
    await wait(id);
    const c3 = loadCase(id)!;
    const translated = c3.documents.find((d) => d.id === "rti_hi");
    const translatedOk = !!translated && translated.type === "explainer" && !!translated.review?.ok;
    console.log(`  [${translatedOk ? "PASS" : "FAIL"}] translate → rti_hi (explainer)`, translated?.review?.issues ?? (translated ? "" : "not created"));
    if (!translatedOk) failed++;
    if (translated) {
      const originalBlanks = (readDocument(id, "rti")?.match(/\[[^\]]{2,80}\]/g) ?? []).length;
      const translatedBlanks = (readDocument(id, "rti_hi")?.match(/\[[^\]]{2,80}\]/g) ?? []).length;
      const blanksKept = originalBlanks > 0 && translatedBlanks === originalBlanks;
      console.log(`  [${blanksKept ? "PASS" : "FAIL"}] translation keeps all ${originalBlanks} blanks (found ${translatedBlanks})`);
      if (!blanksKept) failed++;
      const rtiOriginalUnchanged = !/[ऀ-ॿ]/.test(readDocument(id, "rti") ?? "");
      console.log(`  [${rtiOriginalUnchanged ? "PASS" : "FAIL"}] English rti original unchanged by the translation`);
      if (!rtiOriginalUnchanged) failed++;
    }
  }
}

// "I got a notice" mode: no problem text required, a photo stands in for the notice.
{
  const id = newCaseId();
  createCase({
    id,
    mode: currentCredentials().mode,
    model: modelLabel(),
    input: { text: "", language: "Hindi", state: "Assam", city: "Guwahati", hasImage: true, intakeMode: "notice" },
  });
  await new Promise((r) => setTimeout(r, 10));
  startCase(id, { text: "", language: "Hindi", state: "Assam", city: "Guwahati", intakeMode: "notice" }, { base64: "Zm9v", mediaType: "image/jpeg" });
  await new Promise((r) => setTimeout(r, 50));
  await wait(id);
  const c = loadCase(id)!;
  const explainer = c.documents.find((d) => d.id === "notice_explainer");
  const ok = c.status === "ready" && !!c.summary_for_citizen && !!explainer && explainer.type === "explainer" && !!explainer.review?.ok;
  console.log(`\n[${ok ? "PASS" : "FAIL"}] notice mode → ${id} ${c.title}`);
  console.log("  docs:", c.documents.map((d) => `${d.id}(${d.review?.ok ? "✓" : "✗ " + d.review?.issues.join("|")})`).join(", "));
  console.log("  trace:", c.trace.filter((t) => t.kind === "tool-start").map((t) => t.tool).join(" → "));
  console.log("  summary:", c.summary_for_citizen?.slice(0, 160));
  const err = c.trace.find((t) => t.kind === "error"); if (err) console.log("  ERROR:", err.text);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);

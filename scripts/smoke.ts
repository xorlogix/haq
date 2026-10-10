/** Smoke test: runs full cases through the real Cline agent loop (demo model if no key) and checks the outputs. */
export {};
process.env.HAQ_DATA_DIR = process.env.HAQ_DATA_DIR ?? "data-test";
const { createCase, loadCase, newCaseId, readDocument } = await import("../server/cases/store.js");
const { startCase, followUp, isRunning, modelLabel } = await import("../server/agent/caseworker.js");
const { MODEL_CONFIG } = await import("../server/config.js");

const wait = async (id: string) => { while (isRunning(id)) await new Promise((r) => setTimeout(r, 200)); };
const scenarios = [
  { text: "Mere ghar ke saamne GS Road pe bahut bada gaddha hai, 3 hafte se. Kal ek scooter wala gir gaya.", state: "Assam", city: "Guwahati", language: "Hindi" },
  { text: "Someone took Rs 18,000 from my account through a fake UPI collect request yesterday.", state: "Maharashtra", city: "Pune", language: "English" },
];
let failed = 0;
console.log("Model:", modelLabel());
for (const s of scenarios) {
  const id = newCaseId();
  createCase({ id, mode: MODEL_CONFIG.mode, model: modelLabel(), input: { ...s, hasImage: false } });
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
  if (s === scenarios[0]) {
    followUp(id, "Escalate: the RTI got no reply in 30 days. Draft the first appeal.");
    await new Promise((r) => setTimeout(r, 50));
    await wait(id);
    const c2 = loadCase(id)!;
    const appeal = c2.documents.find((d) => d.id === "first_appeal");
    console.log(`  [${appeal?.review?.ok ? "PASS" : "FAIL"}] escalation → first_appeal`, appeal?.review?.issues ?? "");
    if (!appeal?.review?.ok) failed++;
    console.log(readDocument(id, "rti")?.slice(0, 600));
  }
}
process.exit(failed ? 1 : 0);

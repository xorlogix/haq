// Haq front end — no build step. Talks to the Express API and streams the Cline agent's work over SSE.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const LANG_CODES = { hindi: "hi-IN", english: "en-IN", assamese: "as-IN", bengali: "bn-IN", tamil: "ta-IN", telugu: "te-IN", marathi: "mr-IN", gujarati: "gu-IN", kannada: "kn-IN", malayalam: "ml-IN", punjabi: "pa-IN", odia: "or-IN", urdu: "ur-IN" };

const state = { caseId: null, data: null, tab: "summary", es: null, lastStatus: null, editing: null, photo: null, refreshTimer: null };

// ---------- status + case list ----------
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

async function loadStatus() {
  try {
    const s = await api("/api/status");
    const b = $("#modelBadge");
    b.textContent = s.mode === "demo" ? "Offline demo model" : `Cline SDK · ${s.model.split("·").pop().trim()}`;
    b.classList.toggle("demo", s.mode === "demo");
    b.title = s.mode === "demo" ? "No API key configured: the Cline agent loop and tools are real, the model is scripted." : `Caseworker runs on the Cline SDK with ${s.model}`;
  } catch { $("#modelBadge").textContent = "offline"; }
}

function statusPill(c) {
  const nd = c.nextDeadline;
  if (c.status === "filed" && nd && nd.daysLeft < 0) return `<span class="pill overdue">overdue</span>`;
  const label = { working: "working", ready: "ready to file", filed: "filed", escalated: "appeal", resolved: "resolved", failed: "needs attention" }[c.status] || c.status;
  return `<span class="pill ${c.status}">${label}</span>`;
}

async function loadCases() {
  const list = await api("/api/cases").catch(() => []);
  const ul = $("#caseList");
  if (!list.length) { ul.innerHTML = `<li class="muted">No cases yet. Your cases stay on this device's server.</li>`; return; }
  ul.innerHTML = list.map((c) => {
    const nd = c.nextDeadline;
    const sub = nd ? (nd.daysLeft >= 0 ? `${nd.label} · ${nd.daysLeft} days left` : `${nd.label} · ${-nd.daysLeft} days ago`) : new Date(c.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    return `<li><button data-id="${esc(c.id)}" ${c.id === state.caseId ? 'aria-current="true"' : ""}><span class="t">${esc(c.title)}</span>${statusPill(c)}<span class="s">${esc(sub)}</span></button></li>`;
  }).join("");
}
$("#caseList").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-id]");
  if (b) openCase(b.dataset.id);
});

// ---------- voice input (Web Speech API, works in Chrome/Edge on Android & desktop) ----------
function attachMic(button, field, getLang, labelEl) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { button.title = "Voice input needs Chrome or Edge"; button.addEventListener("click", () => field.focus()); return; }
  let rec = null;
  button.addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = getLang();
    rec.interimResults = true;
    rec.continuous = true;
    const base = field.value ? field.value.trimEnd() + " " : "";
    rec.onresult = (ev) => {
      let text = "";
      for (const r of ev.results) text += r[0].transcript;
      field.value = base + text;
    };
    rec.onend = () => { rec = null; button.setAttribute("aria-pressed", "false"); if (labelEl) labelEl.textContent = "Speak"; };
    rec.onerror = () => rec?.stop();
    rec.start();
    button.setAttribute("aria-pressed", "true");
    if (labelEl) labelEl.textContent = "Listening… tap to stop";
  });
}
attachMic($("#micBtn"), $("#problem"), () => $("#lang").value, $("#micLabel"));
attachMic($("#followMic"), $("#followText"), () => LANG_CODES[(state.data?.user_language || "").toLowerCase()] || $("#lang").value);

// ---------- photo: downscale on device so it uploads fast on 3G ----------
$("#photo").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  state.photo = canvas.toDataURL("image/jpeg", 0.82);
  $("#photoText").textContent = `Photo added: ${file.name.slice(0, 24)}`;
  $("#photoLabel").classList.add("has-photo");
});

// ---------- examples ----------
document.querySelectorAll(".chip").forEach((chip) => chip.addEventListener("click", () => {
  $("#problem").value = chip.dataset.text;
  $("#lang").value = chip.dataset.lang;
  $("#city").value = chip.dataset.city;
  $("#state").value = chip.dataset.state;
  $("#problem").focus();
}));

// ---------- open a case ----------
$("#intakeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#formError");
  err.hidden = true;
  const btn = $("#openBtn");
  btn.disabled = true;
  btn.textContent = "Opening…";
  try {
    const langOpt = $("#lang").selectedOptions[0];
    const { id } = await api("/api/cases", {
      method: "POST",
      body: JSON.stringify({ text: $("#problem").value, language: langOpt.dataset.name, city: $("#city").value.trim(), state: $("#state").value.trim(), imageDataUrl: state.photo }),
    });
    state.photo = null;
    $("#photoText").textContent = "Add a photo (optional)";
    $("#photoLabel").classList.remove("has-photo");
    $("#photo").value = "";
    await openCase(id);
    if (matchMedia("(max-width: 960px)").matches) $("#desk").scrollIntoView({ behavior: "smooth" });
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Open my case";
  }
});

async function openCase(id) {
  state.es?.close();
  state.caseId = id;
  state.tab = "summary";
  state.lastStatus = null;
  state.editing = null;
  $("#deskEmpty").hidden = true;
  $("#case").hidden = false;
  $("#log").innerHTML = "";
  $("#stamp").hidden = true;
  history.replaceState(null, "", `#${id}`);
  await refresh();
  state.es = new EventSource(`/api/cases/${encodeURIComponent(id)}/events`);
  state.es.onmessage = (m) => onEvent(JSON.parse(m.data));
  loadCases();
}

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(refresh, 250);
}

async function refresh() {
  if (!state.caseId) return;
  const c = await api(`/api/cases/${encodeURIComponent(state.caseId)}`).catch(() => null);
  if (!c) return;
  state.data = c;
  renderCover(c);
  renderTabs(c);
  if (!state.editing) renderPanel(c);
  $("#followForm").hidden = c.running;
}

// ---------- agent log ----------
const TOOL_TEXT = {
  find_authorities: (i) => `Finding the office responsible${i?.city ? ` in ${i.city}` : ""}`,
  lookup_law: (i) => `Checking your rights: ${(i?.topics || []).join(", ")}`,
  compute_deadlines: () => "Computing legal deadlines",
  write_document: (i) => `Drafting: ${i?.title || i?.doc_id}`,
  review_draft: (i) => `Checking ${i?.doc_id} against the filing checklist`,
  read_case_file: () => "Re-reading the case file",
  finalize_case: () => "Publishing your case summary",
};

function toolDetail(tool, out) {
  if (!out) return "";
  if (tool === "find_authorities") return (out.matches || []).slice(0, 3).join(" · ") || "no match";
  if (tool === "lookup_law") return (out.provisions || []).join(" · ");
  if (tool === "compute_deadlines") return (out.deadlines || []).slice(0, 3).join(" · ");
  if (tool === "write_document") return `${out.words} words saved to case folder`;
  if (tool === "review_draft") return out.ok ? `Passed all ${out.checked?.length} checks` : `${out.issues?.length} issue(s): ${out.issues?.join(" ")}`;
  if (tool === "finalize_case") return out.published ? "Dashboard updated" : "";
  return "";
}

function onEvent(ev) {
  const log = $("#log");
  const li = document.createElement("li");
  if (ev.kind === "tool-start") {
    li.className = "tool running";
    li.dataset.tool = ev.tool;
    li.innerHTML = `${esc((TOOL_TEXT[ev.tool] || (() => ev.tool))(ev.input))}<span class="detail"></span>`;
  } else if (ev.kind === "tool-end") {
    const open = [...log.querySelectorAll(`li.running[data-tool="${ev.tool}"]`)].pop();
    if (open) {
      open.classList.remove("running");
      if (ev.tool === "review_draft") open.classList.add(ev.output?.ok ? "pass" : "fail");
      const d = open.querySelector(".detail");
      d.textContent = toolDetail(ev.tool, ev.output);
      if (ev.tool === "review_draft" && !ev.output?.ok) d.classList.add("bad");
    }
    scheduleRefresh();
    return;
  } else if (ev.kind === "thought") {
    li.className = "thought";
    li.textContent = ev.text;
  } else if (ev.kind === "user") {
    li.className = "user";
    li.textContent = ev.text;
  } else if (ev.kind === "error") {
    li.className = "err";
    li.textContent = ev.text;
    scheduleRefresh();
  } else if (ev.kind === "status" || ev.kind === "done") {
    if (ev.kind === "done") loadCases();
    li.className = "thought";
    li.textContent = ev.text;
    scheduleRefresh();
  } else {
    scheduleRefresh();
    return;
  }
  log.appendChild(li);
  log.scrollTop = log.scrollHeight;
}

// ---------- cover + stamp ----------
const STAMPS = {
  ready: { text: "DRAFTED", hi: "तैयार", cls: "" },
  filed: { text: "FILED", hi: "दर्ज", cls: "filed" },
  escalated: { text: "APPEAL", hi: "अपील", cls: "" },
  resolved: { text: "RESOLVED", hi: "हल", cls: "filed" },
};

function renderCover(c) {
  $("#caseId").textContent = c.id;
  $("#caseModel").textContent = c.mode === "demo" ? "Offline demo model" : c.model;
  $("#caseTitle").textContent = c.title || (c.running ? "Caseworker is on it…" : c.input.text.slice(0, 90));
  $("#caseAuthority").textContent = c.primary_authority ? `Responsible: ${c.primary_authority.name}` : c.input.city || c.input.state ? `${[c.input.city, c.input.state].filter(Boolean).join(", ")}` : "";
  const em = $("#emergency");
  em.hidden = !c.emergency_note;
  em.textContent = c.emergency_note ? `⚠ ${c.emergency_note}` : "";
  const st = STAMPS[c.status];
  const stamp = $("#stamp");
  if (st && !c.running) {
    stamp.hidden = false;
    stamp.className = `stamp ${st.cls}`;
    stamp.innerHTML = `${st.text}<small>${st.hi} · ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</small>`;
    if (state.lastStatus && state.lastStatus !== c.status) { void stamp.offsetWidth; stamp.classList.add("slam"); }
    else if (state.lastStatus === null && c.running === false && c.trace?.at(-1)?.kind === "done" && Date.now() - c.updatedAt < 4000) stamp.classList.add("slam");
  } else stamp.hidden = true;
  if (!c.running) state.lastStatus = c.status;
}

// ---------- tabs ----------
function renderTabs(c) {
  const tabs = [];
  tabs.push({ id: "summary", label: "What to do" });
  for (const d of c.documents) {
    const mark = d.review ? (d.review.ok ? ` <span class="ok" aria-label="passed checks">✓</span>` : ` <span class="bad" aria-label="has issues">!</span>`) : "";
    tabs.push({ id: `doc:${d.id}`, label: `${shortTitle(d)}${mark}` });
  }
  tabs.push({ id: "deadlines", label: "Deadlines" });
  if (!tabs.some((t) => t.id === state.tab)) state.tab = "summary";
  $("#tabs").innerHTML = tabs.map((t) => `<button class="tab" role="tab" data-tab="${esc(t.id)}" aria-selected="${t.id === state.tab}">${t.label}</button>`).join("");
}
function shortTitle(d) {
  return { complaint: "Complaint", rti: "RTI", first_appeal: "First appeal", second_appeal: "Second appeal", explainer: "Explainer" }[d.type] || d.title.split("—")[0].trim();
}
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b || !state.data) return;
  state.tab = b.dataset.tab;
  state.editing = null;
  renderTabs(state.data);
  renderPanel(state.data);
});

// ---------- panels ----------
function renderPanel(c) {
  const panel = $("#panel");
  if (state.tab === "summary") return renderSummary(panel, c);
  if (state.tab === "deadlines") return renderDeadlines(panel, c);
  const doc = c.documents.find((d) => `doc:${d.id}` === state.tab);
  if (doc) return renderDoc(panel, c, doc);
}

function renderSummary(panel, c) {
  if (!c.summary_for_citizen) {
    panel.innerHTML = c.running
      ? `<p class="muted">The caseworker is researching and drafting. Watch its steps on the left — your papers appear here as tabs as soon as they're written.</p>`
      : `<p class="muted">No summary yet. ${c.status === "failed" ? "The caseworker stopped — see the log for why, then send a message to retry." : ""}</p>`;
    return;
  }
  const langCode = LANG_CODES[(c.user_language || "").toLowerCase()] || "en-IN";
  panel.innerHTML = `
    <div class="toolbar"><button class="secondary" id="speakBtn" type="button">🔊 Read aloud</button><span class="spacer"></span>${c.mode === "demo" ? `<span class="muted" style="font-size:13px">Offline demo model</span>` : ""}</div>
    <p class="summary-text" lang="${esc(langCode)}">${esc(c.summary_for_citizen)}</p>
    ${c.primary_authority ? `<h4>Who is responsible</h4><p><strong>${esc(c.primary_authority.name)}</strong><br><span class="muted">${esc(c.primary_authority.why)}</span></p>` : ""}
    <h4>Next steps</h4>
    <ol class="steps">${(c.filing_steps || []).map((s) => `<li>${esc(s.step)}${s.url ? ` — <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.replace(/^https?:\/\//, ""))}</a>` : ""}</li>`).join("")}</ol>
    <h4>Keep these ready</h4>
    <ul class="checklist">${(c.evidence_checklist || []).map((e, i) => `<li><label><input type="checkbox" data-k="${i}">${esc(e)}</label></li>`).join("")}</ul>`;
  $("#speakBtn").addEventListener("click", () => speak(c.summary_for_citizen, langCode));
  const key = `haq:check:${c.id}`;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || "{}"); } catch {}
  panel.querySelectorAll(".checklist input").forEach((cb) => {
    cb.checked = !!saved[cb.dataset.k];
    cb.addEventListener("change", () => { saved[cb.dataset.k] = cb.checked; try { localStorage.setItem(key, JSON.stringify(saved)); } catch {} });
  });
}

function speak(text, lang) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const v = speechSynthesis.getVoices().find((x) => x.lang?.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  if (v) u.voice = v;
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

function md(src) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[([^\]]{2,80})\]/g, '<span class="blank">[$1]</span>');
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const bul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const head = /^#{1,4}\s+(.*)$/.exec(line);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (head) { flushPara(); flushList(); out.push(`<p><strong>${inline(head[1])}</strong></p>`); continue; }
    if (num || bul) {
      flushPara();
      const tag = num ? "ol" : "ul";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((num || bul)[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join("");
}

function renderDoc(panel, c, doc) {
  const r = doc.review;
  const reviewHtml = r ? (r.ok ? `<div class="review ok">✓ Passed the filing checklist: ${esc(r.checked.join(", "))}</div>` : `<div class="review bad">Needs fixing: ${esc(r.issues.join(" "))}</div>`) : "";
  const editing = state.editing === doc.id;
  const lang = c.user_language || "";
  const isOfficial = doc.type !== "explainer";
  const alreadyTranslated = c.documents.some((d) => d.id !== doc.id && d.id.startsWith(`${doc.id}_`));
  const showTranslate = isOfficial && lang && !/^english$/i.test(lang) && !alreadyTranslated;
  panel.innerHTML = `
    <div class="toolbar">
      ${editing ? `<button class="secondary" id="saveDoc" type="button">Save changes</button><button class="ghost" id="cancelDoc" type="button">Cancel</button>`
                : `<button class="secondary" id="editDoc" type="button">Fill in / edit</button><button class="ghost" id="copyDoc" type="button">Copy text</button><button class="ghost" id="printDoc" type="button">Print / save PDF</button><button class="ghost" id="waDoc" type="button">Share on WhatsApp</button>${showTranslate ? `<button class="ghost" id="translateDoc" type="button" ${c.running ? "disabled" : ""}>Get a copy in ${esc(lang)}</button>` : ""}`}
      <span class="spacer"></span><span class="muted" style="font-size:13px">To: ${esc(doc.addressed_to)}</span>
    </div>
    ${reviewHtml}
    ${editing ? `<textarea class="sheet-edit" id="docEditor" spellcheck="true">${esc(doc.content)}</textarea>` : `<div class="sheet">${md(doc.content)}</div>`}`;
  if (editing) {
    $("#saveDoc").onclick = async () => {
      const content = $("#docEditor").value;
      await api(`/api/cases/${encodeURIComponent(c.id)}/documents/${encodeURIComponent(doc.id)}`, { method: "PUT", body: JSON.stringify({ content }) });
      state.editing = null;
      refresh();
    };
    $("#cancelDoc").onclick = () => { state.editing = null; renderPanel(c); };
    return;
  }
  $("#editDoc").onclick = () => { state.editing = doc.id; renderPanel(c); };
  $("#copyDoc").onclick = async (e) => { await navigator.clipboard.writeText(plain(doc.content)); e.target.textContent = "Copied"; };
  $("#printDoc").onclick = () => window.print();
  $("#waDoc").onclick = () => window.open(`https://wa.me/?text=${encodeURIComponent(plain(doc.content).slice(0, 3500))}`, "_blank", "noopener");
  const tr = $("#translateDoc");
  if (tr) tr.onclick = async () => {
    tr.disabled = true;
    try { await api(`/api/cases/${encodeURIComponent(c.id)}/translate`, { method: "POST", body: JSON.stringify({ docId: doc.id }) }); } catch (e) { alertInline(e.message); }
    refresh(); loadCases();
  };
}
const plain = (s) => s.replace(/\*\*(.+?)\*\*/g, "$1");

function renderDeadlines(panel, c) {
  const ds = c.deadlines || [];
  const today = new Date().toISOString().slice(0, 10);
  const overdue = ds.some((d) => d.daysLeft < 0 && /rti_reply|bank_reply|cpgrams/.test(d.kind));
  panel.innerHTML = `
    <h4>${c.filedAt ? `Filed on ${esc(c.filedAt)}` : "If you file today"}</h4>
    ${ds.length ? `<ul class="deadlines">${ds.map((d) => {
      const cls = d.daysLeft < 0 ? "over" : d.daysLeft <= 5 ? "soon" : "";
      const left = d.daysLeft < 0 ? `${-d.daysLeft} days ago` : d.daysLeft === 0 ? "today" : `${d.daysLeft} days left`;
      return `<li><span class="date">${esc(d.date)}</span><span>${esc(d.label)}<span class="basis">${esc(d.basis)}</span></span><span class="left ${cls}">${left}</span></li>`;
    }).join("")}</ul>` : `<p class="muted">Deadlines appear once the caseworker has planned them.</p>`}
    <div class="file-box">
      <label>Date you filed<input type="date" id="filedDate" value="${esc(c.filedAt || today)}" max="${today}"></label>
      <button class="secondary" id="markFiled" type="button">${c.filedAt ? "Update filing date" : "Mark as filed"}</button>
      ${c.filedAt && c.status !== "escalated" && c.status !== "resolved" ? `<button class="${overdue ? "primary danger" : "secondary"}" id="escalate" type="button">${overdue ? "No reply — draft my First Appeal" : "Escalate now"}</button>` : ""}
      ${c.filedAt && c.status !== "resolved" ? `<button class="ghost" id="resolved" type="button">It got solved</button>` : ""}
    </div>
    <p class="muted" style="font-size:14px;margin-top:10px">Haq counts the days for you. When a reply is overdue, one tap asks the caseworker to write the appeal.</p>`;
  $("#markFiled").onclick = async () => {
    await api(`/api/cases/${encodeURIComponent(c.id)}/filed`, { method: "POST", body: JSON.stringify({ date: $("#filedDate").value }) });
    refresh(); loadCases();
  };
  const esc8 = $("#escalate");
  if (esc8) esc8.onclick = async () => {
    esc8.disabled = true;
    try { await api(`/api/cases/${encodeURIComponent(c.id)}/escalate`, { method: "POST" }); } catch (e) { alertInline(e.message); }
    refresh(); loadCases();
  };
  const res = $("#resolved");
  if (res) res.onclick = async () => { await api(`/api/cases/${encodeURIComponent(c.id)}/resolved`, { method: "POST" }); refresh(); loadCases(); };
}

function alertInline(msg) {
  const li = document.createElement("li");
  li.className = "err";
  li.textContent = msg;
  $("#log").appendChild(li);
}

// ---------- follow-up chat ----------
$("#followForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#followText").value.trim();
  if (!text || !state.caseId) return;
  $("#followText").value = "";
  try {
    await api(`/api/cases/${encodeURIComponent(state.caseId)}/message`, { method: "POST", body: JSON.stringify({ text }) });
    $("#followForm").hidden = true;
  } catch (ex) { alertInline(ex.message); }
});

// ---------- boot ----------
loadStatus();
loadCases();
if (location.hash.length > 1) openCase(decodeURIComponent(location.hash.slice(1)));
setInterval(loadCases, 20000);

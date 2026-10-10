/**
 * Offline demo model.
 *
 * When no API key is configured, Haq swaps the LLM for this scripted AgentModel.
 * Everything else is real: the Cline SDK agent loop drives it, the real tools run
 * against the real knowledge base, the real reviewer checks drafts, and the case
 * folder is written to disk. The UI labels these runs "Offline demo".
 */
import type { AgentMessage, AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";

type Lang = "Hindi" | "English";

interface Playbook {
  key: string;
  match: RegExp;
  categories: string[];
  lawTopics: string[];
  title: (loc: string) => string;
  subject: string;
  facts: string;
  relief: string;
  rti: string[];
  tracks: string[];
  urgency: "low" | "medium" | "high" | "emergency";
  hiProblem: string;
}

const PLAYBOOKS: Playbook[] = [
  {
    key: "pothole",
    match: /pothole|gaddha|gadda|गड्ढ|road (is )?broken|sadak|सड़क|road damage|crater/i,
    categories: ["pothole", "roads"],
    lawTopics: ["pothole", "roads", "rti"],
    title: (l) => `Dangerous pothole on public road${l}`,
    subject: "Urgent repair of dangerous pothole(s) on a public road",
    facts: "A large pothole on the public road at the location below has made the road unsafe for two-wheelers, pedestrians, school children and ambulances. Vehicles swerve to avoid it and there is a serious risk of accidents, especially at night and during rain when it fills with water.",
    relief: "inspect the site and repair the pothole within 7 days, place warning barricades immediately, and fix responsibility on the contractor/department responsible for maintenance",
    rti: [
      "Certified copy of all complaints received about the road at the above location in the last 12 months and the action-taken report on each.",
      "Name of the contractor/agency responsible for construction and maintenance of this road stretch, with a copy of the work order and the defect-liability period.",
      "Amount sanctioned and spent on repair/maintenance of this road stretch in the last 2 financial years, with copies of measurement-book entries.",
      "Name and designation of the officer responsible for maintenance of this road stretch.",
      "Copy of the inspection reports of this road stretch for the last 12 months.",
    ],
    tracks: ["rti", "follow_up"],
    urgency: "high",
    hiProblem: "सड़क पर खतरनाक गड्ढा",
  },
  {
    key: "water",
    match: /water|pani|paani|पानी|tap|supply|nal\b|नल/i,
    categories: ["water"],
    lawTopics: ["rti", "service_delay", "general"],
    title: (l) => `No regular drinking water supply${l}`,
    subject: "Restoration of regular drinking water supply",
    facts: "Our locality has not been receiving regular piped drinking water supply. Households are forced to buy water or collect it from distant sources, which is especially hard for elderly people and children.",
    relief: "restore regular water supply within 7 days, repair any damaged pipeline, and share the supply schedule for the locality",
    rti: [
      "Certified copy of the water supply schedule approved for the above locality.",
      "Copies of all complaints received about water supply in this locality in the last 6 months and the action taken on each.",
      "Details of any pipeline repair or new connection work sanctioned for this locality, with the work order and status.",
      "Name and designation of the officer responsible for water supply in this area.",
    ],
    tracks: ["rti", "follow_up"],
    urgency: "high",
    hiProblem: "पीने के पानी की सप्लाई नहीं आ रही",
  },
  {
    key: "electricity",
    match: /electric|bijli|बिजली|power cut|light nahi|meter|transformer|voltage/i,
    categories: ["electricity", "power_cut"],
    lawTopics: ["electricity", "rti"],
    title: (l) => `Frequent power cuts / electricity supply problem${l}`,
    subject: "Frequent power cuts and failure to restore supply",
    facts: "Our area is facing frequent and prolonged power cuts. Complaints on the helpline have not resolved the problem. Students, patients and small businesses in the area are badly affected.",
    relief: "restore reliable supply, repair the faulty line/transformer within 7 days, and pay compensation as per the notified standards of performance",
    rti: [
      "Date-wise record of supply interruptions to the feeder serving the above area in the last 3 months.",
      "Copies of all complaints registered from this area in the last 3 months and the action taken on each.",
      "Copy of the notified standards of performance and the compensation payable for supply interruptions.",
      "Name and designation of the officer responsible for this feeder/sub-division.",
    ],
    tracks: ["rti", "follow_up"],
    urgency: "medium",
    hiProblem: "बार-बार बिजली कटौती",
  },
  {
    key: "garbage",
    match: /garbage|kachra|कचरा|waste|drain|nali|नाली|sewage|dustbin/i,
    categories: ["garbage", "sanitation", "drainage"],
    lawTopics: ["rti", "general"],
    title: (l) => `Garbage/drain not cleared${l}`,
    subject: "Uncleared garbage and blocked drain causing health hazard",
    facts: "Garbage has not been collected and the drain is blocked at the location below. The stench, mosquitoes and overflowing waste are a health hazard to residents, especially children.",
    relief: "clear the garbage and drain within 3 days and ensure regular door-to-door collection",
    rti: [
      "Copy of the garbage-collection schedule and route chart for the above ward.",
      "Name of the agency/contractor engaged for solid-waste collection in this ward and a copy of the contract.",
      "Copies of complaints received from this ward in the last 6 months and the action taken.",
      "Name and designation of the sanitation officer responsible for this ward.",
    ],
    tracks: ["rti", "follow_up"],
    urgency: "medium",
    hiProblem: "कचरा/नाली की सफाई नहीं हो रही",
  },
  {
    key: "pension",
    match: /pension|पेंशन|old age|widow|vridha|वृद्धा/i,
    categories: ["pension", "old_age_pension", "welfare_scheme"],
    lawTopics: ["rti", "pension", "general"],
    title: (l) => `Social security pension stopped/delayed${l}`,
    subject: "Release of pending social security pension",
    facts: "The pension sanctioned to the applicant has not been credited to the bank account for the period mentioned below, although all documents have been submitted. The applicant depends on this pension for daily needs and medicines.",
    relief: "release all pending pension instalments within 15 days and inform the applicant in writing of the reason for the delay",
    rti: [
      "Present status of the applicant's pension file, with certified copies of the file notings.",
      "Date-wise details of pension amounts released to the applicant's account in the last 12 months.",
      "If payment was stopped, a copy of the order stopping it and the name/designation of the officer who passed it.",
      "List of documents, if any, still pending from the applicant.",
    ],
    tracks: ["rti", "follow_up"],
    urgency: "high",
    hiProblem: "पेंशन रुकी हुई है",
  },
  {
    key: "fraud",
    match: /fraud|scam|upi|otp|धोखा|thagi|ठगी|cyber|hack/i,
    categories: ["cyber_fraud", "upi_fraud", "banking"],
    lawTopics: ["cyber_fraud", "banking"],
    title: () => `Online/UPI fraud — money lost`,
    subject: "Unauthorised electronic transaction — request to block, reverse and investigate",
    facts: "Money was debited from my account through an unauthorised/fraudulent online transaction. I did not authorise it. I am reporting it at the earliest.",
    relief: "immediately block further debits, place a hold on the beneficiary account, reverse the amount, and apply zero/limited customer liability as per RBI norms",
    rti: [
      "Status of the action taken on my fraud complaint, with copies of correspondence with the beneficiary bank.",
      "Details of any amount put on hold/lien in the beneficiary account linked to my complaint.",
    ],
    tracks: ["bank", "follow_up"],
    urgency: "emergency",
    hiProblem: "ऑनलाइन/UPI धोखाधड़ी",
  },
];

const GENERIC: Playbook = {
  key: "general",
  match: /.*/,
  categories: ["general", "state_govt"],
  lawTopics: ["rti", "general"],
  title: (l) => `Civic grievance${l}`,
  subject: "Grievance requiring action",
  facts: "I am facing the problem described below and earlier efforts to get it resolved have not worked.",
  relief: "look into the matter and resolve it within 15 days, informing me in writing of the action taken",
  rti: [
    "Present status of my grievance/application, with certified copies of file notings.",
    "Name and designation of the officer responsible for deciding it.",
    "Copy of the citizen charter/time limit applicable to this service.",
  ],
  tracks: ["rti", "follow_up"],
  urgency: "medium",
  hiProblem: "शिकायत",
};

function textOf(m: AgentMessage): string {
  return m.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

function detectLang(s: string): Lang {
  if (/[ऀ-ॿ]/.test(s)) return "Hindi";
  if (/\b(hai|nahi|nahin|mera|meri|hamare|kya|bahut|paisa|sadak|gaddha|bijli|paani|raha|rahi)\b/i.test(s)) return "Hindi";
  return "English";
}

function field(s: string, label: string): string | undefined {
  const m = new RegExp(`${label}:\\s*(.+)`, "i").exec(s);
  const v = m?.[1]?.trim();
  return v && !/not given|unknown|^-$/i.test(v) ? v : undefined;
}

let callSeq = 0;
const id = () => `demo_${Date.now().toString(36)}_${++callSeq}`;

function* say(text: string): Generator<AgentModelEvent> {
  for (const chunk of text.match(/.{1,24}(\s|$)/g) ?? [text]) yield { type: "text-delta", text: chunk };
}

function* call(toolName: string, input: unknown, preface?: string): Generator<AgentModelEvent> {
  if (preface) yield* say(preface);
  yield { type: "tool-call-delta", toolCallId: id(), toolName, input };
  yield { type: "finish", reason: "tool-calls" };
}

function complaintMd(pb: Playbook, ctx: Ctx): string {
  const lawLine = ctx.laws.length ? `\nThis request is made in light of ${ctx.laws.join("; ")}.\n` : "";
  return `**To**
${ctx.authorityTitle}
${ctx.place || "[Office address]"}

**From**
[Your full name]
[Your address]${ctx.place ? `, ${ctx.place}` : ""}
[Phone number]

**Date:** [Date]

**Subject:** ${pb.subject}${ctx.place ? ` — ${ctx.place}` : ""}

Respected Sir/Madam,

I wish to bring the following problem to your urgent attention.

**Facts**
1. ${pb.facts}
2. In the citizen's own words: "${ctx.userText.replace(/\s+/g, " ").slice(0, 400)}"
3. Exact location: [House/landmark, street, ward number, PIN code]${ctx.place ? `, ${ctx.place}` : ""}.
4. The problem has existed since [date / number of days]. Earlier complaint(s), if any: [complaint number and date].
${lawLine}
**Relief requested**
I request you to kindly ${pb.relief}. Please send me a written acknowledgement with a complaint number.

**Enclosures**
1. Photograph(s) of the problem${ctx.hasImage ? " (attached)" : ""}
2. Copy of earlier complaint(s), if any
3. Copy of identity/address proof

Yours faithfully,

[Signature]
[Your full name]`;
}

function rtiMd(pb: Playbook, ctx: Ctx, withMistake: boolean): string {
  const qs = [...pb.rti];
  if (withMistake) qs.push("Why has the department failed to solve this problem so far?");
  return `**To**
The Public Information Officer
${ctx.authorityTitle}
${ctx.place || "[Office address]"}

**Subject:** Application for information under Section 6(1) of the Right to Information Act, 2005

Respected Sir/Madam,

I request the following information regarding: ${pb.subject.toLowerCase()} at [exact location]${ctx.place ? `, ${ctx.place}` : ""}.

${qs.map((q, i) => `${i + 1}. ${q}`).join("\n")}

I am a citizen of India. The application fee of ₹10 is paid by [Indian Postal Order / DD / online payment no. ______] (or: I belong to the BPL category; copy of BPL card attached).

If any of this information is held by another public authority, please transfer this application under Section 6(3) within 5 days and inform me.

Please provide the information within 30 days as required under Section 7(1).

Name: [Your full name]
Address: [Your address]
Phone: [Phone number]
Date: [Date]
Place: ${ctx.city ?? "[Place]"}

[Signature]`;
}

function appealMd(ctx: Ctx): string {
  return `**To**
The First Appellate Authority
(under the Right to Information Act, 2005)
${ctx.authorityTitle}

**Subject:** First Appeal under Section 19(1) of the RTI Act, 2005

Respected Sir/Madam,

1. I filed an RTI application dated [date of RTI application] with the Public Information Officer, ${ctx.authorityTitle}, regarding the matter recorded in case ${ctx.caseRef}.
2. The 30-day period under Section 7(1) has expired and no information has been received (or: the reply dated [date] is incomplete/unsatisfactory).
3. Under Section 7(2), failure to reply within the time limit is deemed refusal, and under Section 7(6) the information must now be supplied free of charge.

**Prayer**
I request you to direct the PIO to supply the complete information free of charge within 15 days, and to take action as per law for the delay.

**Enclosures:** Copy of RTI application, proof of fee payment, postal/online receipt, reply (if any).

Name: [Your full name]
Address: [Your address]
Date: [Date]

[Signature]`;
}

/**
 * Offline-demo translation: a short, faithful Hindi (or other language) explainer of an
 * official document, keeping every [bracketed blank] exactly as the English original — never
 * filled in or translated — and a top line marking it as a translation, not the filing copy.
 */
function translationMd(sourceId: string, targetLang: string, sourceContent: string): string {
  const blanks = [...sourceContent.matchAll(/\[[^\]]{2,80}\]/g)].map((m) => m[0]);
  const docLabel = { complaint: "complaint", rti: "RTI application", first_appeal: "First Appeal", letter: "letter" }[sourceId.replace(/_.*$/, "")] ?? "document";
  if (targetLang === "Hindi") {
    return `*यह आपकी समझ के लिए अनुवाद है — फाइल करने के लिए अंग्रेज़ी मूल ("${sourceId}") का उपयोग करें।*

यह आपके ${docLabel} का हिंदी अनुवाद है, ताकि आप समझ सकें कि इसमें क्या लिखा है। इसे वैसे ही फाइल न करें — अंग्रेज़ी वाली कॉपी ही संबंधित कार्यालय को भेजें।

मुख्य बातें:
- यह आवेदन/शिकायत आपकी समस्या के समाधान के लिए ज़िम्मेदार कार्यालय को भेजी जा रही है।
- इसमें आपकी समस्या, स्थान और मांगी गई राहत/जानकारी का विवरण है।
- नीचे दी गई खाली जगहें ([ ] में) आपको खुद भरनी हैं — अंग्रेज़ी मूल में भी यही खाली जगहें हैं:

${blanks.length ? blanks.map((b) => `- ${b}`).join("\n") : "- (कोई खाली जगह नहीं मिली)"}

कृपया अंग्रेज़ी मूल प्रति ही संबंधित कार्यालय में जमा करें।`;
  }
  return `*This is a translation for your understanding — file the English original ("${sourceId}").*

This is a ${targetLang} translation of your ${docLabel}, so you can understand what it says. Do not file this copy — send the English original to the office.

Key points:
- This document is being sent to the office responsible for fixing your problem.
- It describes your problem, location, and the relief/information requested.
- The blanks below (in [ ]) are yours to fill in — the English original has the same blanks:

${blanks.length ? blanks.map((b) => `- ${b}`).join("\n") : "- (no blanks found)"}

Please file the English original with the office.`;
}

/**
 * Offline-demo "I got a notice" explainer. The scripted demo model can't actually read an
 * attached photo, so — faithful to the rule never to guess what a notice says — it produces a
 * generic explainer that plainly states the sender and deadline could not be confidently read
 * from the image, and tells the citizen what to do about that, rather than inventing details.
 */
function noticeExplainerMd(lang: Lang): string {
  if (lang === "Hindi") {
    return `यह एक सामान्य व्याख्या है — ऑफ़लाइन डेमो मॉडल फ़ोटो को वास्तव में नहीं पढ़ सकता।

**यह नोटिस किसने भेजा:** फ़ोटो से भेजने वाले कार्यालय/बैंक/अदालत का नाम स्पष्ट रूप से नहीं पढ़ा जा सका। कृपया नोटिस के ऊपरी हिस्से में दिए गए कार्यालय का नाम और पता खुद जांचें।

**समय-सीमा:** फ़ोटो से कोई समय-सीमा स्पष्ट नहीं है — not clearly visible। नोटिस में दी गई तारीख को ध्यान से देखें।

**क्या करें:**
1. नोटिस को किसी साफ़ रोशनी में दोबारा फ़ोटो खींचकर अपलोड करें ताकि सही जानकारी मिल सके।
2. नोटिस पर दिए गए कार्यालय/बैंक/अदालत के संपर्क नंबर पर कॉल करके पुष्टि करें।
3. अगर यह अदालत से जुड़ा है, तो मुफ़्त कानूनी सहायता के लिए NALSA हेल्पलाइन 15100 पर संपर्क करें।

Haq गलत जानकारी गढ़ने के बजाय यह बताना बेहतर समझता है कि फ़ोटो से स्पष्ट जानकारी नहीं मिली।`;
  }
  return `This is a generic explainer — the offline demo model cannot actually read the attached photo.

**Who sent this notice:** The sending office/bank/court could not be confidently read from the image. Please check the letterhead and address printed at the top of the notice yourself.

**Deadline:** No deadline is clearly visible from the image — not clearly visible. Look carefully at any date printed on the notice.

**What to do:**
1. Re-photograph the notice in good light and upload it again so Haq can read it properly.
2. Call the contact number printed on the notice to confirm what it says.
3. If this is from a court, contact your District Legal Services Authority for free legal aid (NALSA helpline 15100).

Haq would rather say the image wasn't clearly readable than invent what the notice says.`;
}

interface Ctx {
  userText: string;
  lang: Lang;
  state?: string;
  city?: string;
  place: string;
  hasImage: boolean;
  authorityId: string;
  authorityName: string;
  authorityTitle: string;
  channelUrl: string | null;
  channelName: string;
  helpline: string;
  laws: string[];
  caseRef: string;
}

function parseToolOutputs(messages: readonly AgentMessage[]): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  for (const m of messages) for (const p of m.content) if (p.type === "tool-result") (out[p.toolName] ??= []).push((p as any).output);
  return out;
}

function summary(pb: Playbook, ctx: Ctx): { summary: string; steps: Array<{ step: string; url?: string | null }>; evidence: string[]; emergency: string | null } {
  const hi = ctx.lang === "Hindi";
  const url = ctx.channelUrl;
  if (hi) {
    return {
      summary: `आपकी समस्या (${pb.hiProblem}) के लिए ज़िम्मेदार विभाग है: ${ctx.authorityName}। हमने आपके लिए एक औपचारिक शिकायत और एक RTI आवेदन तैयार किया है — दोनों जाँच-सूची से पास हैं। RTI का जवाब 30 दिन में देना कानूनन ज़रूरी है। जवाब न मिले तो हक़ आपकी पहली अपील भी लिख देगा।`,
      steps: [
        { step: `शिकायत में खाली जगह ([Your full name] आदि) भरें और प्रिंट करें या कॉपी करें।`, url: null },
        { step: `${ctx.channelName} पर शिकायत दर्ज करें और शिकायत नंबर लिख लें।`, url },
        { step: `RTI आवेदन ₹10 शुल्क के साथ लोक सूचना अधिकारी (PIO) को डाक या ऑनलाइन भेजें।`, url: null },
        { step: `हक़ में "Mark as filed" दबाएँ — हम 30 दिन की समय-सीमा पर नज़र रखेंगे।`, url: null },
      ],
      evidence: ["समस्या की साफ़ फ़ोटो (तारीख के साथ)", "पहले की शिकायत का नंबर/कॉपी", "पहचान पत्र / पते का प्रमाण", "RTI शुल्क की रसीद (या BPL कार्ड)"],
      emergency: pb.urgency === "emergency" ? `तुरंत 1930 पर कॉल करें और cybercrime.gov.in पर शिकायत करें — जल्दी करने पर पैसा रोका जा सकता है।` : null,
    };
  }
  return {
    summary: `The body responsible for this (${pb.key}) is ${ctx.authorityName}. Haq has drafted a formal complaint and an RTI application — both pass the filing checklist. By law the RTI must be answered within 30 days; if it isn't, Haq will draft your First Appeal.`,
    steps: [
      { step: "Fill in the blanks in the complaint ([Your full name], address, dates) and print or copy it.", url: null },
      { step: `File the complaint via ${ctx.channelName} and note the complaint number.`, url },
      { step: "Send the RTI application to the Public Information Officer with the ₹10 fee (IPO/DD/online).", url: null },
      { step: "Press 'Mark as filed' in Haq so it can track the 30-day deadline.", url: null },
    ],
    evidence: ["Clear, dated photographs of the problem", "Number/copy of any earlier complaint", "ID / address proof", "RTI fee receipt (or BPL card)"],
    emergency: pb.urgency === "emergency" ? "Call 1930 right now and report at cybercrime.gov.in — fast reporting can freeze the money." : null,
  };
}

function* finalizeOrDone(pb: Playbook, ctx: Ctx, auth: any, run: Record<string, any[]>): Generator<AgentModelEvent> {
  if (!run.finalize_case) {
    const s = summary(pb, ctx);
    yield* call("finalize_case", {
      title: pb.title(ctx.place ? `, ${ctx.place}` : ""), category: pb.key, urgency: pb.urgency, user_language: ctx.lang,
      summary_for_citizen: s.summary, primary_authority_id: ctx.authorityId,
      primary_authority_why: auth?.why?.join("; ") ?? "Best match in directory",
      filing_steps: s.steps, evidence_checklist: s.evidence, emergency_note: s.emergency,
    }, "Publishing your case summary. ");
    return;
  }
  yield* say(ctx.lang === "Hindi" ? "आपकी फ़ाइल तैयार है।" : "Your case file is ready.");
  yield { type: "finish", reason: "stop" };
}

function bankLetterMd(ctx: Ctx): string {
  return `**To**
The Branch Manager / Nodal Grievance Redressal Officer
[Name of your bank], [Branch]

**From**
[Your full name], Account no. [XXXX last 4 digits]
[Your address] · [Registered mobile number]

**Date:** [Date]

**Subject:** Report of unauthorised electronic transaction — request to block, raise dispute and reverse

Respected Sir/Madam,

1. On [date and time], an amount of ₹[amount] was debited from my account through a transaction I did not authorise (UTR/reference no. [number]; beneficiary UPI ID/account [details]).
2. In my own words: "${ctx.userText.replace(/\s+/g, " ").slice(0, 300)}"
3. I reported this on the National Cyber Crime helpline 1930 / cybercrime.gov.in (acknowledgement no. [number]).

I request you to kindly:
- block further debits on my account/UPI immediately;
- raise a dispute and request the beneficiary bank to hold the amount;
- reverse the amount, applying zero/limited customer liability under the RBI circular on customer liability in unauthorised electronic banking transactions (2017), as I am reporting promptly;
- give me a written acknowledgement with a complaint number.

**Enclosures:** account statement showing the debit, screenshots of messages/calls, cyber-crime acknowledgement, ID proof.

Yours faithfully,
[Signature]
[Your full name]`;
}

/**
 * Offline demo for the senior reviewer: a tiny scripted model that calls
 * read_case_file once, then submits a positive second opinion. Keeps
 * HAQ_MODE=demo exercising the real reviewer agent loop and real tools.
 */
export function createDemoReviewerModel(): AgentModel {
  return {
    async *stream(req: AgentModelRequest) {
      await new Promise((r) => setTimeout(r, 300));
      const run = parseToolOutputs(req.messages);
      const caseFile = run.read_case_file?.[0];
      const lang: string = (caseFile?.user_language as string) || "English";
      const hi = /hindi/i.test(lang);
      if (!run.read_case_file) {
        yield* call("read_case_file", {}, hi ? "केस फ़ाइल पढ़ रहा हूँ। " : "Reading the case file. ");
        return;
      }
      // Submit exactly once per review. Without this guard the agent loop re-invokes the
      // scripted model after its own tool result, and it would call submit_second_opinion
      // again on every subsequent turn instead of stopping.
      if (run.submit_second_opinion) {
        yield { type: "finish", reason: "stop" };
        return;
      }
      yield* call("submit_second_opinion", {
        verdict: "ready",
        score: 8,
        points: hi
          ? [
              "सही विभाग चुना गया लगता है।",
              "ड्राफ्ट फाइलिंग चेकलिस्ट से पास हैं।",
              "फाइल करने से पहले अपना पता और तारीख जरूर भरें।",
            ]
          : [
              "The chosen authority looks right for this problem.",
              "The drafts pass the filing checklist and look acceptable to a government office.",
              "Fill in your address and the exact date before filing.",
            ],
      }, hi ? "जाँच पूरी हुई। " : "Review complete. ");
    },
  };
}

export function createDemoModel(caseRef: string): AgentModel {
  return {
    async *stream(req: AgentModelRequest) {
      await new Promise((r) => setTimeout(r, 450)); // feel like a model, keep the demo watchable
      const msgs = req.messages;
      const lastUserIdx = msgs.map((m) => m.role === "user" && m.content.some((p) => p.type === "text")).lastIndexOf(true);
      const firstUser = msgs.find((m) => m.role === "user");
      const lastUser = msgs[lastUserIdx];
      const runMsgs = msgs.slice(lastUserIdx + 1);
      const step = runMsgs.filter((m) => m.role === "assistant").length;
      const all = parseToolOutputs(msgs);
      const run = parseToolOutputs(runMsgs);

      const firstText = firstUser ? textOf(firstUser) : "";
      const problem = field(firstText, "Problem") ?? firstText;
      const pb = PLAYBOOKS.find((p) => p.match.test(problem)) ?? GENERIC;
      const state = field(firstText, "State");
      const city = field(firstText, "City");
      const auth = all.find_authorities?.[0]?.results?.[0];
      const ctx: Ctx = {
        userText: problem,
        lang: field(firstText, "Preferred language")?.match(/hindi/i) ? "Hindi" : detectLang(problem),
        state,
        city,
        place: [city, state].filter(Boolean).join(", "),
        hasImage: firstUser?.content.some((p) => p.type === "image") ?? false,
        authorityId: auth?.id ?? "state_cm_portal",
        authorityName: auth?.name ?? "the concerned department",
        authorityTitle: auth ? auth.name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+—.*$/, "").trim() : "[Name of office]",
        channelUrl: auth?.file_via?.find((f: any) => f.url)?.url ?? null,
        channelName: auth?.file_via?.[0]?.channel ?? "the department's grievance channel",
        helpline: auth?.helpline ?? "",
        laws: (all.lookup_law?.[0]?.provisions ?? []).slice(0, 2).map((p: any) => p.title),
        caseRef,
      };

      const isNoticeCase = !lastUserIdx && /received a government, bank or court notice/i.test(firstText);
      if (isNoticeCase) {
        switch (step) {
          case 0:
            yield* call("write_document", { doc_id: "notice_explainer", type: "explainer", title: "What this notice means", language: ctx.lang, addressed_to: "(for your understanding only — not for filing)", content: noticeExplainerMd(ctx.lang) }, ctx.lang === "Hindi" ? "फ़ोटो देख रहा हूँ और नोटिस समझाने की तैयारी कर रहा हूँ। " : "Reading the photo and preparing a plain-language explanation of the notice. ");
            return;
          case 1:
            yield* call("review_draft", { doc_id: "notice_explainer" });
            return;
          default: {
            if (!run.finalize_case) {
              yield* call("finalize_case", {
                title: ctx.lang === "Hindi" ? "प्राप्त नोटिस की व्याख्या" : "Notice received — explained",
                category: "notice",
                urgency: "medium",
                user_language: ctx.lang,
                summary_for_citizen:
                  ctx.lang === "Hindi"
                    ? "आपने जो नोटिस भेजा, हक़ ने उसे समझाने की कोशिश की है। कृपया 'Explainer' टैब में पूरी जानकारी देखें। अगर फ़ोटो साफ़ नहीं थी, तो कृपया बेहतर रोशनी में दोबारा फ़ोटो लेकर अपलोड करें।"
                    : "Haq has read the notice you shared and explained it in the 'Explainer' tab. If the photo wasn't clear enough, please re-photograph it in better light and upload again.",
                primary_authority_id: ctx.authorityId,
                primary_authority_why: "Best match based on the little that could be read from the notice; verify against the letterhead yourself.",
                filing_steps:
                  ctx.lang === "Hindi"
                    ? [{ step: "व्याख्या (Explainer) टैब में पूरा विवरण पढ़ें।" }, { step: "नोटिस पर दिए गए संपर्क नंबर से पुष्टि करें।" }]
                    : [{ step: "Read the full explanation in the Explainer tab." }, { step: "Confirm the details by calling the number printed on the notice." }],
                evidence_checklist: ctx.lang === "Hindi" ? ["नोटिस की स्पष्ट फ़ोटो", "जवाब भेजने की रसीद (अगर भेजें)"] : ["A clear photo of the notice", "Proof of any reply you send"],
                emergency_note: null,
              });
              return;
            }
            yield* say(ctx.lang === "Hindi" ? "नोटिस की व्याख्या तैयार है और जाँच-सूची से पास है।" : "The notice explainer is ready and passes the checklist.");
            yield { type: "finish", reason: "stop" };
          }
        }
        return;
      }

      const followUpText = lastUserIdx > 0 && lastUser ? textOf(lastUser) : "";
      const isFollowUp = lastUserIdx > 0 && msgs.slice(0, lastUserIdx).some((m) => m.role === "assistant");

      if (isFollowUp) {
        const translateMatch = /translation of the "([a-z0-9_-]+)".*into ([A-Za-z]+).*doc_id "([a-z0-9_-]+)"/is.exec(followUpText);
        if (translateMatch) {
          const [, sourceId, targetLang, translatedId] = translateMatch;
          switch (step) {
            case 0:
              yield* call("read_case_file", { doc_id: sourceId }, `Reading "${sourceId}" to translate it faithfully into ${targetLang}. `);
              return;
            case 1: {
              const sourceContent = (run.read_case_file?.[0]?.content as string | undefined) ?? "";
              yield* call(
                "write_document",
                { doc_id: translatedId, type: "explainer", title: `${targetLang} copy for your understanding`, language: targetLang, addressed_to: "(for your understanding only — not for filing)", content: translationMd(sourceId, targetLang, sourceContent) },
                "Writing a faithful translation, keeping every blank exactly as in the English original. ",
              );
              return;
            }
            case 2:
              yield* call("review_draft", { doc_id: translatedId });
              return;
            default:
              yield* say(targetLang === "Hindi" ? "अनुवाद तैयार है और जाँच-सूची से पास है।" : `The ${targetLang} copy is ready and passes the checklist.`);
              yield { type: "finish", reason: "stop" };
              return;
          }
        }
        const escalate = /escalat|appeal|no reply|not replied|jawab nahi|जवाब नहीं|deadline|30 days|overdue/i.test(followUpText);
        if (!escalate) {
          yield* say(
            ctx.lang === "Hindi"
              ? "आपकी फ़ाइल में शिकायत, RTI और समय-सीमा तैयार है। ऑफ़लाइन डेमो मोड में मैं सिर्फ़ तय सवालों का जवाब देता हूँ — असली बातचीत के लिए CLINE_API_KEY जोड़ें।"
              : "Your case folder already has the complaint, RTI and deadlines. In offline demo mode I only handle scripted actions (like escalation) — add a CLINE_API_KEY for open conversation.",
          );
          yield { type: "finish", reason: "stop" };
          return;
        }
        const appealReviews = run.review_draft ?? [];
        switch (step) {
          case 0: yield* call("read_case_file", {}, "Checking the case file and the RTI deadline. "); return;
          case 1: yield* call("write_document", { doc_id: "first_appeal", type: "first_appeal", title: "RTI First Appeal — Sec. 19(1)", language: "English", addressed_to: `First Appellate Authority, ${ctx.authorityTitle}`, content: appealMd(ctx) }, "The 30-day window has lapsed, so this is now a deemed refusal. Drafting the First Appeal. "); return;
          case 2: yield* call("review_draft", { doc_id: "first_appeal" }); return;
          case 3:
            if (appealReviews.at(-1)?.ok === false) { yield* call("write_document", { doc_id: "first_appeal", type: "first_appeal", title: "RTI First Appeal — Sec. 19(1)", language: "English", addressed_to: `First Appellate Authority, ${ctx.authorityTitle}`, content: appealMd(ctx) + "\n\nDate of RTI application: [date]" }); return; }
            yield* call("compute_deadlines", { tracks: ["first_appeal"] }, "Appeal passes the checklist. Computing the appeal deadlines. "); return;
          default: {
            if (!run.finalize_case) {
              const s = summary(pb, ctx);
              yield* call("finalize_case", {
                title: pb.title(ctx.place ? `, ${ctx.place}` : ""), category: pb.key, urgency: pb.urgency, user_language: ctx.lang,
                summary_for_citizen: ctx.lang === "Hindi" ? "RTI का जवाब 30 दिन में नहीं आया — यह कानूनन 'इनकार' माना जाता है। हक़ ने धारा 19(1) के तहत पहली अपील तैयार कर दी है। अब जानकारी आपको मुफ़्त मिलनी चाहिए (धारा 7(6))।" : "The RTI was not answered in 30 days, which counts as a deemed refusal. Haq has drafted your First Appeal under Section 19(1). The information must now be given free of charge (Sec. 7(6)).",
                primary_authority_id: ctx.authorityId, primary_authority_why: "Same public authority; appeal goes to its First Appellate Authority.",
                filing_steps: ctx.lang === "Hindi" ? [{ step: "पहली अपील प्रिंट करें, खाली जगह भरें, RTI की कॉपी साथ लगाएँ।" }, { step: "उसी विभाग के प्रथम अपीलीय अधिकारी को भेजें (कोई शुल्क नहीं)।" }] : [{ step: "Print the First Appeal, fill the blanks, attach a copy of the RTI and fee proof." }, { step: "Send it to the First Appellate Authority of the same office (no fee)." }],
                evidence_checklist: s.evidence, emergency_note: null,
              });
              return;
            }
            yield* say(ctx.lang === "Hindi" ? "पहली अपील तैयार है और जाँच-सूची से पास है।" : "First Appeal drafted and passed the checklist.");
            yield { type: "finish", reason: "stop" };
          }
        }
        return;
      }

      const rtiReviews = run.review_draft?.filter((r: any, i: number) => i > 0) ?? [];
      switch (step) {
        case 0:
          yield* call("find_authorities", { categories: pb.categories, keywords: problem.slice(0, 200), state, city },
            `Understood — this looks like a ${pb.key} problem${ctx.place ? ` in ${ctx.place}` : ""}. Finding the responsible authority. `);
          return;
        case 1:
          yield* call("lookup_law", { topics: pb.lawTopics }, `${ctx.authorityName} is the right body. Checking which laws give you leverage. `);
          return;
        case 2:
          yield* call("write_document", { doc_id: "complaint", type: "complaint", title: "Formal complaint", language: "English", addressed_to: ctx.authorityTitle, content: complaintMd(pb, ctx) }, "Drafting the formal complaint. ");
          return;
        case 3:
          yield* call("review_draft", { doc_id: "complaint" });
          return;
        case 4:
          if (pb.key === "fraud") {
            yield* call("write_document", { doc_id: "bank_letter", type: "letter", title: "Letter to your bank — dispute & freeze request", language: "English", addressed_to: "The Branch Manager / Nodal Grievance Officer, [Your bank]", content: bankLetterMd(ctx) }, "Complaint passes. Now a written dispute to your bank — this starts the RBI liability clock in your favour. ");
            return;
          }
          yield* call("write_document", { doc_id: "rti", type: "rti", title: "RTI application — Sec. 6(1)", language: "English", addressed_to: `Public Information Officer, ${ctx.authorityTitle}`, content: rtiMd(pb, ctx, true) }, "Complaint passes the checklist. Now the RTI application, so the department has to put its records on the table. ");
          return;
        case 5:
          yield* call("review_draft", { doc_id: pb.key === "fraud" ? "bank_letter" : "rti" });
          return;
        case 6:
          if (rtiReviews.at(-1)?.ok === false) {
            yield* call("write_document", { doc_id: "rti", type: "rti", title: "RTI application — Sec. 6(1)", language: "English", addressed_to: `Public Information Officer, ${ctx.authorityTitle}`, content: rtiMd(pb, ctx, false) }, "The checklist caught a 'why' question — PIOs can reject those. Rewriting it as a request for records. ");
            return;
          }
          yield* call("compute_deadlines", { tracks: pb.tracks });
          return;
        case 7:
          if (run.compute_deadlines) { yield* finalizeOrDone(pb, ctx, auth, run); return; }
          if (run.write_document?.length === 3 && (run.review_draft?.length ?? 0) < 3) { yield* call("review_draft", { doc_id: "rti" }); return; }
          yield* call("compute_deadlines", { tracks: pb.tracks }, "RTI passes. Computing your legal deadlines. ");
          return;
        default:
          if (!run.compute_deadlines) { yield* call("compute_deadlines", { tracks: pb.tracks }, "Drafts pass the checklist. Computing your legal deadlines. "); return; }
          yield* finalizeOrDone(pb, ctx, auth, run);
      }
    },
  };
}

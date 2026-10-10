/**
 * Deterministic draft checks. The agent must call review_draft after writing a
 * document and fix every issue before finishing — the same "detect failure,
 * fix yourself" loop that makes Cline reliable on code, applied to paperwork.
 */
export interface ReviewResult {
  ok: boolean;
  issues: string[];
  checked: string[];
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

function rtiBody(md: string): string {
  // Exclude the address blocks (To: ... / From: ...) from the word count, as the 2012 Rules do.
  return md
    .split(/\n/)
    .filter((l) => !/^\s*(to|from|address|applicant|name|phone|email|date|place)\s*[:：]/i.test(l))
    .join("\n");
}

export function reviewDraft(type: string, md: string, sourceMd?: string | null): ReviewResult {
  const issues: string[] = [];
  const checked: string[] = [];
  const text = md.toLowerCase();
  const need = (cond: boolean, label: string, issue: string) => {
    checked.push(label);
    if (!cond) issues.push(issue);
  };

  if (type === "explainer") {
    need(md.trim().length > 80, "Has substance", "Translation is too short to be useful — include the key facts and requests from the original.");
  } else {
    need(md.trim().length > 200, "Has substance", "Draft is too short to be filed; include the facts, dates and the specific request.");
  }
  need(!/\b(lorem|todo|tbd)\b/i.test(md), "No filler text", "Remove placeholder words like TODO/TBD/lorem.");

  if (type === "rti" || type === "first_appeal" || type === "second_appeal") {
    need(
      /public information officer|\bpio\b|appellate authority|information commission|जन सूचना अधिकारी|लोक सूचना अधिकारी|अपीलीय प्राधिकार/i.test(md),
      "Correct addressee",
      "Address the application to the Public Information Officer (or the First Appellate Authority for an appeal).",
    );
  }

  if (type === "rti") {
    need(/6\s*\(\s*1\s*\)/.test(md), "Cites Sec. 6(1)", "State that the application is made under Section 6(1) of the RTI Act, 2005.");
    need(/fee|₹\s?10|rs\.?\s?10|bpl|below poverty|शुल्क|निर्धनता रेखा/i.test(md), "Mentions fee", "Mention how the ₹10 fee is paid (IPO/DD/online) or attach a BPL certificate for exemption.");
    const numbered = (md.match(/^\s*(\d+[.)]|[-*])\s+/gm) ?? []).length;
    need(numbered >= 2, "Numbered questions", "List the information sought as separate numbered points.");
    const whyQs = md.split(/\n/).filter((l) => /^\s*(\d+[.)]|[-*])\s+/.test(l) && /\bwhy\b|क्यों/i.test(l));
    need(whyQs.length === 0, "No 'why' questions", `RTI provides records, not explanations. Rephrase as requests for documents/file notings: ${whyQs.map((q) => `"${q.trim().slice(0, 60)}"`).join("; ")}`);
    const words = wordCount(rtiBody(md));
    need(words <= 500, "Within 500 words", `Body is ${words} words; the central RTI Rules, 2012 say an application should ordinarily not exceed 500 words. Tighten it.`);
    need(/certified|copy|copies|inspection|file noting|records?|status|प्रमाणित|प्रतिलिपि|अभिलेख/i.test(text), "Asks for records", "Ask for specific records: certified copies, file notings, status reports, or inspection.");
  }

  if (type === "first_appeal") {
    need(/19\s*\(\s*1\s*\)/.test(md), "Cites Sec. 19(1)", "State that the appeal is filed under Section 19(1) of the RTI Act, 2005.");
    need(/date|dated|दिनांक|तारीख/i.test(md), "References RTI date", "Mention the date of the original RTI application and the reply (or that no reply was received).");
  }

  if (type === "complaint") {
    need(/(subject|sub)\s*[:：]|विषय\s*[:：]/i.test(md), "Has subject line", "Add a one-line 'Subject:' so the office can route it.");
    need(/locat|address|ward|road|near|village|area|landmark|pin|स्थान|पता|वार्ड|सड़क|गांव|गाँव|नज़दीक/i.test(md), "States location", "State the exact location (address, ward, landmark, PIN).");
    need(
      /\b\d{6}\b|pin\s*code|पिन\s*(कोड)?/i.test(md),
      "Has a PIN code",
      "Include the 6-digit PIN code, or a [PIN code] blank, so the office can be located precisely.",
    );
    need(/since|on \d|dated|days|weeks|months|\d{1,2}[\/.-]\d{1,2}|20\d\d|से|दिन|हफ्त|सप्ताह|महीन|तारीख/i.test(md), "States dates/duration", "Say since when the problem exists and any earlier complaint dates/numbers.");
    need(/request|kindly|direct|take action|resolve|repair|refund|restore|sanction|release|pay|अनुरोध|कृपया|कार्रवाई|मरम्मत|समाधान/i.test(md), "Specific relief sought", "End with the specific action you want and a reasonable time frame.");
    need(/enclos|attach|annex|photo|copy of|संलग्नक|संलग्न|अनुलग्नक|फोटो/i.test(md), "Lists attachments", "List enclosures (photos, receipts, earlier complaint copies, ID).");
    const words = wordCount(md);
    need(words <= 450, "Within 450 words", `Complaint is ${words} words; keep it under 450 words so it reads as a focused, actionable complaint.`);
  }

  if (type === "explainer") {
    need(/\[[^\]]{2,80}\]/.test(md) === /\[[^\]]{2,80}\]/.test(sourceMd ?? md), "Keeps blanks", "A translation must keep every [bracketed blank] exactly as the original — don't fill them in or translate the words inside the brackets.");
  }

  return { ok: issues.length === 0, issues, checked };
}

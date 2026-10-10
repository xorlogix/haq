import { createTool } from "@cline/sdk";
import { z } from "zod";
import { searchAuthorities, searchProvisions, getAuthority, listCategories } from "../kb/index.js";
import { APPEAL_TRACKS, computeDeadlines, computeDeadlinesFromBases, DEADLINE_RULES, todayIST } from "../deadlines.js";
import { loadCase, readDocument, updateCase, writeDocument, pushTrace } from "../cases/store.js";
import { reviewDraft } from "./review.js";

/**
 * Custom tools for the Haq caseworker. Each tool is bound to one case folder,
 * the way Cline's built-in tools are bound to one workspace.
 */
export function buildCaseTools(caseId: string) {
  const findAuthorities = createTool({
    name: "find_authorities",
    description:
      "Search Haq's directory of Indian grievance authorities (municipal bodies, DISCOMs, CPGRAMS, RBI Ombudsman, cyber crime, consumer commissions, PDS, PM-JAY, local Assam bodies, etc.). " +
      "Returns ranked matches with filing channels, helplines, service timelines and escalation ladders. Always call this before naming an authority — never invent portals or phone numbers.",
    inputSchema: z.object({
      categories: z.array(z.string()).min(1).describe(`One or more problem categories. Known values: ${listCategories().join(", ")}`),
      keywords: z.string().optional().describe("Free-text keywords from the citizen's problem"),
      state: z.string().optional().describe("Indian state, e.g. Assam"),
      city: z.string().optional().describe("City or district, e.g. Guwahati"),
    }),
    execute: async (input) => {
      const results = searchAuthorities({ ...input, limit: 5 });
      return results.length
        ? { results }
        : { results: [], hint: "No match. Retry with broader categories such as 'general', 'state_govt' or 'central_govt'." };
    },
  });

  const lookupLaw = createTool({
    name: "lookup_law",
    description:
      "Look up Indian laws, rules and citizen rights relevant to the problem (RTI Act, Consumer Protection Act, Electricity Consumer Rules, RBI Ombudsman, NFSA, MGNREGA, RTE, Motor Vehicles Act 198A, Right to Services Acts...). " +
      "Only cite provisions returned by this tool.",
    inputSchema: z.object({
      topics: z.array(z.string()).min(1).describe("Topics, e.g. ['rti','pothole','electricity','consumer']"),
    }),
    execute: async ({ topics }) => ({ provisions: searchProvisions(topics) }),
  });

  const computeDeadlinesTool = createTool({
    name: "compute_deadlines",
    description:
      "Compute exact statutory deadlines. Never do date arithmetic yourself. Each track keeps its own base date — " +
      `tracks: ${Object.keys(DEADLINE_RULES).join(", ")}. ` +
      `Pass filing_date for the original filing (RTI, complaint to a bank, etc.) — it defaults to today (${todayIST()}, IST) if the citizen hasn't told you otherwise. ` +
      "For \"first_appeal\"/\"second_appeal\", do NOT pass the original filing_date — appeal deadlines start from the day the appeal itself is drafted/filed, so omit filing_date (it defaults to today) unless the citizen says the appeal was filed on a different date.",
    inputSchema: z.object({
      tracks: z.array(z.string()).min(1),
      filing_date: z.string().optional().describe("YYYY-MM-DD — the date this specific track's clock starts. Never the date of a different, earlier track."),
    }),
    execute: async ({ tracks, filing_date }) => {
      const deadlines = computeDeadlines(tracks, filing_date);
      updateCase(caseId, (rec) => {
        rec.deadline_tracks = [...new Set([...(rec.deadline_tracks ?? []), ...tracks])];
        rec.deadline_bases = { ...(rec.deadline_bases ?? {}) };
        for (const track of tracks) {
          // Each track gets its own base: explicit filing_date for this call, else the track's
          // existing base, else (for non-appeal tracks only) the case's filedAt, else today.
          rec.deadline_bases[track] = filing_date ?? rec.deadline_bases[track] ?? (APPEAL_TRACKS.has(track) ? undefined : rec.filedAt) ?? todayIST();
        }
        rec.deadlines = computeDeadlinesFromBases(rec.deadline_bases);
      });
      return { filing_date: filing_date ?? todayIST(), deadlines };
    },
  });

  const writeDoc = createTool({
    name: "write_document",
    description:
      "Write (or overwrite) a document in the case folder as Markdown. Use for: complaint (to the responsible authority), rti (RTI application under Sec. 6(1)), first_appeal (Sec. 19(1)), letter, explainer. " +
      "Official documents (complaint, rti, first_appeal, second_appeal, letter) are always written in English — every office accepts it. " +
      "Leave clearly marked blanks like [Your full name] for details you don't know. Do not invent facts, reference numbers or officer names. " +
      "Only an 'explainer' document is written in the citizen's own language — e.g. a faithful translation of an official document for the citizen's understanding, doc_id '<original_id>_<langcode>', keeping every [bracketed blank] unchanged and unfilled.",
    inputSchema: z.object({
      doc_id: z.string().regex(/^[a-z0-9_-]+$/).describe("Stable id, e.g. 'complaint', 'rti', 'first_appeal'"),
      type: z.enum(["complaint", "rti", "first_appeal", "second_appeal", "letter", "explainer"]),
      title: z.string(),
      language: z.string().describe("Language of this document, e.g. 'English' or 'Hindi'"),
      addressed_to: z.string().describe("Designation and office, e.g. 'Public Information Officer, Guwahati Municipal Corporation'"),
      content: z.string().describe("Full document in Markdown"),
    }),
    execute: async ({ content, doc_id, ...doc }) => {
      const saved = writeDocument(caseId, { id: doc_id, ...doc }, content);
      pushTrace(caseId, { kind: "document", docId: saved.id, text: `${saved.updatedAt === saved.createdAt ? "Drafted" : "Revised"} ${saved.title}` });
      return { saved: saved.id, words: content.split(/\s+/).filter(Boolean).length, next: "Call review_draft on this document and fix any issues." };
    },
  });

  const reviewDoc = createTool({
    name: "review_draft",
    description:
      "Run Haq's filing checklist on a saved document (RTI word limit, Sec. 6(1) citation, fee, no 'why' questions, addressee, location, dates, relief sought, enclosures...). " +
      "If issues are returned, rewrite the document with write_document and review again until it passes.",
    inputSchema: z.object({ doc_id: z.string() }),
    execute: async ({ doc_id }) => {
      const rec = loadCase(caseId);
      const doc = rec?.documents.find((d) => d.id === doc_id);
      const md = readDocument(caseId, doc_id);
      if (!doc || md == null) return { error: `No document '${doc_id}'. Saved: ${rec?.documents.map((d) => d.id).join(", ") || "none"}` };
      // For translations ("<original_id>_<langcode>"), compare against the English original so the
      // checklist can confirm every [bracketed blank] was kept, not filled in or translated.
      let sourceMd: string | null = null;
      if (doc.type === "explainer") {
        const originalId = rec?.documents.find((d) => d.id !== doc_id && doc_id.startsWith(`${d.id}_`))?.id;
        sourceMd = originalId ? readDocument(caseId, originalId) : null;
      }
      const review = reviewDraft(doc.type, md, sourceMd, doc_id);
      updateCase(caseId, (r) => {
        const d = r.documents.find((x) => x.id === doc_id);
        if (d) d.review = review;
      });
      return review;
    },
  });

  const readCaseFile = createTool({
    name: "read_case_file",
    description: "Read the current case record (facts, status, filing date, deadlines) or one saved document. Use when following up or escalating.",
    inputSchema: z.object({ doc_id: z.string().optional() }),
    execute: async ({ doc_id }) => {
      if (doc_id) return { doc_id, content: readDocument(caseId, doc_id) ?? "(not found)" };
      const rec = loadCase(caseId);
      if (!rec) return { error: "case missing" };
      const { trace, ...rest } = rec;
      return rest;
    },
  });

  const finalizeCase = createTool({
    name: "finalize_case",
    description:
      "Publish the case summary to the citizen's dashboard. Call exactly once at the end of every run (and again after an escalation). " +
      "summary_for_citizen MUST be in the citizen's own language and simple enough for someone with little schooling.",
    inputSchema: z.object({
      title: z.string().describe("Short case title in English, e.g. 'Deep pothole on GS Road, Guwahati'"),
      category: z.string(),
      urgency: z.enum(["low", "medium", "high", "emergency"]),
      user_language: z.string().describe("Language the citizen used, e.g. 'Hindi'"),
      summary_for_citizen: z.string().describe("3-6 short sentences in the citizen's language: what the problem legally is, who is responsible, what Haq prepared, what to do next."),
      primary_authority_id: z.string().describe("id from find_authorities"),
      primary_authority_why: z.string(),
      filing_steps: z.array(z.object({ step: z.string(), url: z.string().nullable().optional() })).min(1).describe("Ordered, concrete steps to file, in the citizen's language"),
      evidence_checklist: z.array(z.string()).describe("What to collect/attach, in the citizen's language"),
      emergency_note: z.string().nullable().optional().describe("Only if safety/life is at risk: what to do right now (e.g. call 112)"),
    }),
    execute: async (input) => {
      const auth = getAuthority(input.primary_authority_id);
      updateCase(caseId, (rec) => {
        rec.title = input.title;
        rec.category = input.category;
        rec.urgency = input.urgency;
        rec.user_language = input.user_language;
        rec.summary_for_citizen = input.summary_for_citizen;
        rec.primary_authority = { id: input.primary_authority_id, name: auth?.name ?? input.primary_authority_id, why: input.primary_authority_why };
        rec.filing_steps = input.filing_steps;
        rec.evidence_checklist = input.evidence_checklist;
        rec.emergency_note = input.emergency_note ?? null;
        if (rec.status === "working") rec.status = "ready";
      });
      return { published: true, warning: auth ? undefined : "primary_authority_id not in directory — call find_authorities and finalize again." };
    },
  });

  return [findAuthorities, lookupLaw, computeDeadlinesTool, writeDoc, reviewDoc, readCaseFile, finalizeCase];
}

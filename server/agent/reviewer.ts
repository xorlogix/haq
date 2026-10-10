/**
 * Senior reviewer — a second, independent Cline SDK agent that gives a quick
 * "second opinion" on a case after the main caseworker finalizes it.
 *
 * It never sees the first agent's conversation, only the saved case record and
 * documents (read-only tools), and it cannot write or change anything. If it
 * fails for any reason (network, quota, bad output) the case still stays
 * "ready" — a missing second opinion is never fatal to the main case.
 */
import { Agent, createTool } from "@cline/sdk";
import type { AgentMessage, AgentRuntimeEvent } from "@cline/shared";
import { z } from "zod";
import { MODEL_CONFIG } from "../config.js";
import { loadCase, pushTrace, readDocument, updateCase } from "../cases/store.js";
import type { SecondOpinion } from "../cases/store.js";
import { searchProvisions } from "../kb/index.js";
import { resolveCredentials } from "./credentials.js";
import { createDemoReviewerModel } from "./demoModel.js";

type AgentInstance = InstanceType<typeof Agent>;

const reviewing = new Set<string>();

function reviewerSystemPrompt(): string {
  return `You are the Senior Reviewer at Haq, giving a quick, independent second opinion on a case another caseworker just finished. You did NOT see their reasoning or chat — only the saved case record and documents, which you must read with your tools before judging anything.

Check:
1. Is the chosen primary authority actually the right body for this problem?
2. Would the drafted documents (complaint, RTI, appeal, letter) actually be accepted by a real Indian government office — correct addressee, facts, dated, specific relief, enclosures?
3. Is there any important fact the citizen should add before filing (location detail, dates, earlier complaint numbers)?
4. Any risk of factual errors — invented numbers, wrong law cited, wrong deadline, a law or authority not actually confirmed by lookup_law?

Use read_case_file (with no doc_id for the case record, with a doc_id to read one saved document) and lookup_law only — you have no write tools and cannot change anything.

Call submit_second_opinion exactly once, at the end, with:
- verdict: "ready" if the case can be filed as-is, "fix_first" if something should be fixed before filing.
- score: 1-10, how confident you are the case is ready to file.
- points: up to 5 short, concrete points, written in the citizen's own language (the case record's user_language) — never in English if the citizen's language is something else.

Be fast and concise: read the case record, read the documents, then submit. Do not call any tool more than necessary.`;
}

function buildReviewerTools(caseId: string, onSubmit: (o: { verdict: "ready" | "fix_first"; score: number; points: string[] }) => void) {
  const readCaseFile = createTool({
    name: "read_case_file",
    description: "Read the case record (facts, chosen authority, documents, deadlines) or one saved document's full text. Read-only.",
    inputSchema: z.object({ doc_id: z.string().optional() }),
    execute: async ({ doc_id }) => {
      if (doc_id) return { doc_id, content: readDocument(caseId, doc_id) ?? "(not found)" };
      const rec = loadCase(caseId);
      if (!rec) return { error: "case missing" };
      const { trace, ...rest } = rec;
      return rest;
    },
  });

  const lookupLaw = createTool({
    name: "lookup_law",
    description: "Look up Indian laws and provisions relevant to the case, to check whether the drafts cite the right ones. Read-only.",
    inputSchema: z.object({ topics: z.array(z.string()).min(1) }),
    execute: async ({ topics }) => ({ provisions: searchProvisions(topics) }),
  });

  const submit = createTool({
    name: "submit_second_opinion",
    description: "Submit your final structured second opinion on this case. Call exactly once, as your last action.",
    inputSchema: z.object({
      verdict: z.enum(["ready", "fix_first"]),
      score: z.number().min(1).max(10),
      points: z.array(z.string()).max(5),
    }),
    execute: async (input) => {
      onSubmit(input);
      return { received: true };
    },
  });

  return [readCaseFile, lookupLaw, submit];
}

function createReviewerAgent(caseId: string, onSubmit: (o: { verdict: "ready" | "fix_first"; score: number; points: string[] }) => void): AgentInstance {
  const common = {
    systemPrompt: reviewerSystemPrompt(),
    tools: buildReviewerTools(caseId, onSubmit),
    maxIterations: 8,
    toolExecution: "sequential" as const,
    clientName: "haq-reviewer",
  };
  const creds = resolveCredentials();
  const agent =
    creds.mode === "demo"
      ? new Agent({ ...common, model: createDemoReviewerModel() })
      : new Agent({
          ...common,
          providerId: MODEL_CONFIG.providerId,
          modelId: MODEL_CONFIG.modelId,
          apiKey: creds.apiKey,
          baseUrl: MODEL_CONFIG.baseUrl,
        });

  agent.subscribe((e: AgentRuntimeEvent) => {
    switch (e.type) {
      case "tool-started":
        pushTrace(caseId, { kind: "tool-start", tool: e.toolCall.toolName, input: e.toolCall.input, source: "reviewer" });
        break;
      case "tool-finished": {
        const part = e.message.content.find((p) => p.type === "tool-result") as { output?: unknown } | undefined;
        pushTrace(caseId, { kind: "tool-end", tool: e.toolCall.toolName, output: part?.output, source: "reviewer" });
        break;
      }
    }
  });
  return agent;
}

/**
 * Fire-and-forget: run the senior reviewer against the already-saved case record.
 * Never throws — any failure is logged into the case trace and the case stays "ready".
 */
export async function runSecondOpinion(caseId: string): Promise<void> {
  if (reviewing.has(caseId)) return;
  if (!loadCase(caseId)) return;
  reviewing.add(caseId);
  updateCase(caseId, (r) => {
    r.second_opinion_status = "reviewing";
  });
  pushTrace(caseId, { kind: "status", text: "Senior reviewer started", source: "reviewer" });
  let captured: { verdict: "ready" | "fix_first"; score: number; points: string[] } | null = null;
  try {
    const agent = createReviewerAgent(caseId, (o) => {
      captured = o;
    });
    const msg: AgentMessage = {
      id: `rev_${Date.now()}`,
      role: "user",
      content: [
        {
          type: "text",
          text:
            `Give your second opinion on case ${caseId}. Start by calling read_case_file with no doc_id to get the case record, ` +
            `then read_case_file with doc_id for each saved document, then lookup_law if you want to double-check a provision, ` +
            `then call submit_second_opinion exactly once.`,
        },
      ],
      createdAt: Date.now(),
    };
    const result = await agent.run(msg);
    if (!captured && result.status === "failed") throw result.error ?? new Error("Senior reviewer run failed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pushTrace(caseId, { kind: "error", text: `Senior reviewer could not finish (${msg.slice(0, 200)}) — the case stays ready without a second opinion.`, source: "reviewer" });
  } finally {
    const opinion: SecondOpinion | null = captured ? { ...(captured as { verdict: "ready" | "fix_first"; score: number; points: string[] }), reviewedAt: Date.now() } : null;
    updateCase(caseId, (r) => {
      r.second_opinion_status = "done";
      r.second_opinion = opinion;
    });
    pushTrace(caseId, { kind: "done", text: opinion ? "Senior reviewer finished" : "Senior reviewer unavailable", source: "reviewer" });
    reviewing.delete(caseId);
  }
}

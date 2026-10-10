import { Agent } from "@cline/sdk";
import type { AgentMessage, AgentMessagePart, AgentRuntimeEvent } from "@cline/shared";
import { MODEL_CONFIG } from "../config.js";
import { loadCase, loadMessages, pushTrace, saveMessages, updateCase } from "../cases/store.js";
import { buildCaseTools } from "./tools.js";
import { systemPrompt } from "./prompt.js";
import { createDemoModel } from "./demoModel.js";

type AgentInstance = InstanceType<typeof Agent>;

const agents = new Map<string, AgentInstance>();
const running = new Set<string>();

export function modelLabel(): string {
  return MODEL_CONFIG.mode === "demo" ? "Offline demo (scripted model)" : `${MODEL_CONFIG.providerId} · ${MODEL_CONFIG.modelId}`;
}

function createAgent(caseId: string): AgentInstance {
  const common = {
    systemPrompt: systemPrompt(),
    tools: buildCaseTools(caseId),
    maxIterations: MODEL_CONFIG.maxIterations,
    toolExecution: "sequential" as const,
    clientName: "haq",
  };
  const agent =
    MODEL_CONFIG.mode === "demo"
      ? new Agent({ ...common, model: createDemoModel(caseId) })
      : new Agent({
          ...common,
          providerId: MODEL_CONFIG.providerId,
          modelId: MODEL_CONFIG.modelId,
          apiKey: MODEL_CONFIG.apiKey,
          baseUrl: MODEL_CONFIG.baseUrl,
        });

  // Stream the agent's Plan/Act loop into the case trace so the citizen can watch it work.
  let buffer = "";
  const flush = () => {
    const text = buffer.trim();
    buffer = "";
    if (text) pushTrace(caseId, { kind: "thought", text });
  };
  agent.subscribe((e: AgentRuntimeEvent) => {
    switch (e.type) {
      case "assistant-text-delta":
        buffer += e.text;
        break;
      case "tool-started":
        flush();
        pushTrace(caseId, { kind: "tool-start", tool: e.toolCall.toolName, input: summarizeInput(e.toolCall.input) });
        break;
      case "tool-finished": {
        const part = e.message.content.find((p) => p.type === "tool-result") as { output?: unknown } | undefined;
        pushTrace(caseId, { kind: "tool-end", tool: e.toolCall.toolName, output: summarizeOutput(e.toolCall.toolName, part?.output) });
        break;
      }
      case "turn-finished":
      case "run-finished":
        flush();
        break;
      case "usage-updated":
        updateUsage(caseId, e.usage as { inputTokens?: number; outputTokens?: number });
        break;
    }
  });
  return agent;
}

let usageTimer: NodeJS.Timeout | undefined;
function updateUsage(caseId: string, usage: { inputTokens?: number; outputTokens?: number }) {
  clearTimeout(usageTimer);
  usageTimer = setTimeout(() => {
    try {
      updateCase(caseId, (r) => {
        r.usage = { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 };
      });
    } catch {}
  }, 300);
}

function summarizeInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const copy: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  if (typeof copy.content === "string") copy.content = `${(copy.content as string).slice(0, 140)}…`;
  if (typeof copy.summary_for_citizen === "string") copy.summary_for_citizen = `${(copy.summary_for_citizen as string).slice(0, 140)}…`;
  delete copy.filing_steps;
  delete copy.evidence_checklist;
  return copy;
}

function summarizeOutput(tool: string, out: any): unknown {
  if (!out || typeof out !== "object") return out;
  if (tool === "find_authorities") return { matches: (out.results ?? []).map((r: any) => `${r.name} (score ${r.score})`) };
  if (tool === "lookup_law") return { provisions: (out.provisions ?? []).map((p: any) => p.title) };
  if (tool === "compute_deadlines") return { deadlines: (out.deadlines ?? []).map((d: any) => `${d.date}: ${d.label}`) };
  if (tool === "read_case_file") return { ok: true };
  return out;
}

function getAgent(caseId: string): AgentInstance {
  let a = agents.get(caseId);
  if (!a) {
    a = createAgent(caseId);
    const saved = loadMessages(caseId);
    if (saved?.length) a.restore(saved as AgentMessage[]);
    agents.set(caseId, a);
  }
  return a;
}

export function isRunning(caseId: string): boolean {
  return running.has(caseId);
}

async function drive(caseId: string, input: AgentMessage, first: boolean): Promise<void> {
  if (running.has(caseId)) throw new Error("The caseworker is already working on this case.");
  running.add(caseId);
  const agent = getAgent(caseId);
  pushTrace(caseId, { kind: "status", text: first ? "Caseworker started" : "Caseworker resumed" });
  try {
    const result = first ? await agent.run(input) : await agent.continue(input);
    saveMessages(caseId, result.messages);
    if (result.status === "failed") throw result.error ?? new Error("Agent run failed");
    const rec = loadCase(caseId);
    if (rec && !rec.summary_for_citizen) {
      // Model ended without publishing — nudge once so the dashboard is never empty.
      const retry = await agent.continue("You have not called finalize_case yet. Call it now with the summary, filing steps and checklist.");
      saveMessages(caseId, retry.messages);
    }
    updateCase(caseId, (r) => {
      if (r.status === "working") r.status = r.summary_for_citizen ? "ready" : "failed";
    });
    pushTrace(caseId, { kind: "done", text: "Case file ready" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateCase(caseId, (r) => {
      if (r.status === "working") r.status = "failed";
    });
    pushTrace(caseId, { kind: "error", text: friendlyError(msg) });
  } finally {
    running.delete(caseId);
  }
}

function friendlyError(msg: string): string {
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|Cannot connect|fetch failed|network/i.test(msg)) return `Can't reach the model API — check the internet connection, or restart with HAQ_MODE=demo for the offline model. (${msg.slice(0, 120)})`;
  if (/401|unauthor|api key|invalid.*key/i.test(msg)) return `The model provider rejected the API key. Check CLINE_API_KEY in .env, or run with HAQ_MODE=demo. (${msg.slice(0, 160)})`;
  if (/credit|subscri|limit|quota|402/i.test(msg)) return `The model provider refused the request (credits/limits). Try another model in HAQ_MODEL or HAQ_MODE=demo. (${msg.slice(0, 160)})`;
  return msg.slice(0, 400);
}

export function startCase(
  caseId: string,
  intake: { text: string; language: string; state?: string; city?: string; contactName?: string },
  image?: { base64: string; mediaType: string },
): void {
  const lines = [
    "A citizen needs help. Open a case and prepare everything they need.",
    `Case ID: ${caseId}`,
    `Problem: ${intake.text}`,
    `State: ${intake.state || "not given"}`,
    `City: ${intake.city || "not given"}`,
    `Preferred language: ${intake.language || "same as the problem text"}`,
    image ? "A photo of the problem is attached as evidence." : "No photo attached.",
  ];
  const parts: AgentMessagePart[] = [{ type: "text", text: lines.join("\n") }];
  if (image) parts.push({ type: "image", image: image.base64, mediaType: image.mediaType });
  const msg: AgentMessage = { id: `u_${Date.now()}`, role: "user", content: parts, createdAt: Date.now() };
  void drive(caseId, msg, true);
}

export function followUp(caseId: string, text: string): void {
  pushTrace(caseId, { kind: "user", text });
  const msg: AgentMessage = { id: `u_${Date.now()}`, role: "user", content: [{ type: "text", text }], createdAt: Date.now() };
  void drive(caseId, msg, false);
}

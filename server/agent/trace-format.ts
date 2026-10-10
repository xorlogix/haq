/**
 * Shared helpers for turning raw tool input/output into short, readable summaries for the
 * live case log. Used by both the main caseworker and the senior reviewer agent, so their
 * log lines look consistent (e.g. lookup_law shows provision titles, not [object Object]).
 */
export function summarizeInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const copy: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  if (typeof copy.content === "string") copy.content = `${(copy.content as string).slice(0, 140)}…`;
  if (typeof copy.summary_for_citizen === "string") copy.summary_for_citizen = `${(copy.summary_for_citizen as string).slice(0, 140)}…`;
  delete copy.filing_steps;
  delete copy.evidence_checklist;
  return copy;
}

export function summarizeOutput(tool: string, out: any): unknown {
  if (!out || typeof out !== "object") return out;
  if (tool === "find_authorities") return { matches: (out.results ?? []).map((r: any) => `${r.name} (score ${r.score})`) };
  if (tool === "lookup_law") return { provisions: (out.provisions ?? []).map((p: any) => p.title) };
  if (tool === "compute_deadlines") return { deadlines: (out.deadlines ?? []).map((d: any) => `${d.date}: ${d.label}`) };
  if (tool === "read_case_file") return { ok: true };
  return out;
}

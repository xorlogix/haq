import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { CASES_DIR } from "../config.js";
import type { ComputedDeadline } from "../deadlines.js";

export type CaseStatus = "working" | "ready" | "filed" | "escalated" | "resolved" | "failed";

export interface TraceEvent {
  t: number;
  kind: "status" | "thought" | "tool-start" | "tool-end" | "document" | "case-updated" | "done" | "error" | "user";
  text?: string;
  tool?: string;
  input?: unknown;
  output?: unknown;
  docId?: string;
}

export interface CaseDocument {
  id: string;
  type: "complaint" | "rti" | "first_appeal" | "second_appeal" | "letter" | "explainer";
  title: string;
  language: string;
  addressed_to: string;
  file: string;
  createdAt: number;
  updatedAt: number;
  review?: { ok: boolean; issues: string[]; checked: string[] };
}

export interface CaseRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: CaseStatus;
  mode: "live" | "demo";
  model: string;
  input: { text: string; language: string; state?: string; city?: string; hasImage: boolean; contactName?: string; intakeMode?: "problem" | "notice" };
  title?: string;
  category?: string;
  urgency?: "low" | "medium" | "high" | "emergency";
  user_language?: string;
  summary_for_citizen?: string;
  primary_authority?: { id: string; name: string; why: string };
  filing_steps?: Array<{ step: string; url?: string | null }>;
  evidence_checklist?: string[];
  deadline_tracks?: string[];
  /** Per-track base date (YYYY-MM-DD) that deadlines are computed from — e.g. { rti: "2026-09-01", first_appeal: "2026-10-05" }. Each track keeps its own base so marking the appeal filed never shifts the original RTI deadlines, and vice versa. */
  deadline_bases?: Record<string, string>;
  deadlines?: ComputedDeadline[];
  emergency_note?: string | null;
  filedAt?: string;
  documents: CaseDocument[];
  trace: TraceEvent[];
  usage?: { inputTokens: number; outputTokens: number };
}

const bus = new EventEmitter();
bus.setMaxListeners(100);

fs.mkdirSync(CASES_DIR, { recursive: true });

const caseDir = (id: string) => path.join(CASES_DIR, id);
const safeId = (id: string) => /^[a-z0-9-]+$/i.test(id);

export function newCaseId(): string {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  return `HAQ-${ymd}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function createCase(rec: Omit<CaseRecord, "createdAt" | "updatedAt" | "documents" | "trace" | "status">): CaseRecord {
  const now = Date.now();
  const full: CaseRecord = { ...rec, createdAt: now, updatedAt: now, status: "working", documents: [], trace: [] };
  fs.mkdirSync(caseDir(rec.id), { recursive: true });
  saveCase(full);
  return full;
}

export function saveCase(rec: CaseRecord): void {
  rec.updatedAt = Date.now();
  fs.writeFileSync(path.join(caseDir(rec.id), "case.json"), JSON.stringify(rec, null, 2));
}

export function loadCase(id: string): CaseRecord | null {
  if (!safeId(id)) return null;
  const f = path.join(caseDir(id), "case.json");
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf8")) as CaseRecord;
}

export function listCases(): CaseRecord[] {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs
    .readdirSync(CASES_DIR)
    .map((id) => loadCase(id))
    .filter((c): c is CaseRecord => !!c)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function updateCase(id: string, patch: (rec: CaseRecord) => void): CaseRecord {
  const rec = loadCase(id);
  if (!rec) throw new Error(`Case ${id} not found`);
  patch(rec);
  saveCase(rec);
  bus.emit(`case:${id}`, { t: Date.now(), kind: "case-updated" } satisfies TraceEvent);
  return rec;
}

export function pushTrace(id: string, ev: Omit<TraceEvent, "t">): void {
  const full: TraceEvent = { t: Date.now(), ...ev };
  const rec = loadCase(id);
  if (rec) {
    rec.trace.push(full);
    saveCase(rec);
  }
  bus.emit(`case:${id}`, full);
}

export function subscribe(id: string, fn: (ev: TraceEvent) => void): () => void {
  bus.on(`case:${id}`, fn);
  return () => bus.off(`case:${id}`, fn);
}

export function writeDocument(id: string, doc: Omit<CaseDocument, "file" | "createdAt" | "updatedAt">, content: string): CaseDocument {
  const file = `${doc.id}.md`;
  fs.writeFileSync(path.join(caseDir(id), file), content);
  let saved!: CaseDocument;
  updateCase(id, (rec) => {
    const existing = rec.documents.find((d) => d.id === doc.id);
    const now = Date.now();
    if (existing) {
      Object.assign(existing, doc, { file, updatedAt: now });
      delete existing.review;
      saved = existing;
    } else {
      saved = { ...doc, file, createdAt: now, updatedAt: now };
      rec.documents.push(saved);
    }
  });
  return saved;
}

export function readDocument(id: string, docId: string): string | null {
  if (!safeId(id) || !/^[a-z0-9_-]+$/i.test(docId)) return null;
  const f = path.join(caseDir(id), `${docId}.md`);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
}

export function saveMessages(id: string, messages: unknown): void {
  fs.writeFileSync(path.join(caseDir(id), "messages.json"), JSON.stringify(messages));
}

export function loadMessages(id: string): unknown[] | null {
  const f = path.join(caseDir(id), "messages.json");
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as unknown[]) : null;
}

export function saveImage(id: string, dataUrl: string): { base64: string; mediaType: string } | null {
  const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const ext = m[2].replace("jpeg", "jpg");
  fs.writeFileSync(path.join(caseDir(id), `evidence.${ext}`), Buffer.from(m[3], "base64"));
  return { base64: m[3], mediaType: m[1] };
}

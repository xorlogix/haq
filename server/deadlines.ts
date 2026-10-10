/**
 * Deterministic deadline arithmetic. The LLM never does date math — it calls the
 * compute_deadlines tool, which uses these rules.
 */
export interface DeadlineRule {
  kind: string;
  label: string;
  days: number;
  from: "filing" | "previous";
  basis: string;
}

export const DEADLINE_RULES: Record<string, DeadlineRule[]> = {
  rti: [
    { kind: "rti_reply", label: "PIO must reply to your RTI", days: 30, from: "filing", basis: "RTI Act Sec. 7(1)" },
    { kind: "rti_first_appeal_last_day", label: "Last day to file First Appeal if no/poor reply", days: 30, from: "previous", basis: "RTI Act Sec. 19(1)" },
  ],
  rti_life_liberty: [
    { kind: "rti_reply_48h", label: "PIO must reply (life or liberty)", days: 2, from: "filing", basis: "RTI Act Sec. 7(1) proviso" },
  ],
  first_appeal: [
    { kind: "faa_decision", label: "First Appellate Authority should decide your appeal", days: 30, from: "filing", basis: "RTI Act Sec. 19(6) (extendable to 45 days with reasons)" },
    { kind: "second_appeal_last_day", label: "Last day for Second Appeal to the Information Commission", days: 90, from: "previous", basis: "RTI Act Sec. 19(3)" },
  ],
  cpgrams: [
    { kind: "cpgrams_resolution", label: "Department should resolve your CPGRAMS grievance", days: 21, from: "filing", basis: "DARPG guidelines, 2024" },
  ],
  bank: [
    { kind: "bank_reply", label: "Bank must resolve your complaint", days: 30, from: "filing", basis: "RBI Integrated Ombudsman Scheme, 2021" },
    { kind: "ombudsman_window", label: "Last day to approach RBI Ombudsman (approx.)", days: 365, from: "previous", basis: "RBI Integrated Ombudsman Scheme, 2021" },
  ],
  mgnrega_work: [
    { kind: "mgnrega_work", label: "Work must be provided (else unemployment allowance)", days: 15, from: "filing", basis: "MGNREGA" },
  ],
  consumer: [
    { kind: "consumer_limitation", label: "Last day to file consumer case (2 years from cause of action)", days: 730, from: "filing", basis: "Consumer Protection Act, 2019, Sec. 69" },
  ],
  follow_up: [
    { kind: "follow_up", label: "Follow up with the department if nothing has moved", days: 15, from: "filing", basis: "Good practice" },
  ],
};

export interface ComputedDeadline {
  kind: string;
  label: string;
  date: string; // YYYY-MM-DD
  days_from_filing: number;
  basis: string;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export function computeDeadlines(tracks: string[], filingDate?: string): ComputedDeadline[] {
  const start = filingDate && /^\d{4}-\d{2}-\d{2}$/.test(filingDate) ? filingDate : todayIST();
  const out: ComputedDeadline[] = [];
  for (const track of tracks) {
    const rules = DEADLINE_RULES[track];
    if (!rules) continue;
    let prevDate = start;
    let prevOffset = 0;
    for (const r of rules) {
      const base = r.from === "filing" ? start : prevDate;
      const offset = (r.from === "filing" ? 0 : prevOffset) + r.days;
      const date = addDays(base, r.days);
      out.push({ kind: r.kind, label: r.label, date, days_from_filing: offset, basis: r.basis });
      prevDate = date;
      prevOffset = offset;
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function daysUntil(dateIso: string): number {
  const today = new Date(`${todayIST()}T00:00:00Z`).getTime();
  return Math.round((new Date(`${dateIso}T00:00:00Z`).getTime() - today) / 86400000);
}

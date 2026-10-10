import fs from "node:fs";
import path from "node:path";
import { KB_DIR } from "../config.js";

export interface FilingChannel {
  channel: string;
  url: string | null;
  notes: string;
}

export interface Authority {
  id: string;
  name: string;
  scope: "central" | "state" | "city";
  states: string[];
  cities?: string[];
  categories: string[];
  handles: string;
  file_via: FilingChannel[];
  helpline: string;
  timeline_days: number | null;
  timeline_note?: string;
  escalation: string[];
}

export interface Provision {
  id: string;
  title: string;
  topics: string[];
  summary: string;
  key_points: string[];
}

// Read fresh on every call so edits to the JSON (e.g. made with Cline) apply without a restart.
function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(KB_DIR, file), "utf8")) as T;
}

export function allAuthorities(): Authority[] {
  return readJson<{ authorities: Authority[] }>("authorities.json").authorities;
}

export function allProvisions(): Provision[] {
  return readJson<{ provisions: Provision[] }>("laws.json").provisions;
}

export function getAuthority(id: string): Authority | undefined {
  return allAuthorities().find((a) => a.id === id);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-෿]+/g, " ").trim();

function tokens(s: string): string[] {
  return norm(s).split(/\s+/).filter((t) => t.length > 3);
}

/**
 * Rank authorities for a problem. Location-specific bodies (city/state) outrank
 * national ones when the citizen's location matches, so a Guwahati pothole is
 * sent to GMC before the generic "municipal corporation" entry.
 */
export function searchAuthorities(q: {
  categories: string[];
  keywords?: string;
  state?: string;
  city?: string;
  limit?: number;
}): Array<Authority & { score: number; why: string[] }> {
  const cats = q.categories.map((c) => norm(c).replace(/\s+/g, "_"));
  const kw = tokens(q.keywords ?? "");
  const state = q.state ? norm(q.state) : "";
  const city = q.city ? norm(q.city) : "";

  const scored = allAuthorities().map((a) => {
    let score = 0;
    const why: string[] = [];
    const catHits = a.categories.filter((c) => cats.includes(c));
    if (catHits.length) {
      score += 10 * catHits.length;
      why.push(`handles ${catHits.join(", ")}`);
    }
    const text = norm(`${a.name} ${a.handles} ${a.categories.join(" ")}`);
    const kwHits = kw.filter((t) => text.includes(t));
    if (kwHits.length) {
      score += 2 * kwHits.length;
      why.push(`matches "${kwHits.slice(0, 4).join(", ")}"`);
    }
    if (a.scope !== "central") {
      const stateOk = state && a.states.some((s) => norm(s) === state);
      const cityOk = city && (a.cities ?? []).some((c) => norm(c) === city);
      if (a.scope === "city") {
        if (cityOk) {
          score += 15;
          why.push(`local body for ${q.city}`);
        } else score = 0;
      } else if (a.scope === "state") {
        if (stateOk) {
          score += 8;
          why.push(`state body for ${q.state}`);
        } else score = 0;
      }
    }
    return { ...a, score, why };
  });

  return scored
    .filter((a) => a.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, q.limit ?? 5);
}

export function searchProvisions(topics: string[]): Provision[] {
  const t = topics.map((x) => norm(x).replace(/\s+/g, "_"));
  const words = topics.flatMap(tokens);
  return allProvisions()
    .map((p) => {
      let score = p.topics.filter((x) => t.includes(x)).length * 10;
      const text = norm(`${p.title} ${p.summary}`);
      score += words.filter((w) => text.includes(w)).length;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.p);
}

export function listCategories(): string[] {
  return [...new Set(allAuthorities().flatMap((a) => a.categories))].sort();
}

import type { GgAssessment, GgAssessmentContextSection, GgAssessmentFeed } from "../shared/gg-overview.ts";
import { callGgTool, type GgToolCall } from "./gg-mcp.ts";

const FRESH_MS = 300_000;
const PAGE = 200;
const MAX_ITEMS = 5000;
const SOURCE_ERROR = "Az előkészítések most nem olvashatók. A feladatsor ettől még látszik.";
const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown, max = 4000): string | null => typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : null;
const strings = (value: unknown, max = 500): string[] => Array.isArray(value) ? value.slice(0, 20).map(item => str(item, max)).filter((item): item is string => item !== null) : [];

function context(value: unknown): GgAssessmentContextSection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sections = value.slice(0, 20).flatMap(raw => {
    const row = record(raw), label = str(row.label, 200);
    // vegyes vagy hibás elem esetén az egész szakaszt eldobjuk, nem részletet mutatunk
    if (!label || !Array.isArray(row.items) || !row.items.every(item => typeof item === "string")) return [];
    return [{ label, items: strings(row.items, 1000) }];
  });
  return sections.length ? sections : undefined;
}

/** Egy v3 lista-elem felmérése; felmérés nélkül vagy ismeretlen frissességnél null. */
function assessment(raw: unknown): GgAssessment | null {
  const item = record(raw), source = record(item.assessment), attention = record(source.attention);
  if (item.freshness !== "current" && item.freshness !== "stale") return null;
  const summary = str(attention.summary), recommendation = str(attention.recommendation), rationale = str(attention.rationale);
  if (!summary || !recommendation || !rationale) return null;
  const risk = record(attention.risk);
  const result: GgAssessment = {
    preparation: str(source.preparation, 64), freshness: item.freshness, assessed_at: str(item.assessed_at, 64),
    risk: Number.isInteger(risk.score) && Number(risk.score) >= 1 && Number(risk.score) <= 5 ? { score: Number(risk.score), explanation: str(risk.explanation) ?? "" } : null,
    summary, recommendation, rationale, missing_information: strings(attention.missing_information),
  };
  for (const key of ["goal", "situation", "question", "after_yes", "if_no"] as const) {
    const value = str(attention[key]);
    if (value) result[key] = value;
  }
  const sections = context(attention.context);
  if (sections) result.context = sections;
  return result;
}

/** Explicit projekció: csak a felület által használt mezők jutnak a kliensre. */
export function projectAssessments(pages: { tasks: unknown[]; decisions: unknown[]; packages: unknown[] }): Omit<GgAssessmentFeed, "observed_at" | "error"> {
  const byId = (items: unknown[]) => {
    const out: Record<string, GgAssessment> = {};
    for (const raw of items) {
      const id = str(record(raw).id, 64), value = assessment(raw);
      if (id && value) out[id] = value;
    }
    return out;
  };
  const stories: Record<string, string> = {};
  for (const raw of pages.packages) {
    const row = record(raw), story = str(row.story_identifier, 64), title = str(row.title, 500);
    if (story && /^[A-Z][A-Z0-9]*-\d+$/.test(story) && title) stories[story] = title;
  }
  return { tasks: byId(pages.tasks), decisions: byId(pages.decisions), stories };
}

async function readAll(call: GgToolCall, name: string, args: Record<string, unknown>): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = record(await call(name, { ...args, limit: PAGE, offset }));
    if (!Array.isArray(page.items) || !Number.isInteger(page.total)) throw Error("invalid_assessments");
    if (Number(page.total) > MAX_ITEMS) throw Error("assessments_too_large");
    items.push(...page.items);
    if (offset + page.items.length >= Number(page.total) || page.items.length === 0) return items;
  }
}

/** A felmérés lassabban változik a feedánál: külön, ritkább olvasás a meglévő személyes proxyn át. */
export class GgAssessmentService {
  private cached: GgAssessmentFeed = { tasks: {}, decisions: {}, stories: {}, observed_at: null, error: SOURCE_ERROR };
  private nextRead = 0;
  private inFlight: Promise<GgAssessmentFeed> | null = null;
  constructor(private readonly options: { call?: GgToolCall; now?: () => number } = {}) {}
  last(): GgAssessmentFeed { return this.cached; }
  read(): Promise<GgAssessmentFeed> {
    const now = (this.options.now ?? Date.now)();
    if (this.inFlight) return this.inFlight;
    if (now < this.nextRead) return Promise.resolve(this.cached);
    const call = this.options.call ?? callGgTool;
    this.inFlight = (async () => {
      try {
        const [tasks, decisions, packages] = [
          await readAll(call, "autoagent_tasks", { version: 3, state: "planned" }),
          await readAll(call, "autoagent_decisions", { version: 3, state: "pending" }),
          await readAll(call, "autoagent_work_packages", { version: 3, state: "active" }),
        ];
        this.cached = { ...projectAssessments({ tasks, decisions, packages }), observed_at: new Date((this.options.now ?? Date.now)()).toISOString(), error: null };
      } catch { this.cached = { ...this.cached, error: SOURCE_ERROR }; }
      this.nextRead = (this.options.now ?? Date.now)() + FRESH_MS;
      return this.cached;
    })().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
}

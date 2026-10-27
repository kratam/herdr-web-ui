import { describe, expect, it } from "bun:test";
import { GgAssessmentService, projectAssessments } from "./gg-assessments.ts";

const attention = { kind: "preparation", effort: "short", minutes_min: 5, minutes_max: 10, materials: ["text"], confidence: "estimated",
  risk: { score: 4, explanation: "Alacsony" }, summary: "Helyzet", recommendation: "Javaslat", rationale: "Indok", missing_information: ["Mi hiányzik?"] };
const taskItem = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: "Munka", brief: "PRIVATE BRIEF", checkpoint: { secret: "PRIVATE" },
  assessment: { id: "a-" + id, kind: "preparation", preparation: "prepared", attention }, freshness: "current", assessed_at: "2026-10-19T16:43:23.997Z", ...extra });

describe("GG felmérés-projekció", () => {
  it("az aktuális felmérés mezőit adja tovább, a privát mezőket nem", () => {
    const result = projectAssessments({ tasks: [taskItem("t1")], decisions: [], packages: [] });
    expect(result.tasks.t1).toMatchObject({ preparation: "prepared", freshness: "current", summary: "Helyzet", recommendation: "Javaslat", rationale: "Indok", risk: { score: 4, explanation: "Alacsony" }, missing_information: ["Mi hiányzik?"], assessed_at: "2026-10-19T16:43:23.997Z" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("felmérés nélküli vagy unassessed elemet kihagy", () => {
    const result = projectAssessments({ tasks: [taskItem("t1", { freshness: "unassessed" }), taskItem("t2", { assessment: null })], decisions: [], packages: [] });
    expect(result.tasks).toEqual({});
  });
  it("az elavult felmérést stale jelöléssel megtartja", () => {
    expect(projectAssessments({ tasks: [taskItem("t1", { freshness: "stale" })], decisions: [], packages: [] }).tasks.t1?.freshness).toBe("stale");
  });
  it("hibás kockázati pontszámot null-ra cserél, a túl hosszú szöveget levágja", () => {
    for (const score of [0, 6, 3.5]) {
      const item = taskItem("t1", { assessment: { preparation: "prepared", attention: { ...attention, risk: { score, explanation: "x" } } } });
      expect(projectAssessments({ tasks: [item], decisions: [], packages: [] }).tasks.t1?.risk).toBeNull();
    }
    const long = taskItem("t1", { assessment: { preparation: "prepared", attention: { ...attention, summary: "a".repeat(5000) } } });
    expect(projectAssessments({ tasks: [long], decisions: [], packages: [] }).tasks.t1?.summary).toHaveLength(4000);
  });
  it("a bővebb háttérből csak a {label, items} alakot tartja meg", () => {
    const context = [{ label: "Hol tart", items: ["Import kész"] }, { label: "Rossz", items: "nem lista" }, "szöveg", { label: "Vegyes", items: ["jó", 3] }];
    const item = taskItem("t1", { assessment: { preparation: "prepared", attention: { ...attention, context, question: "Mehet?", after_yes: "Indul" } } });
    const result = projectAssessments({ tasks: [item], decisions: [], packages: [] }).tasks.t1;
    expect(result?.context).toEqual([{ label: "Hol tart", items: ["Import kész"] }]);
    expect(result?.question).toBe("Mehet?");
    expect(result?.after_yes).toBe("Indul");
  });
  it("a döntések felmérését döntés-azonosító szerint, a story-címeket story szerint adja", () => {
    const result = projectAssessments({ tasks: [], decisions: [{ id: "d1", assessment: { kind: "decision", attention: { ...attention, kind: "decision" } }, freshness: "current", assessed_at: null }],
      packages: [{ story_identifier: "IT-1953", title: "Lakásadatok a GG3-ban" }, { story_identifier: "rossz", title: 3 }] });
    expect(result.decisions.d1?.summary).toBe("Helyzet");
    expect(result.decisions.d1?.preparation).toBeNull();
    expect(result.stories).toEqual({ "IT-1953": "Lakásadatok a GG3-ban" });
  });
});

describe("GG felmérés-olvasó", () => {
  const pages = (count: number) => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const call = async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name !== "autoagent_tasks") return { items: [], total: 0 };
      const offset = Number(args.offset);
      const items = Array.from({ length: Math.max(0, Math.min(200, count - offset)) }, (_, index) => taskItem("t" + (offset + index)));
      return { items, total: count };
    };
    return { calls, call };
  };
  it("lapoz, amíg az összes elemet meg nem kapja", async () => {
    const { calls, call } = pages(450);
    const feed = await new GgAssessmentService({ call }).read();
    expect(Object.keys(feed.tasks)).toHaveLength(450);
    expect(calls.filter(row => row.name === "autoagent_tasks").map(row => row.args.offset)).toEqual([0, 200, 400]);
    expect(calls.find(row => row.name === "autoagent_tasks")?.args).toMatchObject({ version: 3, state: "planned", limit: 200 });
    expect(feed.error).toBeNull();
  });
  it("öt percig a cache-ből válaszol, és egyszerre egy olvasás fut", async () => {
    let now = 1_000_000;
    const { calls, call } = pages(1);
    const service = new GgAssessmentService({ call, now: () => now });
    const [a, b] = await Promise.all([service.read(), service.read()]);
    expect(a).toBe(b);
    const first = calls.length;
    now += 299_000; await service.read();
    expect(calls.length).toBe(first);
    now += 2_000; await service.read();
    expect(calls.length).toBeGreaterThan(first);
  });
  it("hiba esetén megtartja az utolsó ismert adatot, és jelzi a hibát", async () => {
    let now = 0, fail = false;
    const { call } = pages(1);
    const service = new GgAssessmentService({ now: () => now, call: async (name, args) => { if (fail) throw Error("gg_mcp_unavailable"); return call(name, args); } });
    await service.read();
    fail = true; now += 301_000;
    const feed = await service.read();
    expect(Object.keys(feed.tasks)).toEqual(["t0"]);
    expect(feed.error).not.toBeNull();
  });
  it("5000 elem fölött nem csonkol csendben", async () => {
    const { call } = pages(5001);
    const feed = await new GgAssessmentService({ call }).read();
    expect(feed.error).not.toBeNull();
  });
});

import { describe, expect, it } from "bun:test";
import { GgOverviewService, handleGgOverviewRequest, projectCoreStatus } from "./gg-overview.ts";

const task = { id: "t1", title: "Munka", state: "waiting", package_state: "active", story_identifier: "IT-1", github_url: "https://github.com/GuestGuru/example/issues/1", working_repositories: [{ repository: "GuestGuru/example" }], brief: "PRIVATE BRIEF", checkpoint: { secret: "PRIVATE" } };

describe("GG áttekintő adatprojekció", () => {
  it("csak aktív ügyet, függő döntést és engedélyezett mezőket ad tovább", () => {
    const result = projectCoreStatus({ version: 3, items: [task, { ...task, id: "closed", package_state: "canceled" }], questions: [{ question_key: "q1", task_id: "t1", state: "pending", text: "Melyik?", proposal: "Ezt", question_url: null }, { question_key: "q2", task_id: "closed", state: "pending", text: "Régi" }] });
    expect(result.tasks).toHaveLength(1);
    expect(result.decisions).toHaveLength(1);
    expect(result.tasks[0]?.repositories).toEqual(["GuestGuru/example"]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("nem alakít hibás vagy részleges választ egészséges üres listává", () => {
    expect(() => projectCoreStatus({ version: 2, items: [] })).toThrow();
    expect(() => projectCoreStatus({ version: 3, items: [], questions: null })).toThrow();
  });
  it("egy feladat több repóját megőrzi, a nem http(s) linket eldobja", () => {
    const result = projectCoreStatus({ version: 3, items: [{ ...task, github_url: "javascript:alert(1)", working_repositories: [{ repository: "GuestGuru/a" }, { repository: "GuestGuru/b" }] }], questions: [] });
    expect(result.tasks[0]?.repositories).toHaveLength(2);
    expect(result.tasks[0]?.url).toBeNull();
  });
  it("a valós jsonb javaslat címkéjét és indoklását mutatja, a gépi értékét nem", () => {
    const result = projectCoreStatus({ version: 3, items: [task], questions: [{ question_key: "q", task_id: "t1", state: "pending", text: "Kérdés", proposal: { value: true, label: "Javasolt irány", rationale: "Egyszerűbb működés" } }] });
    expect(result.decisions[0]?.proposal).toBe("Javasolt irány\n\nEgyszerűbb működés");
  });
  it("a döntés kockázatát és storyját továbbadja, hibás kockázatot nem", () => {
    const question = { question_key: "q", task_id: "t1", state: "pending", text: "Kérdés" };
    const result = projectCoreStatus({ version: 3, items: [task], questions: [{ ...question, proposal_risk: { score: 3, explanation: "Közepes" } }, { ...question, question_key: "q2", proposal_risk: { score: 9 } }, { ...question, question_key: "q3" }] });
    expect(result.decisions.map(decision => decision.risk)).toEqual([{ score: 3, explanation: "Közepes" }, null, null]);
    expect(result.decisions[0]?.story).toBe("IT-1");
  });
  it("aktív csomag lezárt taskjához tartozó nyitott kérdést sem tüntet el", () => {
    const result = projectCoreStatus({ version: 3, items: [{ ...task, state: "succeeded" }], questions: [{ question_key: "q", task_id: "t1", state: "pending", text: "Még nyitott" }] });
    expect(result.decisions).toHaveLength(1); expect(result.tasks).toHaveLength(1);
  });
});

describe("GG státuszolvasás", () => {
  it("első olvasási hibánál nincs állítólagos utolsó ismert adat", async () => {
    const service = new GgOverviewService({ load: async () => { throw Error("unavailable"); } });
    const result = await service.read();
    expect(result.source.observed_at).toBeNull(); expect(result.source.error).not.toBeNull();
  });
  it("watch/bridge kérésből és író metódussal nem olvas privát GG-adatot", async () => {
    let calls = 0;
    const service = new GgOverviewService({ load: async () => { calls++; return {}; } });
    expect((await handleGgOverviewRequest(new Request("http://local/api/gg/overview"), service, false)).status).toBe(403);
    expect((await handleGgOverviewRequest(new Request("http://local/api/gg/overview", { method: "POST" }), service, true)).status).toBe(405);
    expect(calls).toBe(0);
  });
  it("összevonja a párhuzamos kéréseket és hiba után megőrzi az utolsó adatot hiba-jelzéssel", async () => {
    let now = 100_000, calls = 0;
    const service = new GgOverviewService({ now: () => now, load: async () => { calls++; if (calls > 1) throw Error("secret raw error"); return { version: 3, items: [task], questions: [] }; }, mappings: () => ({}) });
    const [a, b] = await Promise.all([service.read(), service.read()]);
    expect(calls).toBe(1); expect(a.tasks).toEqual(b.tasks); expect(a.source.error).toBeNull();
    now += 65_000;
    const stale = await service.read();
    expect(stale.tasks).toHaveLength(1); expect(stale.source.error).not.toBeNull();
    expect(stale.source.observed_at).toBe(a.source.observed_at);
    expect(JSON.stringify(stale)).not.toContain("secret raw error");
  });
  it("a felméréseket a feedhez fűzi, a hibájuk nem rontja el a feladatsort", async () => {
    const feed = { tasks: { t1: { preparation: "prepared", freshness: "current" as const, assessed_at: null, risk: null, summary: "S", recommendation: "R", rationale: "I", missing_information: [] } }, decisions: {}, stories: {}, observed_at: "2026-10-27T00:00:00.000Z", error: null };
    const ok = new GgOverviewService({ load: async () => ({ version: 3, items: [task], questions: [] }), mappings: () => ({}), assessments: async () => feed });
    await ok.read(); await new Promise(resolve => setTimeout(resolve, 0));
    expect((await ok.read()).assessments?.tasks.t1?.summary).toBe("S");
    const failing = new GgOverviewService({ load: async () => ({ version: 3, items: [task], questions: [] }), mappings: () => ({}), assessments: async () => { throw Error("down"); } });
    await failing.read(); await new Promise(resolve => setTimeout(resolve, 0));
    const result = await failing.read();
    expect(result.tasks).toHaveLength(1); expect(result.source.error).toBeNull();
    expect(result.assessments?.error).not.toBeNull();
  });
  it("a lassú felmérésolvasás nem tartja vissza a feladatsort", async () => {
    const service = new GgOverviewService({ load: async () => ({ version: 3, items: [task], questions: [] }), mappings: () => ({}), assessments: () => new Promise(() => {}) });
    const result = await service.read();
    expect(result.tasks).toHaveLength(1);
    expect(result.assessments).toBeUndefined();
  });
});

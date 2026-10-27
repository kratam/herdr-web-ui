import { describe, expect, it } from "bun:test";
import type { GgAssessment, GgOverview, GgTask } from "../../shared/gg-overview.ts";
import { buildAttentionBoard } from "./ggAttentionBoard.ts";

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const MIGRATION = "migration_import_no_execution_approval";
const task = (id: string, extra: Partial<GgTask> = {}): GgTask => ({ id, title: "Munka " + id, state: "planned", story: "IT-1", url: null, repositories: ["GuestGuru/gg3-app"], reason: MIGRATION, updated_at: "2026-10-19T10:00:00.000Z", priority: 0, ...extra });
const prepared = (extra: Partial<GgAssessment> = {}): GgAssessment => ({ preparation: "prepared", freshness: "current", assessed_at: "2026-10-23T10:00:00.000Z", risk: { score: 4, explanation: "x" }, summary: "Helyzet", recommendation: "Javaslat", rationale: "Indok", missing_information: [], ...extra });
const feed = (tasks: GgTask[], extra: Partial<GgOverview> = {}): GgOverview => ({ tasks, decisions: [], repositories: [], source: { observed_at: null, error: null }, ...extra });
const assessments = (tasks: Record<string, GgAssessment>, stories: Record<string, string> = {}) => ({ tasks, decisions: {}, stories, observed_at: null, error: null });

describe("Áttekintés-besorolás", () => {
  it("a GG3-indulásig parkolt ügyet a Parkolt csoportba teszi, feloldási feltétellel", () => {
    const board = buildAttentionBoard(feed([task("a", { reason: MIGRATION + ",after_gg3_launch" })]), NOW);
    expect(board.parked).toHaveLength(1);
    expect(board.parked[0]?.next).toBe("a GG3-indulás után");
    expect(board.soon).toHaveLength(0);
  });
  it("a later nem parkolás: a hamarosan sorba kerül", () => {
    const board = buildAttentionBoard(feed([task("a", { reason: MIGRATION + ",later" })]), NOW);
    expect(board.parked).toHaveLength(0);
    expect(board.soon[0]?.meta).toContain("sor végén");
  });
  it("az On Hold projekt ügyét parkoltnak veszi", () => {
    expect(buildAttentionBoard(feed([task("a", { reason: MIGRATION + ",project_on_hold" })]), NOW).parked[0]?.next).toBe("amíg a projekt On Hold");
  });
  it("a nyitott külső függőség parkolás, és nyers okkód nem jelenik meg", () => {
    const row = buildAttentionBoard(feed([task("a", { reason: MIGRATION + ",project_on_hold,external_dependency_unresolved" }), task("b", { story: "IT-2", reason: MIGRATION + ",external_dependency_unresolved" })]), NOW).parked;
    expect(row.map(item => item.next)).toEqual(["amíg a projekt On Hold", "amíg a külső függőség nyitott"]);
    expect(row.map(item => item.meta).join(" ")).not.toMatch(/_/);
  });
  it("a későbbre tett ügyet parkoltnak veszi, dátummal", () => {
    const board = buildAttentionBoard(feed([task("a", { snoozed_until: "2026-11-02T10:00:00.000Z" })]), NOW);
    expect(board.parked[0]?.next).toStartWith("Későbbre téve:");
  });
  it("az elavult előkészítést nem mutatja aktuálisként", () => {
    const board = buildAttentionBoard(feed([task("a")], { assessments: assessments({ a: prepared({ freshness: "stale" }) }) }), NOW);
    expect(board.soon[0]?.meta).toStartWith("elavult előkészítés:");
    expect(board.decisions).toHaveLength(0);
  });
  it("a felmérés nélküli ügyet nem rejti el", () => {
    expect(buildAttentionBoard(feed([task("a")]), NOW).soon[0]?.meta).toBe("még nincs előkészítve");
  });
  it("az aktuális előkészítés dátumát mutatja, és a sor megkapja a felmérést", () => {
    const row = buildAttentionBoard(feed([task("a")], { assessments: assessments({ a: prepared() }) }), NOW).soon[0];
    expect(row?.meta).toStartWith("előkészítve:");
    expect(row?.assessment?.summary).toBe("Helyzet");
    expect(row?.age_days).toBe(4);
  });
  it("a késznek jelölt ügyet a Rendezendő csoportba teszi", () => {
    const board = buildAttentionBoard(feed([task("a")], { assessments: assessments({ a: prepared({ preparation: "completion_candidate" }) }) }), NOW);
    expect(board.cleanup).toHaveLength(1);
    expect(board.cleanup[0]?.next).toBe("az agent ellenőrzi a kész-feltételt, és lezárást javasol");
  });
  it("egy story taskjait egy sorba vonja, a story címével", () => {
    const tasks = Array.from({ length: 8 }, (_, index) => task("t" + index, { story: "IT-1843" }));
    const board = buildAttentionBoard(feed(tasks, { assessments: assessments({}, { "IT-1843": "Vendég journey page" }) }), NOW);
    expect(board.soon).toHaveLength(1);
    expect(board.soon[0]?.tasks).toHaveLength(8);
    expect(board.soon[0]?.title).toBe("Vendég journey page");
  });
  it("a story parkolt taskja nem rejti el a többit", () => {
    const board = buildAttentionBoard(feed([task("a", { reason: MIGRATION + ",after_gg3_launch" }), task("b"), task("c")]), NOW);
    expect(board.parked[0]?.tasks).toHaveLength(1);
    expect(board.soon[0]?.tasks).toHaveLength(2);
    expect(board.parked[0]?.title).toBe(board.soon[0]?.title);
  });
  it("a nyitott döntés storyja csomagot kap, a taskja nem kerül a futók közé", () => {
    const decision = { id: "d1", task_id: "w", text: "Mehet?", proposal: "Igen", url: null, risk: { score: 3, explanation: "y" }, story: "IT-1953" };
    const board = buildAttentionBoard(feed([task("w", { state: "waiting", story: "IT-1953" }), task("r", { state: "review", story: "IT-1937" })], { decisions: [decision] }), NOW);
    expect(board.decisions).toHaveLength(1);
    expect(board.decisions[0]?.story).toBe("IT-1953");
    expect(board.running.map(row => row.story)).toEqual(["IT-1937"]);
  });
  it("prioritás szerint rendez, a 0 és a later hátra kerül", () => {
    const board = buildAttentionBoard(feed([task("x", { story: "IT-9", priority: 0 }), task("y", { story: "IT-8", priority: 2, reason: MIGRATION + ",later" }), task("z", { story: "IT-7", priority: 2 }), task("w", { story: "IT-6", priority: 1 })]), NOW);
    expect(board.soon.map(row => row.story)).toEqual(["IT-6", "IT-7", "IT-8", "IT-9"]);
  });
  it("a migrációs ok nem jelenik meg szövegként", () => {
    const board = buildAttentionBoard(feed([task("a"), task("b", { story: "IT-2", state: "failed", reason: MIGRATION })]), NOW);
    const texts = [...board.soon, ...board.running].flatMap(row => [row.next, row.meta]);
    expect(texts.join(" ")).not.toContain(MIGRATION);
  });
});

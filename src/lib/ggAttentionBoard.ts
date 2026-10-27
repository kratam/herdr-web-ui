import type { GgAssessment, GgDecision, GgOverview, GgTask } from "../../shared/gg-overview.ts";
import { isGgSnoozed } from "./ggTaskAttention.ts";

export interface StoryRow { story: string | null; title: string; tasks: GgTask[]; next: string; meta: string; assessment: GgAssessment | null; age_days: number | null }
export interface DecisionPackage { story: string | null; title: string; decisions: GgDecision[]; tasks: GgTask[]; assessment: GgAssessment | null }
export interface AttentionBoard { decisions: DecisionPackage[]; soon: StoryRow[]; parked: StoryRow[]; cleanup: StoryRow[]; running: StoryRow[] }

// a migrációs import minden régi taskon ott van; önmagában nem mond semmit, nem mutatjuk
const MIGRATION = "migration_import_no_execution_approval";
const CLEANUP = ["completion_candidate", "duplicate_candidate", "obsolete_candidate"];
const RUNNING_LABELS: Record<string, string> = { ready: "indítható, sorra vár", running: "fut", waiting: "várakozik", review: "review folyamatban", failed: "hibás" };
const DAY = 86_400_000;
const reasons = (task: GgTask): string[] => (task.reason ?? "").split(",").map(reason => reason.trim()).filter(reason => reason && reason !== MIGRATION);
const day = (iso: string) => new Date(iso).toLocaleDateString("hu-HU");

/** A forrásból jövő parkolás feloldási feltétele; nincs parkolás: null. A later nem parkolás. */
function parkedBecause(task: GgTask, now: number): string | null {
  const list = reasons(task);
  if (list.includes("after_gg3_launch")) return "a GG3-indulás után";
  if (list.some(reason => reason.startsWith("after_"))) return "mérföldkő után";
  if (list.includes("project_on_hold")) return "amíg a projekt On Hold";
  if (list.includes("external_dependency_unresolved")) return "amíg a külső függőség nyitott";
  if (isGgSnoozed(task, now)) return "Későbbre téve: " + day(task.snoozed_until!);
  return null;
}

/** Story szerinti csoportosítás; story nélküli task saját sort kap. */
function byStory(tasks: GgTask[]): GgTask[][] {
  const groups = new Map<string, GgTask[]>();
  for (const task of tasks) {
    const key = task.story ?? "task:" + task.id;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups.values()];
}

/** Az Áttekintés teendő-szerinti besorolása: mi vár Tamásra most, mi kerül hozzá hamarosan, és mivel nincs dolga. */
export function buildAttentionBoard(feed: GgOverview, now: number): AttentionBoard {
  const stories = feed.assessments?.stories ?? {};
  const taskAssessment = (task: GgTask) => feed.assessments?.tasks[task.id] ?? null;
  // egy story minden során ugyanaz a cím: a story-cím, ennek hiányában a story első taskjáé
  const title = (tasks: GgTask[]) => { const story = tasks[0]!.story; return (story ? stories[story] ?? feed.tasks.find(task => task.story === story)?.title : undefined) ?? tasks[0]!.title; };
  const row = (tasks: GgTask[], next: string, meta: string, assessment: GgAssessment | null): StoryRow => {
    const since = assessment?.assessed_at ?? tasks.map(task => task.updated_at).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
    return { story: tasks[0]!.story, title: title(tasks), tasks, next, meta, assessment, age_days: since ? Math.floor((now - Date.parse(since)) / DAY) : null };
  };

  const decisionTasks = new Set(feed.decisions.map(decision => decision.task_id));
  const decisionGroups = new Map<string, GgDecision[]>();
  for (const decision of feed.decisions) {
    const story = decision.story ?? feed.tasks.find(task => task.id === decision.task_id)?.story ?? null;
    const key = story ?? "decision:" + decision.id;
    decisionGroups.set(key, [...(decisionGroups.get(key) ?? []), decision]);
  }
  const decisions: DecisionPackage[] = [...decisionGroups.values()].map(list => {
    const tasks = feed.tasks.filter(task => list.some(decision => decision.task_id === task.id));
    const story = list[0]!.story ?? tasks[0]?.story ?? null;
    const assessment = list.map(decision => feed.assessments?.decisions[decision.id]).find(value => value?.freshness === "current") ?? null;
    return { story, title: (story ? stories[story] : undefined) ?? tasks[0]?.title ?? list[0]!.text, decisions: list, tasks, assessment };
  });

  const running = byStory(feed.tasks.filter(task => task.state !== "planned" && RUNNING_LABELS[task.state] && !decisionTasks.has(task.id))).map(tasks => {
    const failed = tasks.find(task => task.state === "failed");
    const next = failed ? "hibás" + (reasons(failed).length ? ": " + reasons(failed).join(", ") : "") : RUNNING_LABELS[tasks[0]!.state]!;
    return row(tasks, next, tasks.length > 1 ? tasks.length + " task" : "", null);
  });

  const planned = feed.tasks.filter(task => task.state === "planned" && !decisionTasks.has(task.id));
  const parked = byStory(planned.filter(task => parkedBecause(task, now) !== null)).map(tasks => row(tasks, parkedBecause(tasks[0]!, now)!, tasks.length > 1 ? tasks.length + " task" : "", null));
  const rest = planned.filter(task => parkedBecause(task, now) === null);
  const isCleanup = (task: GgTask) => { const value = taskAssessment(task); return value?.freshness === "current" && CLEANUP.includes(value.preparation ?? ""); };
  const cleanup = byStory(rest.filter(isCleanup)).map(tasks => row(tasks, "az agent ellenőrzi a kész-feltételt, és lezárást javasol", "", taskAssessment(tasks[0]!)));

  const soon = byStory(rest.filter(task => !isCleanup(task))).map(tasks => {
    const assessment = tasks.map(taskAssessment).find(value => value !== null) ?? null;
    const later = tasks.every(task => reasons(task).includes("later"));
    const state = !assessment ? "még nincs előkészítve" : (assessment.freshness === "stale" ? "elavult előkészítés: " : "előkészítve: ") + (assessment.assessed_at ? day(assessment.assessed_at) : "ismeretlen időpont");
    const meta = [state, tasks.length > 1 ? tasks.length + " task" : "", later ? "sor végén" : ""].filter(Boolean).join(" · ");
    return { ...row(tasks, "előkészítés döntésre", meta, assessment), later };
  });
  const rank = (tasks: GgTask[]) => Math.min(...tasks.map(task => task.priority || 5));
  soon.sort((a, b) => rank(a.tasks) - rank(b.tasks) || Number(a.later) - Number(b.later) || (b.age_days ?? 0) - (a.age_days ?? 0) || (a.story ?? "").localeCompare(b.story ?? ""));
  return { decisions, soon: soon.map(({ later: _later, ...rest }) => rest), parked, cleanup, running };
}

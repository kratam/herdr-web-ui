import type { GgAssessment, GgDecision, GgOverview, GgPreservedAnswer, GgSourceChecks, GgTask } from "../../shared/gg-overview.ts";
import { isGgSnoozed } from "./ggTaskAttention.ts";

export interface StoryRow { story: string | null; title: string; tasks: GgTask[]; next: string; meta: string; assessment: GgAssessment | null; age_days: number | null }
// döntésenkénti felmérés (decision_id → felmérés); a fejléc kockázata csak egyetlen döntésnél egyértelmű
// brief_changed: döntés → mióta tér el a task briefje (2. fázis); preserved: döntés → megőrzött válaszok
export interface DecisionPackage { story: string | null; title: string; decisions: GgDecision[]; tasks: GgTask[]; assessments: Record<string, GgAssessment>; risk: { score: number; explanation: string } | null;
  brief_changed: Record<string, string | null>; preserved: Record<string, GgPreservedAnswer[]> }
export interface AttentionBoard { decisions: DecisionPackage[]; stuck: StoryRow[]; soon: StoryRow[]; parked: StoryRow[]; cleanup: StoryRow[]; running: StoryRow[] }

// a migrációs import minden régi taskon ott van; önmagában nem mond semmit, nem mutatjuk
const MIGRATION = "migration_import_no_execution_approval";
const CLEANUP = ["completion_candidate", "duplicate_candidate", "obsolete_candidate"];
const RUNNING_LABELS: Record<string, string> = { ready: "indítható, sorra vár", running: "fut", waiting: "várakozik", review: "review folyamatban" };
// a core blocked_reason kódjainak felületi címkéje
const REASON_LABELS: Record<string, string> = { after_gg3_launch: "a GG3-indulás után", project_on_hold: "a projekt On Hold", external_dependency_unresolved: "nyitott külső függőség", later: "sor végén", decision_pending: "döntésre vár", source_parked: "a forrásban parkolva" };
const DAY = 86_400_000;
const reasons = (task: GgTask): string[] => (task.reason ?? "").split(",").map(reason => reason.trim()).filter(reason => reason && reason !== MIGRATION);
const day = (iso: string) => new Date(iso).toLocaleDateString("hu-HU");
/** Olvasható okok; az ismeretlen kódot jelölve megtartjuk, nem rejtjük el. */
export const reasonLabels = (reason: string | null): string[] => (reason ?? "").split(",").map(code => code.trim()).filter(code => code && code !== MIGRATION).map(code => REASON_LABELS[code] ?? "egyéb ok: " + code);

/** A gg-mb forrás-ellenőrzés szerinti parkolás olvasható oka (Linear-címke, mérföldkő, On Hold, blocked-by). */
function sourceParkedLabel(parked: GgSourceChecks["parked"][string]): string {
  const reason = parked.reason;
  if (reason === "parking") return "Parkol: kézzel parkoltatva (parking címke)";
  if (reason.startsWith("after:")) return "Parkol, amíg: a(z) " + reason.slice(6) + " mérföldkő teljesül";
  if (reason === "on_hold") return "Parkol, amíg: a projekt On Hold";
  if (reason.startsWith("blocked_by:")) {
    const names = parked.blockers.length ? parked.blockers.map(blocker => blocker.title ? blocker.identifier + " " + blocker.title : blocker.identifier)
      : reason.slice(11).split(",").filter(id => /^[A-Z][A-Z0-9]*-\d+$/.test(id));
    return names.length ? "Parkol, amíg: lezárul: " + names.join(", ") : "Parkol, amíg: a blokkolók lezárulnak (a lista hiányos)";
  }
  return "Parkol: " + reason;
}

/** A forrásból jövő parkolás feloldási feltétele; nincs parkolás: null. A later nem parkolás. */
function parkedBecause(task: GgTask, now: number, checks?: GgSourceChecks | null): string | null {
  const source = task.story ? checks?.parked[task.story] : undefined;
  if (source) return sourceParkedLabel(source);
  const list = reasons(task);
  if (list.includes("after_gg3_launch")) return "Parkol, amíg: a GG3-indulás után";
  if (list.some(reason => reason.startsWith("after_"))) return "Parkol, amíg: egy mérföldkő teljesül";
  if (list.includes("project_on_hold")) return "Parkol, amíg: a projekt On Hold";
  if (list.includes("external_dependency_unresolved")) return "Parkol, amíg: a külső függőség nyitott";
  if (isGgSnoozed(task, now)) return "Későbbre téve eddig: " + day(task.snoozed_until!);
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
  const checks = feed.assessments?.source_checks ?? null;
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
    const assessments: Record<string, GgAssessment> = {};
    for (const decision of list) { const value = feed.assessments?.decisions[decision.id]; if (value?.freshness === "current") assessments[decision.id] = value; }
    const only = list.length === 1 ? list[0]! : null;
    const risk = only ? only.risk ?? assessments[only.id]?.risk ?? null : null;
    const brief_changed: Record<string, string | null> = {}, preserved: Record<string, GgPreservedAnswer[]> = {};
    for (const decision of list) {
      const changed = checks?.brief_changed[decision.task_id];
      if (changed) brief_changed[decision.id] = changed.changed_at;
      const kept = feed.assessments?.preserved?.[decision.id];
      if (kept?.length) preserved[decision.id] = kept;
    }
    return { story, title: (story ? stories[story] : undefined) ?? tasks[0]?.title ?? list[0]!.text, decisions: list, tasks, assessments, risk, brief_changed, preserved };
  });

  const rank = (tasks: GgTask[]) => Math.min(...tasks.map(task => task.priority || 5));
  const running = byStory(feed.tasks.filter(task => RUNNING_LABELS[task.state] && !decisionTasks.has(task.id)))
    .map(tasks => row(tasks, RUNNING_LABELS[tasks[0]!.state]!, tasks.length > 1 ? tasks.length + " task" : "", null));
  // a hibás munka nem „nincs vele teendő”: külön sáv, sürgősség szerint
  const stuck = byStory(feed.tasks.filter(task => task.state === "failed" && !decisionTasks.has(task.id))).map(tasks => {
    const labels = reasonLabels(tasks[0]!.reason);
    return row(tasks, labels.length ? "hibás: " + labels.join(", ") : "hibás, az ok nincs megadva", tasks.length > 1 ? tasks.length + " task" : "", null);
  }).sort((a, b) => rank(a.tasks) - rank(b.tasks) || (a.story ?? "").localeCompare(b.story ?? ""));

  const planned = feed.tasks.filter(task => task.state === "planned" && !decisionTasks.has(task.id));
  const parked = byStory(planned.filter(task => parkedBecause(task, now, checks) !== null)).map(tasks => row(tasks, parkedBecause(tasks[0]!, now, checks)!, tasks.length > 1 ? tasks.length + " task" : "", null));
  const rest = planned.filter(task => parkedBecause(task, now, checks) === null);
  const isCleanup = (task: GgTask) => { const value = taskAssessment(task); return value?.freshness === "current" && CLEANUP.includes(value.preparation ?? ""); };
  const cleanup = byStory(rest.filter(isCleanup)).map(tasks => row(tasks, "az agent ellenőrzi a kész-feltételt, és lezárást javasol", "", taskAssessment(tasks[0]!)));

  const soon = byStory(rest.filter(task => !isCleanup(task))).map(tasks => {
    const assessment = tasks.map(taskAssessment).find(value => value !== null) ?? null;
    const later = tasks.every(task => reasons(task).includes("later"));
    const state = !assessment ? "még nincs előkészítve" : (assessment.freshness === "stale" ? "elavult előkészítés: " : "előkészítve: ") + (assessment.assessed_at ? day(assessment.assessed_at) : "ismeretlen időpont");
    const meta = [state, tasks.length > 1 ? tasks.length + " task" : "", later ? "sor végén" : ""].filter(Boolean).join(" · ");
    return { ...row(tasks, "előkészítés döntésre", meta, assessment), later };
  });
  soon.sort((a, b) => rank(a.tasks) - rank(b.tasks) || Number(a.later) - Number(b.later) || (b.age_days ?? 0) - (a.age_days ?? 0) || (a.story ?? "").localeCompare(b.story ?? ""));
  return { decisions, stuck, soon: soon.map(({ later: _later, ...rest }) => rest), parked, cleanup, running };
}

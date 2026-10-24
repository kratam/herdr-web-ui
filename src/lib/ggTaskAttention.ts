import type { GgTask } from "../../shared/gg-overview.ts";
export type GgTaskFilter = "now" | "unranked" | "review" | "snoozed" | "all";
export const GG_PRIORITIES = ["Besorolandó", "Sürgős", "Magas", "Normál", "Alacsony"];
export const isGgSnoozed = (task: GgTask, now: number): boolean => task.state === "planned" && Boolean(task.snoozed_until && Date.parse(task.snoozed_until) > now);
/** A későbbre tétel kizárólag a tervezett listából rejt, döntést és hibát sosem. */
export function selectGgTasks(tasks: GgTask[], filter: GgTaskFilter, sort: "priority" | "updated", now: number): GgTask[] {
  return tasks.filter(task => filter === "all" || (filter === "snoozed" ? isGgSnoozed(task, now) : !isGgSnoozed(task, now) && (filter === "unranked" ? task.priority === 0 : filter === "review" ? task.priority_needs_review : true)))
    .sort((a, b) => (sort === "priority" ? (a.priority || 5) - (b.priority || 5) : (Date.parse(b.updated_at ?? "") || 0) - (Date.parse(a.updated_at ?? "") || 0)) || a.title.localeCompare(b.title, "hu") || a.id.localeCompare(b.id));
}

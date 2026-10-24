import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GgTask } from "../../shared/gg-overview.ts";
import type { GgOverviewFeed } from "../lib/ggOverviewFeed.ts";
import { GG_PRIORITIES, isGgSnoozed, selectGgTasks, type GgTaskFilter } from "../lib/ggTaskAttention.ts";

/** Ugyanaz a story-szintű prioritás és személyes átnézés a globális és workspace-nézetben. */
export function GgTaskList({ tasks, cache, disabled, chip, actions }: { tasks: GgTask[]; cache: GgOverviewFeed; disabled: boolean; chip(state: string): ReactNode; actions?: (task: GgTask) => ReactNode }) {
  const [filter, setFilter] = useState<GgTaskFilter>("now");
  const [sort, setSort] = useState<"priority" | "updated">("priority");
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState<string | null>(null);
  const saving = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, { value: number; expected: number }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const [date, setDate] = useState("");
  useEffect(() => {
    const tick = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 30_000);
    return () => window.clearInterval(tick);
  }, []);
  const change = async (task: GgTask, body: Record<string, unknown>) => {
    if (saving.current) return;
    saving.current = true; setBusy(task.id); setNotice(null);
    try { await cache.change({ task_id: task.id, ...body }); setCustom(null); setNow(Date.now()); }
    catch (error) { setNotice(error instanceof Error ? error.message : "A mentés eredménye nem igazolt."); }
    finally {
      if (body.action === "priority") setDrafts(previous => { const next = { ...previous }; delete next[task.id]; return next; });
      saving.current = false; setBusy(null); }
  };
  useEffect(() => {
    setDrafts(previous => {
      const next = Object.fromEntries(Object.entries(previous).filter(([id, draft]) => tasks.some(task => task.id === id && task.priority === draft.expected)));
      return Object.keys(next).length === Object.keys(previous).length ? previous : next;
    });
  }, [tasks]);
  const snooze = (task: GgTask, value: string) => {
    if (value === "custom") { setCustom(task.id); setDate(""); return; }
    const until = value === "clear" ? null : new Date(Date.now() + Number(value) * 86400_000).toISOString();
    void change(task, { action: "snooze", snoozed_until: until });
  };
  const visible = selectGgTasks(tasks, filter, sort, now);
  const filters: [GgTaskFilter, string][] = [["now", "Most"], ["unranked", "Besorolandó"], ["review", "Ellenőrizendő prioritás"], ["snoozed", "Későbbre tett"], ["all", "Összes"]];
  return <div className="gg-work-list">
    <div className="gg-work-toolbar"><label>Nézet<select aria-label="Munkák szűrése" value={filter} onChange={event => setFilter(event.target.value as GgTaskFilter)}>{filters.map(([value, label]) => <option key={value} value={value}>{label} ({selectGgTasks(tasks, value, sort, now).length})</option>)}</select></label><label>Rendezés<select aria-label="Munkák rendezése" value={sort} onChange={event => setSort(event.target.value as "priority" | "updated")}><option value="priority">Linear-prioritás</option><option value="updated">Legutóbb módosított</option></select></label></div>
    <p className="gg-section-hint">A prioritás a Linear-story összes munkájára érvényes. A későbbre tétel a story összes tervezett munkáját rejti az átnézésből; az agentek futását nem állítja meg.</p>
    {notice && <p className="gg-overview-warning" role="alert">{notice}</p>}
    {visible.map(task => <div className="gg-overview-item gg-task" key={task.id} aria-busy={busy === task.id || undefined}>
      <div className="gg-task-content"><div className="gg-task-heading">{task.url ? <a href={task.url} target="_blank" rel="noreferrer">{task.title}</a> : <span>{task.title}</span>}{chip(task.state)}</div><small>{task.story}{task.reason ? " · " + task.reason : ""}{task.repositories.length ? " · " + task.repositories.map(repo => repo.split("/").at(-1)).join(", ") : ""}</small>
        {task.priority_needs_review && <small className="gg-priority-review">Ellenőrizendő prioritás · korábbi agentírás, az emberi szándék nem igazolt</small>}
        {task.priority_sync_pending && <small>Linear mentve · a core-tükör frissítésére vár</small>}
        {isGgSnoozed(task, now) && <small>Későbbre téve: {new Date(task.snoozed_until!).toLocaleString("hu-HU")}</small>}
      </div>
      <div className="gg-work-controls"><label>Prioritás<select aria-label={"Prioritás · " + task.title} className={"gg-priority gg-priority--" + (task.priority ?? "unknown")} value={drafts[task.id]?.value ?? task.priority ?? "unknown"} disabled={disabled || busy !== null || !task.story || task.priority == null} onChange={event => setDrafts(previous => ({ ...previous, [task.id]: { value: Number(event.target.value), expected: task.priority! } }))}>{task.priority == null && <option value="unknown">Nem ismert</option>}{GG_PRIORITIES.map((label, value) => <option key={value} value={value}>{value ? "P" + value + " · " : "— · "}{label}</option>)}</select></label>
        {(drafts[task.id] || task.priority_needs_review) && <button className="btn btn-ghost" aria-label={"Prioritás mentése · " + task.title} disabled={disabled || busy !== null} onClick={() => void change(task, { action: "priority", expected: drafts[task.id]?.expected ?? task.priority, priority: drafts[task.id]?.value ?? task.priority })}>{drafts[task.id] ? "Mentés" : "Megerősítem"}</button>}
        {task.state === "planned" && <label>Átnézés<select aria-label={"Későbbre · " + task.title} value="" disabled={disabled || busy !== null} onChange={event => snooze(task, event.target.value)}><option value="">Későbbre…</option><option value="1">1 nap</option><option value="2">2 nap</option><option value="7">1 hét</option><option value="14">2 hét</option><option value="30">1 hónap</option><option value="custom">Dátum választása…</option>{isGgSnoozed(task, now) && <option value="clear">Vissza a mostaniakhoz</option>}</select></label>}
      </div>
      {custom === task.id && <form className="gg-work-custom" onSubmit={event => { event.preventDefault(); if (date) void change(task, { action: "snooze", snoozed_until: new Date(date).toISOString() }); }}><label>Mikor nézzük újra?<input aria-label="Átnézés dátuma" type="datetime-local" required value={date} onChange={event => setDate(event.target.value)} /></label><button className="btn btn-ghost" disabled={disabled || busy !== null}>Mentés</button><button type="button" className="btn btn-ghost" onClick={() => setCustom(null)}>Mégse</button></form>}
      {actions?.(task)}
    </div>)}
    {!visible.length && <p className="gg-overview-empty">Ebben a nézetben nincs munka.</p>}
  </div>;
}

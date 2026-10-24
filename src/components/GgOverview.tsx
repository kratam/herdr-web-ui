import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, RefreshCw, Terminal } from "lucide-react";
import type { GgOverviewFeed } from "../lib/ggOverviewFeed.ts";
import { copyText } from "../lib/clipboard.ts";
import { openGgIssueTab } from "../lib/ggIssueTab.ts";
import type { Machine } from "../../shared/machines.ts";
import { createTab, createWorkspace, fetchAgentKinds } from "../lib/api.ts";
import { buildGgGroups, hasKnownGgData, type GgGroup, type GgLiveWorkspace } from "../lib/ggOverview.ts";
import { displayPaneTitle } from "./Sidebar.tsx";
import { PANE_TABPANEL_ID } from "../lib/paneRegion.ts";
import { TabStrip } from "./TabStrip.tsx";
import type { PaneInfo, SessionSnapshot, WorkspaceInfo } from "../../shared/protocol.ts";
import type { AppActions } from "../lib/actions.ts";
import type { GgOverview } from "../lib/useGgOverview.ts";
import "./GgOverview.css";

export interface GgOverviewTarget { machineId: string; workspaceId: string | null }
interface Props {
  target: GgOverviewTarget;
  cache: GgOverviewFeed;
  onAgentPane(machineId: string, paneId: string, started: boolean): void;
  machines: Machine[];
  onWorkspace(machineId: string, workspaceId: string, paneId: string): void;
  onPane(machineId: string, paneId: string): void;
  onGlobal(): void;
}
const STATES: Record<string, string> = { planned: "Tervezett", ready: "Indítható", running: "Fut", waiting: "Várakozik", review: "Review-ra vár", failed: "Hibás", succeeded: "Kész, nyitott kérdéssel", canceled: "Lezárt, nyitott kérdéssel", working: "Dolgozik", done: "Átadható", idle: "Tétlen", blocked: "Interaktív kérdés", unknown: "Ismeretlen" };

/** Saját GG-nézet: a natív tabok és a tartós taskok külön számlálódnak, mert nem ugyanazok. */
export function GgOverviewPanel({ target, cache, machines, onWorkspace, onPane, onAgentPane, onGlobal }: Props) {
  const { feed, error: loadError, loading } = useSyncExternalStore(cache.subscribe, cache.read);
  const [agents, setAgents] = useState<string[]>([]);
  const [agentRead, setAgentRead] = useState(0);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [launchNotice, setLaunchNotice] = useState<{ text: string; paneId?: string } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const selection = useRef("");
  selection.current = target.machineId + ":" + target.workspaceId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [openError, setOpenError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => { if (!document.hidden) void cache.refresh(); };
    load();
    const interval = window.setInterval(load, 30_000);
    document.addEventListener("visibilitychange", load);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", load); };
  }, [cache]);
  const localOnline = machines.find(machine => machine.id === "local")?.state === "connected";
  useEffect(() => {
    let active = true;
    setAgents([]); setAgentError(null);
    if (localOnline) void fetchAgentKinds("local").then(kinds => { if (active) setAgents(kinds.map(agent => agent.kind)); }).catch(() => { if (active) setAgentError("Az elérhető agentek listája nem olvasható. A Frissítés gombbal újrapróbálhatod."); });
    return () => { active = false; };
  }, [localOnline, agentRead]);
  const live = useMemo<GgLiveWorkspace[]>(() => machines.flatMap(machine => (machine.snapshot?.workspaces ?? []).map(workspace => {
    const panes = machine.snapshot!.panes.filter(pane => pane.workspace_id === workspace.workspace_id);
    return { machineId: machine.id, id: workspace.workspace_id, label: workspace.label, online: machine.state === "connected", roots: [...new Set([workspace.worktree?.repo_root, ...panes.map(pane => pane.cwd)].filter((path): path is string => Boolean(path)))], panes: panes.map(pane => ({ id: pane.pane_id, title: displayPaneTitle(pane), agent: pane.agent ?? null, status: pane.agent_status, error: pane.restore_error ?? null })) };
  })), [machines]);
  const groups = useMemo(() => buildGgGroups(feed, live), [feed, live]);
  const selected = target.workspaceId === null ? null : groups.find(group => group.machineId === target.machineId && group.workspaceId === target.workspaceId);
  const sourceError = loadError ?? feed?.source.error ?? null;
  const known = hasKnownGgData(feed);
  const unavailable = sourceError !== null;
  const counts = (group: GgGroup) => {
    const local = group.machineId === "local";
    return { decisions: local && known ? String(group.decisions.length) : "—", tasks: local && known ? String(group.tasks.length) : "—" };
  };
  const open = async (group: GgGroup) => {
    if (inFlight.current) return;
    setOpenError(null);
    if (group.workspaceId !== null) {
      const workspace = live.find(row => row.machineId === group.machineId && row.id === group.workspaceId);
      const snapshot = machines.find(machine => machine.id === group.machineId)?.snapshot;
      const activeTab = snapshot?.workspaces.find(row => row.workspace_id === group.workspaceId)?.active_tab_id;
      const focusedPane = snapshot?.layouts.find(layout => layout.tab_id === activeTab)?.focused_pane_id;
      const pane = workspace?.panes.find(row => row.id === focusedPane) ?? workspace?.panes[0];
      if (!pane || !group.online) { setOpenError("A workspace most nem érhető el ezen a gépen."); return; }
      onWorkspace(group.machineId, group.workspaceId, pane.id); return;
    }
    if (!group.path) { setOpenError("Ehhez a repositoryhoz még nincs helyi megnyitási könyvtár rendelve."); return; }
    const local = machines.find(machine => machine.id === "local");
    if (local?.state !== "connected" || !local.snapshot) { setOpenError("A helyi workspace-lista nem friss. Megnyitás előtt várd meg a kapcsolat helyreállását."); return; }
    inFlight.current = true; setOpening(group.key);
    const requestedSelection = selection.current;
    try {
      const created = await createWorkspace({ cwd: group.path, label: group.label }, "local");
      if (mounted.current && selection.current === requestedSelection) onWorkspace("local", created.workspace_id, created.pane_id);
    } catch { if (mounted.current) setOpenError("A megnyitás eredménye nem igazolt. Frissítsd az Ovis workspace-listáját az újrapróbálás előtt."); }
    finally { inFlight.current = false; if (mounted.current) setOpening(null); }
  };
  const launchIssue = async (task: GgGroup["tasks"][number], kind: "codex" | "claude") => {
    if (inFlight.current || !selected?.workspaceId || !selected.online || selected.machineId !== "local" || !task.url || !agents.includes(kind)) return;
    inFlight.current = true; setOpening(task.id); setLaunchNotice(null);
    const requestedSelection = selection.current;
    const active = () => mounted.current && selection.current === requestedSelection;
    try {
      const outcome = await openGgIssueTab({ workspaceId: selected.workspaceId, title: task.story ? task.story + " · " + task.title : task.title, url: task.url, kind }, copyText, body => createTab(body, "local"), active);
      if (!active()) return;
      if (outcome.kind === "created") {
        if (outcome.tab.agent_started) onAgentPane("local", outcome.tab.pane_id, true);
        else setLaunchNotice({ text: "A link a vágólapon van, a tab megnyílt, de az agent nem indult el. A tabon ellenőrizheted." + (outcome.tab.error?.message ? " " + outcome.tab.error.message : ""), paneId: outcome.tab.pane_id });
      } else if (outcome.kind === "copy_failed") setLaunchNotice({ text: "A vágólapra másolás nem sikerült, ezért nem nyitottunk tabot. Másold ki a feladat linkjét, vagy próbáld újra." });
      else if (outcome.kind === "unconfirmed") setLaunchNotice({ text: "A link a vágólapon van, de a tabnyitás eredménye nem igazolt. Újrapróbálás előtt ellenőrizd a workspace tabjait." });
    } finally { inFlight.current = false; if (mounted.current) setOpening(null); }
  };
  const chip = (state: string) => <span className={"gg-status gg-status--" + state}>{STATES[state] ?? state}</span>;
  const paneLink = (group: GgGroup, id: string, label: string) => <button className="gg-overview-link" type="button" disabled={!group.online} onClick={() => onPane(group.machineId, id)}>{label}</button>;
  const external = (url: string | null, label: string) => url ? <a href={url} target="_blank" rel="noreferrer">{label}</a> : null;
  const workspaceMode = target.workspaceId !== null;
  return <section id={PANE_TABPANEL_ID} role={workspaceMode ? "tabpanel" : undefined} className="gg-overview" aria-label={workspaceMode ? "Workspace-áttekintés" : "Globális áttekintés"}>
    <div className="gg-overview-heading"><div><h1>{workspaceMode ? selected?.label ?? "Workspace betöltése…" : "Globális áttekintés"}</h1><p>{workspaceMode ? "A workspace döntései, munkái és hibái" : "Minden nyilvántartott munka, a bezárt workspace-eké is"}</p></div><button className="btn btn-ghost gg-overview-refresh" disabled={loading} onClick={() => { void cache.refresh(true); setAgentRead(value => value + 1); }}><RefreshCw aria-hidden="true" />{loading ? "Frissítés…" : "Frissítés"}</button></div>
    {sourceError && <p className="gg-overview-warning" role="status">{sourceError}</p>}
    {!feed && !sourceError && <p role="status">A feladatsor betöltése… Az élő workspace-ek már látszanak.</p>}
    {openError && <p className="error-state" role="alert">{openError}</p>}
    {agentError && workspaceMode && <p className="gg-overview-warning" role="status">{agentError}</p>}
    {launchNotice && <p className="gg-overview-warning" role="status">{launchNotice.text}{launchNotice.paneId && <button className="gg-overview-link" onClick={() => onAgentPane("local", launchNotice.paneId!, false)}>Tab megnyitása</button>}</p>}
    {!workspaceMode ? <>
      <div className="gg-overview-table"><table><thead><tr><th>Workspace / repository</th><th>Döntések</th><th>Munkák</th><th>Hibák</th></tr></thead><tbody>{groups.map(group => <tr key={group.key}>
        <td><a href="#gg-workspace" aria-busy={opening === group.key || undefined} onClick={event => { event.preventDefault(); void open(group); }}>{group.label}</a><small>{group.workspaceId === null ? "Nincs nyitott workspace" : group.online ? "Nyitott" : "Nem élő kapcsolat"}{group.machineId !== "local" ? " · " + (machines.find(machine => machine.id === group.machineId)?.name ?? group.machineId) : ""}</small></td>
        <td>{counts(group).decisions}{unavailable && group.machineId === "local" && known ? "*" : ""}<small>{group.agents.filter(pane => pane.status === "blocked").length} interaktív kérdés{!group.online && group.workspaceId !== null ? " · régi állapot" : ""}</small></td>
        <td>{counts(group).tasks}{unavailable && group.machineId === "local" && known ? "*" : ""}<small>{group.agents.length} élő agent{!group.online && group.workspaceId !== null ? " · régi állapot" : ""}</small></td>
        <td>{known || group.errors.length ? group.errors.length : "—"}{unavailable && known ? "*" : ""}</td>
      </tr>)}</tbody></table></div>
      {groups.length === 0 && <p className="gg-overview-empty">Nincs ismert workspace vagy tartós feladat.</p>}
    </> : selected ? <>
      {!selected.online && <p className="gg-overview-warning" role="status">A workspace kapcsolata nem élő; a pane-ek utolsó ismert állapotát látod.</p>}
      <section className="gg-overview-section"><h2>Nyitott döntések</h2>
        {selected.decisions.map(decision => <details key={decision.id}><summary>{decision.text}</summary><div className="gg-overview-details">{decision.proposal && <p>{decision.proposal}</p>}{external(decision.url, "Döntés megnyitása")}{!decision.url && external(selected.tasks.find(task => task.id === decision.task_id)?.url ?? null, "Kapcsolódó feladat")}</div></details>)}
        {selected.agents.filter(pane => pane.status === "blocked").map(pane => <div className="gg-overview-item" key={pane.id}><span>Interaktív kérdés · {pane.title}</span>{paneLink(selected, pane.id, "Tab megnyitása")}</div>)}
        {!selected.decisions.length && !selected.agents.some(pane => pane.status === "blocked") && <p className="gg-overview-empty">{known && !unavailable && selected.machineId === "local" ? "Nincs ismert nyitott döntés." : "A tartós döntési sor állapota nem ismert."}</p>}
      </section>
      <section className="gg-overview-section"><h2>Munkák <span className="gg-section-count">{selected.tasks.length + selected.agents.length}</span></h2>
        {selected.tasks.some(task => task.url) && selected.machineId === "local" && <p className="gg-section-hint">A Codex / Claude gomb másolja az issue linkjét, és új agenttabot nyit. Beillesztés után hozzáírhatod az utasításodat.</p>}
        {selected.tasks.map(task => <div className="gg-overview-item gg-task" key={task.id}>
          <div className="gg-task-content"><div className="gg-task-heading">{external(task.url, task.title) ?? <span>{task.title}</span>}{chip(task.state)}</div><small>{task.story}{task.reason ? " · " + task.reason : ""}</small></div>
          {task.url && selected.machineId === "local" && <div className="gg-task-actions" role="group" aria-label={task.title + " megnyitása"}>{(["codex", "claude"] as const).map(kind => <button type="button" className="btn btn-ghost" key={kind} aria-label={(kind === "codex" ? "Codex" : "Claude") + " · " + task.title} disabled={opening !== null || !selected.online || !agents.includes(kind)} title={!selected.online ? "A workspace nem érhető el." : !agents.includes(kind) ? "Az agent nem érhető el ezen a gépen." : "Issue-link másolása és új " + (kind === "codex" ? "Codex" : "Claude") + " tab"} onClick={() => void launchIssue(task, kind)}><Terminal aria-hidden="true" />{kind === "codex" ? "Codex" : "Claude"}<ArrowUpRight aria-hidden="true" /></button>)}</div>}
        </div>)}
        {selected.agents.map(pane => <div className="gg-overview-item" key={pane.id}><div>{paneLink(selected, pane.id, pane.title)}<small>{pane.agent} · élő agent</small></div>{chip(pane.status)}</div>)}
        {!selected.tasks.length && !selected.agents.length && <p className="gg-overview-empty">{known && !unavailable ? "Nincs ismert munka." : "A tartós feladatsor állapota nem ismert."}</p>}
      </section>
      <section className="gg-overview-section"><h2>Hibák</h2>{selected.errors.map(error => <div className="gg-overview-item" key={error.id}><span>{error.title}</span>{error.paneId ? paneLink(selected, error.paneId, "Tab megnyitása") : external(error.url ?? null, "Feladat megnyitása")}</div>)}{!selected.errors.length && <p className="gg-overview-empty">{known && !unavailable ? "Nincs ismert hiba." : "A tartós hibák állapota nem ismert. Élő restore-hiba nincs."}</p>}</section>
      <button className="btn btn-ghost" onClick={onGlobal}>Vissza a globális áttekintéshez</button>
    </> : <><p role="status">A workspace még nem töltődött be, vagy közben bezárták.</p><button className="btn btn-ghost" onClick={onGlobal}>Vissza a globális áttekintéshez</button></>}
    <p className="gg-overview-footnote">A közvetlen sessionökből az Ovis által észlelt interaktív kérdések látszanak; a beszélgetésben maradt, nem regisztrált döntések nem teljes körűek. A tartós task és az élő agent külön adat, ugyanazt a munkát is jelenthetik. {feed?.source.observed_at ? "Feladatsor lekérdezve: " + new Date(feed.source.observed_at).toLocaleString("hu-HU") + "." : ""}{unavailable && known ? " * Utolsó ismert adatok." : ""} Másik gépről csak az Ovis élő rosterét mutatjuk.</p>
  </section>;
}

/** A fejléc címe az áttekintő alatt (az App a pane-morzsa helyett ezt mutatja). */
export function GgOverviewTitle({ target }: { target: GgOverviewTarget }) {
  return <div className="context"><div className="context-title"><span className="context-title-text">{target.workspaceId === null ? "Globális áttekintés" : "Workspace-áttekintés"}</span></div></div>;
}

/** Az áttekintő a pane-terület helyén: workspace-nézetben a workspace tabsorával együtt. */
export function GgOverviewHost({ gg, machines, snapshot, selectedMachineId, selectedPane, selectedWorkspace, actions, load }: {
  gg: GgOverview;
  machines: Machine[];
  snapshot: SessionSnapshot | null | undefined;
  selectedMachineId: string;
  selectedPane: PaneInfo | null;
  selectedWorkspace: WorkspaceInfo | null;
  actions: AppActions;
  load(): unknown;
}) {
  const target = gg.target;
  if (target === null) return null;
  return <div className="gg-overview-host">
    {target.workspaceId !== null && selectedPane && selectedWorkspace && selectedMachineId === target.machineId && selectedWorkspace.workspace_id === target.workspaceId && snapshot && <TabStrip snapshot={snapshot} workspace={selectedWorkspace} selectedPane={selectedPane} onSelectPane={gg.selectPane} onNewTab={() => actions.openNewTab()} onNewTerminal={() => actions.openTerminalTab()} overview={{ selected: true, onSelect: () => undefined }} />}
    <GgOverviewPanel cache={gg.feed} onAgentPane={(machineId, paneId, started) => { if (started) actions.agentStarted(machineId, paneId); gg.selectTarget(machineId, paneId); void load(); }} target={target} machines={machines} onPane={(machineId, paneId) => gg.selectTarget(machineId, paneId)} onWorkspace={(machineId, workspaceId, paneId) => { gg.selectTarget(machineId, paneId); gg.setTarget({ machineId, workspaceId }); void load(); }} onGlobal={() => gg.setTarget({ machineId: "local", workspaceId: null })} />
  </div>;
}

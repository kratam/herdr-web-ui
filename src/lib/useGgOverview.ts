import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Machine } from "../../shared/machines.ts";
import type { GgOverviewTarget } from "../components/GgOverview.tsx";
import type { PaneView } from "./actions.ts";
import { overviewShortcutAllowed } from "./ggOverview.ts";
import { GgOverviewFeed } from "./ggOverviewFeed.ts";
import { adjacentGgTab } from "./ggOverviewNavigation.ts";
import { lastViewedPane, rememberViewedPane } from "./lastViewedPane.ts";
import type { ShortcutId } from "./shortcuts.ts";

type SelectTarget = (machineId: string, paneId: string | null, view?: PaneView) => void;
type SelectPane = (paneId: string, focusInput?: boolean) => void;
interface RosterPane { pane_id: string; workspace_id: string }

export type GgOverview = ReturnType<typeof useGgOverview>;

/**
 * Saját GG-kiegészítés: a globális és a workspace-áttekintő állapota és viselkedése egy helyen.
 * Az App.tsx-ben így csak néhány sor marad, és az upstream App-refaktorok ritkábban ütköznek vele.
 * A kapott `selectTarget`/`selectPane` az upstream hookoké; a visszaadott változatok kilépnek az áttekintőből.
 */
export function useGgOverview({ locked, watching, snapshot, selectedMachineId, selectedPaneId, selectTarget: selectTargetBase, selectPane: selectPaneBase, setDrawerOpen }: {
  locked: boolean | null;
  watching: boolean;
  snapshot: Machine["snapshot"];
  selectedMachineId: string;
  selectedPaneId: string | null;
  selectTarget: SelectTarget;
  selectPane: SelectPane;
  setDrawerOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const [feed] = useState(() => new GgOverviewFeed());
  const [target, setTarget] = useState<GgOverviewTarget | null>(() => new URLSearchParams(window.location.search).get("ggOverview") === "global" ? { machineId: "local", workspaceId: null } : null);
  // zárolt állapotban a betöltött áttekintő-adat nem maradhat a memóriában
  useEffect(() => { if (locked !== false) feed.clear(); }, [locked, feed]);

  // minden pane-választás kilép az áttekintőből, a selectTargetRef-en át történők is (értesítés, címsor, gépváltás)
  const selectTarget = useCallback<SelectTarget>((machineId, paneId, view) => {
    setTarget(null);
    selectTargetBase(machineId, paneId, view);
  }, [selectTargetBase]);
  const selectTargetRef = useRef(selectTarget); selectTargetRef.current = selectTarget;
  const selectPane = useCallback((paneId: string, focusInput = true) => {
    setTarget(null);
    selectPaneBase(paneId, focusInput);
  }, [selectPaneBase]);

  // a workspace legutóbbi nézete (áttekintő vagy pane) a sidebar workspace-sorának kattintásához
  const selectedPane = snapshot?.panes.find((pane) => pane.pane_id === selectedPaneId);
  const selectedWorkspaceId = selectedPane && snapshot?.workspaces.some((workspace) => workspace.workspace_id === selectedPane.workspace_id) ? selectedPane.workspace_id : null;
  useEffect(() => {
    if (target?.workspaceId) rememberViewedPane("workspace-view", target.machineId, target.workspaceId, "@overview");
    else if (target === null && selectedWorkspaceId && selectedPaneId) rememberViewedPane("workspace-view", selectedMachineId, selectedWorkspaceId, selectedPaneId);
  }, [target, selectedMachineId, selectedWorkspaceId, selectedPaneId]);

  // Pane-léptetés (előző/következő pane): a workspace-áttekintő is egy lépés. True, ha ez kezelte;
  // néző módban az upstream léptetés marad. A ref miatt stabil, az App actions-memója nem függ tőle.
  const latest = useRef({ target, watching, selectedMachineId, selectedPaneId, selectPane });
  latest.current = { target, watching, selectedMachineId, selectedPaneId, selectPane };
  const stepPane = useCallback((panes: readonly RosterPane[], direction: -1 | 1): boolean => {
    const { target, watching, selectedMachineId, selectedPaneId, selectPane } = latest.current;
    if (watching) return false;
    const current = target !== null ? target.workspaceId === null ? null : { workspaceId: target.workspaceId } : selectedPaneId ? { paneId: selectedPaneId } : null;
    const next = adjacentGgTab(panes.map((pane) => ({ paneId: pane.pane_id, workspaceId: pane.workspace_id })), current, direction);
    if (next) {
      selectPane(next.paneId);
      if (next.overview) setTarget({ machineId: selectedMachineId, workspaceId: next.workspaceId });
    }
    return true;
  }, []);

  // az áttekintőben csak a navigációs gyorsbillentyűk működnek; az új tab kilép belőle
  const allowShortcut = useCallback((shortcut: ShortcutId): boolean => {
    if (target === null) return true;
    if (!overviewShortcutAllowed(shortcut)) return false;
    if (shortcut === "new-tab") setTarget(null);
    return true;
  }, [target]);

  // a MachineSidebar saját propjai (globális áttekintő gomb, workspace-sor kattintása)
  const sidebar = {
    overviewSelected: target?.workspaceId === null,
    onOverview: () => { setTarget({ machineId: "local", workspaceId: null }); setDrawerOpen(false); },
    onWorkspaceOverview: (machineId: string, workspaceId: string, paneId: string) => {
      const overview = lastViewedPane("workspace-view", machineId, workspaceId) === "@overview";
      selectTarget(machineId, paneId);
      if (overview) setTarget({ machineId, workspaceId });
    },
  };

  // a pane-tabsor rögzített „Áttekintés” tabja; néző módban nincs
  const tabOverview = (onSelect: SelectPane, paneId: string, machineId: string, workspaceId: string) => watching ? undefined : {
    selected: false,
    onSelect: () => { onSelect(paneId, false); setTarget({ machineId, workspaceId }); },
  };

  return { feed, target, setTarget, selectTarget, selectTargetRef, selectPane, stepPane, allowShortcut, sidebar, tabOverview };
}

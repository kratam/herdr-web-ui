import type { GgDecision, GgOverview, GgTask } from "../../shared/gg-overview.ts";

export interface GgLivePane { id: string; title: string; agent: string | null; status: string; error: string | null }
export interface GgLiveWorkspace { machineId: string; id: string; label: string; roots: string[]; panes: GgLivePane[]; online: boolean }
export interface GgGroup {
  key: string; label: string; machineId: string; workspaceId: string | null; path: string | null;
  online: boolean; tasks: GgTask[]; decisions: GgDecision[]; agents: GgLivePane[]; errors: Array<{ id: string; title: string; paneId?: string; url?: string | null }>;
}
const within = (root: string, parent: string): boolean => root === parent || root.startsWith(parent.replace(/\/$/, "") + "/");
export const hasKnownGgData = (feed: GgOverview | null): boolean => feed?.source.observed_at != null;
export const overviewShortcutAllowed = (shortcut: string): boolean => ["palette", "toggle-sidebar", "new-session", "new-tab", "previous-pane", "next-pane", "settings"].includes(shortcut);

/** Nem címkéből és nem agentstátuszból találunk ki taskot; az adatforrások külön maradnak. */
export function buildGgGroups(feed: GgOverview | null, live: GgLiveWorkspace[]): GgGroup[] {
  const groups: GgGroup[] = live.map(workspace => ({ key: workspace.machineId + ":" + workspace.id, label: workspace.label, machineId: workspace.machineId, workspaceId: workspace.id, path: workspace.roots[0] ?? null, online: workspace.online, tasks: [], decisions: [], agents: workspace.panes.filter(pane => pane.agent !== null), errors: workspace.panes.filter(pane => pane.error !== null).map(pane => ({ id: "restore:" + pane.id, title: pane.error!, paneId: pane.id })) }));
  if (!feed) return groups;
  const repositoryNames = new Set(feed.tasks.flatMap(task => task.repositories));
  const repositories = [...repositoryNames].map(repository => feed.repositories.find(row => row.repository === repository) ?? { repository, label: repository.split("/").at(-1)!, path: null });
  const assign = (group: GgGroup, tasks: GgTask[]): void => {
    for (const task of tasks) if (!group.tasks.some(row => row.id === task.id)) group.tasks.push(task);
  };
  for (const repository of repositories) {
    const tasks = feed.tasks.filter(task => task.repositories.includes(repository.repository));
    const matching = repository.path ? live.filter(workspace => workspace.machineId === "local" && workspace.roots.some(root => feed.roots?.[root] ? feed.roots[root] === repository.path : within(root, repository.path!))) : [];
    if (matching.length) for (const workspace of matching) assign(groups.find(group => group.key === workspace.machineId + ":" + workspace.id)!, tasks);
    else groups.push({ key: "repository:" + repository.repository, label: repository.label === repository.repository.split("/").at(-1) ? repository.label : repository.label + " / " + repository.repository.split("/").at(-1), machineId: "local", workspaceId: null, path: repository.path, online: false, tasks, decisions: [], agents: [], errors: [] });
  }
  const unmapped = feed.tasks.filter(task => !task.repositories.length);
  if (unmapped.length) groups.push({ key: "unmapped", label: "Repository nélkül", machineId: "local", workspaceId: null, path: null, online: false, tasks: unmapped, decisions: [], agents: [], errors: [] });
  for (const group of groups) {
    const ids = new Set(group.tasks.map(task => task.id));
    group.decisions = feed.decisions.filter(decision => ids.has(decision.task_id));
    group.errors.push(...group.tasks.filter(task => task.state === "failed").map(task => ({ id: "task:" + task.id, title: task.title + (task.reason ? ": " + task.reason : ""), url: task.url })));
  }
  return groups;
}

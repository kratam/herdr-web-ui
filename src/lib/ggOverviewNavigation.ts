interface Pane { paneId: string; workspaceId: string }
interface Entry extends Pane { overview: boolean }
type Current = { paneId: string } | { workspaceId: string } | null;

/** A meglévő pane-sorrendbe minden workspace elé bekerül a virtuális első tab. */
export function adjacentGgTab(panes: Pane[], current: Current, direction: -1 | 1): Entry | null {
  const entries: Entry[] = [], seen = new Set<string>();
  for (const pane of panes) {
    if (!seen.has(pane.workspaceId)) { entries.push({ ...pane, overview: true }); seen.add(pane.workspaceId); }
    entries.push({ ...pane, overview: false });
  }
  if (!entries.length) return null;
  const at = entries.findIndex(entry => current !== null && ("workspaceId" in current ? entry.overview && entry.workspaceId === current.workspaceId : !entry.overview && entry.paneId === current.paneId));
  if (at < 0) return direction === 1 ? entries[0]! : entries.at(-1)!;
  return entries[(at + direction + entries.length) % entries.length]!;
}

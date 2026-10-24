import { describe, expect, it } from "bun:test";
import { buildGgGroups, hasKnownGgData, overviewShortcutAllowed, type GgLiveWorkspace } from "./ggOverview.ts";
import type { GgOverview } from "../../shared/gg-overview.ts";

const feed: GgOverview = { tasks: [{ id: "t", title: "Feladat", state: "waiting", story: "IT-1", url: null, repositories: ["GuestGuru/a"], reason: null, updated_at: null }], decisions: [{ id: "q", task_id: "t", text: "Kérdés", proposal: null, url: null }], repositories: [{ repository: "GuestGuru/a", label: "a", path: "/repos/a" }], source: { error: null, observed_at: "2026-10-23T12:00:00Z" } };
const live: GgLiveWorkspace = { machineId: "local", id: "w1", label: "Élő", roots: ["/repos/a/sub"], panes: [{ id: "p1", title: "Worker", agent: "claude", status: "blocked", error: null }], online: true };
describe("Workspace-összesítés", () => {
  it("a globális gyorsbillentyűket engedi, a rejtett pane műveleteit tiltja", () => {
    for (const key of ["palette", "previous-pane", "next-pane", "new-tab", "settings"]) expect(overviewShortcutAllowed(key)).toBe(true);
    for (const key of ["find", "toggle-view", "focus-input", "split-right", "scroll-up"]) expect(overviewShortcutAllowed(key)).toBe(false);
  });
  it("első forráshibát nem tekint ismert üres feladatsornak", () => {
    expect(hasKnownGgData({ ...feed, source: { error: "Hiba", observed_at: null } })).toBe(false);
    expect(hasKnownGgData({ ...feed, source: { ...feed.source, error: "Hiba" } })).toBe(true);
  });
  it("a pontos könyvtárhoz köti a döntést, nem a hasonló nevű szomszédhoz", () => {
    const groups = buildGgGroups(feed, [live, { ...live, id: "w2", roots: ["/repos/another"], panes: [] }]);
    expect(groups.find(group => group.workspaceId === "w1")?.decisions).toHaveLength(1);
    expect(groups.find(group => group.workspaceId === "w2")?.tasks).toHaveLength(0);
  });
  it("bezárt workspace nélkül is megőrzi a tartós feladatokat és a megnyitási könyvtárat", () => {
    const groups = buildGgGroups(feed, []);
    expect(groups).toHaveLength(1); expect(groups[0]?.workspaceId).toBeNull();
    expect(groups[0]?.path).toBe("/repos/a"); expect(groups[0]?.decisions).toHaveLength(1);
  });
  it("másik gép azonos könyvtára nem kap helyi core-feladatot, és a shell nem lesz agent", () => {
    const groups = buildGgGroups(feed, [{ ...live, machineId: "remote", panes: [{ id: "shell", title: "Shell", agent: null, status: "working", error: null }] }]);
    const remote = groups.find(group => group.machineId === "remote")!;
    expect(remote.tasks).toHaveLength(0); expect(remote.agents).toHaveLength(0);
    expect(groups.find(group => group.workspaceId === null)?.tasks).toHaveLength(1);
  });
  it("hiányzó repository-kötést külön látható csoportban hagy", () => {
    const groups = buildGgGroups({ ...feed, tasks: [{ ...feed.tasks[0]!, repositories: [] }] }, []);
    expect(groups.flatMap(group => group.tasks)).toHaveLength(1);
    expect(groups.find(group => group.tasks.length)?.path).toBeNull();
  });
  it("a natívan nem jelölt git-worktree-t is a mért közös repositoryhoz köti", () => {
    const groups = buildGgGroups({ ...feed, roots: { "/worktrees/a-fix": "/repos/a" } }, [{ ...live, roots: ["/worktrees/a-fix"] }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.tasks).toHaveLength(1);
  });
  it("egy beágyazott önálló repository mért kötését nem írja felül az útvonalprefix", () => {
    const groups = buildGgGroups({ ...feed, roots: { "/repos/a/vendor/b": "/repos/a/vendor/b" } }, [{ ...live, roots: ["/repos/a/vendor/b"] }]);
    expect(groups.find(group => group.workspaceId === "w1")?.tasks).toHaveLength(0);
  });
});

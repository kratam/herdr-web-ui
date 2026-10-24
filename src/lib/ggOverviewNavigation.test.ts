import { expect, test } from "bun:test";
import { adjacentGgTab } from "./ggOverviewNavigation.ts";
const panes = [{ paneId: "a1", workspaceId: "a" }, { paneId: "a2", workspaceId: "a" }, { paneId: "b1", workspaceId: "b" }];
test("overview is before each workspace's native panes in the existing navigation order", () => {
  expect(adjacentGgTab(panes, { paneId: "a1" }, -1)).toEqual({ paneId: "a1", workspaceId: "a", overview: true });
  expect(adjacentGgTab(panes, { workspaceId: "a" }, 1)).toEqual({ paneId: "a1", workspaceId: "a", overview: false });
  expect(adjacentGgTab(panes, { paneId: "a2" }, 1)).toEqual({ paneId: "b1", workspaceId: "b", overview: true });
  expect(adjacentGgTab(panes, { workspaceId: "b" }, -1)).toEqual({ paneId: "a2", workspaceId: "a", overview: false });
});
test("wraps from the first overview and supports global overview and an empty roster", () => {
  expect(adjacentGgTab(panes, { workspaceId: "a" }, -1)?.paneId).toBe("b1");
  expect(adjacentGgTab(panes, null, 1)?.overview).toBe(true);
  expect(adjacentGgTab(panes, null, -1)?.paneId).toBe("b1");
  expect(adjacentGgTab([], null, 1)).toBeNull();
});

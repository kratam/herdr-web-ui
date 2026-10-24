import { expect, it } from "bun:test";
import type { GgTask } from "../../shared/gg-overview.ts";
import { selectGgTasks } from "./ggTaskAttention.ts";
const task: GgTask = { id: "a", title: "A", state: "planned", story: "IT-1", url: null, repositories: [], reason: null, updated_at: null };
it("prioritásban a sürgős az első, besorolatlan a végén; a halasztott lejáratkor visszakerül", () => {
  const tasks = [{ ...task, id: "none", priority: 0 }, { ...task, id: "low", priority: 4 }, { ...task, id: "high", priority: 2, snoozed_until: new Date(2000).toISOString() }];
  expect(selectGgTasks(tasks, "now", "priority", 1000).map(t => t.id)).toEqual(["low", "none"]);
  expect(selectGgTasks(tasks, "now", "priority", 2000).map(t => t.id)).toEqual(["high", "low", "none"]);
  expect(selectGgTasks(tasks, "unranked", "priority", 1000).map(t => t.id)).toEqual(["none"]);
});
it("a személyes halasztás nem rejti az időközben hibás vagy döntésre váró munkát", () => {
  expect(selectGgTasks([{ ...task, state: "failed", snoozed_until: new Date(9000).toISOString() }], "now", "priority", 1000)).toHaveLength(1);
});

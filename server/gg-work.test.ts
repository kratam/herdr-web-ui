import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GgOverview } from "../shared/gg-overview.ts";
import { GgAttentionStore } from "./gg-attention.ts";
import { GgWorkService } from "./gg-work.ts";
const feed: GgOverview = { tasks: [{ id: "t1", title: "A", state: "planned", story: "IT-1030", url: null, repositories: [], reason: null, updated_at: null, priority: 4 }], decisions: [], repositories: [], source: { error: null, observed_at: new Date(0).toISOString() } };
const request = (body: unknown) => new Request("http://localhost/api/gg/work", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
it("határon validál: watch/ismeretlen task/hibás prioritás/lejárt halasztás nem ír", async () => {
 const dir = mkdtempSync(join(tmpdir(), "gg-work-")); let writes = 0;
 try {
  const service = new GgWorkService(new GgAttentionStore(dir), async () => { writes++; throw Error("unexpected"); }, () => 1000);
  expect((await service.handle(request({}), feed, false)).status).toBe(403);
  expect((await service.handle(request({ task_id: "missing", action: "priority", priority: 2, expected: 4 }), feed, true)).status).toBe(409);
  expect((await service.handle(request({ task_id: "t1", action: "priority", priority: 7, expected: 4 }), feed, true)).status).toBe(400);
  expect((await service.handle(request({ task_id: "t1", action: "snooze", snoozed_until: new Date(0).toISOString() }), feed, true)).status).toBe(400);
  expect(writes).toBe(0);
 } finally { rmSync(dir, { recursive: true }); }
});
it("story-szintű prioritásnyugta minden taskban megjelenik, a frissebb core feloldja az áthidalást", async () => {
 const dir = mkdtempSync(join(tmpdir(), "gg-work-"));
 try {
  const store = new GgAttentionStore(dir), service = new GgWorkService(store, async (story, expected, priority) => { expect([story, expected, priority]).toEqual(["IT-1030", 4, 2]); return { priority, updated_at: new Date(2000).toISOString() }; });
  expect(service.decorate(feed).tasks[0]!.priority_needs_review).toBe(true);
  const result = await service.handle(request({ task_id: "t1", action: "priority", priority: 2, expected: 4 }), feed, true);
  expect(result.status).toBe(200);
  const two = service.decorate({ ...feed, tasks: [...feed.tasks, { ...feed.tasks[0]!, id: "t2" }] });
  expect(two.tasks.map(t => t.priority)).toEqual([2, 2]);
  expect(two.tasks[0]!.priority_sync_pending).toBe(true);
  expect(two.tasks[0]!.priority_needs_review).toBe(false);
  const caughtUp = service.decorate({ ...feed, tasks: [{ ...feed.tasks[0]!, priority: 2 }] });
  expect(caughtUp.tasks[0]!.priority_sync_pending).toBe(false);
  expect(store.get("IT-1030").priority_override).toBeUndefined();
  const changedAgain = service.decorate({ ...feed, tasks: [{ ...feed.tasks[0]!, priority: 3 }] });
  expect(changedAgain.tasks[0]!.priority).toBe(3);
  expect(changedAgain.tasks[0]!.priority_sync_pending).toBe(false);
  const fresh = service.decorate({ ...feed, tasks: [{ ...feed.tasks[0]!, priority: 3, priority_source_updated_at: new Date(3000).toISOString() }] });
  expect(fresh.tasks[0]!.priority).toBe(3); expect(fresh.tasks[0]!.priority_sync_pending).toBe(false);
 } finally { rmSync(dir, { recursive: true }); }
});
it("ütközés nem nyugtáz emberi besorolást, párhuzamos story-írás nem indul újra", async () => {
 const dir = mkdtempSync(join(tmpdir(), "gg-work-"));
 try {
  let finish!: () => void, started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const store = new GgAttentionStore(dir), service = new GgWorkService(store, async () => { await new Promise<void>(resolve => { finish = resolve; started(); }); return { priority: 3, updated_at: new Date(2000).toISOString(), conflict: true }; });
  const first = service.handle(request({ task_id: "t1", action: "priority", priority: 2, expected: 4 }), feed, true);
  await start;
  const second = await service.handle(request({ task_id: "t1", action: "priority", priority: 2, expected: 4 }), feed, true);
  expect(second.status).toBe(409); finish(); expect((await first).status).toBe(409);
  expect(store.get("IT-1030").reviewed_priority).toBeUndefined();
 } finally { rmSync(dir, { recursive: true }); }
});
it("halasztás megmarad újraindításkor, nem ír Lineart, futó/hibás task nem rejthető", async () => {
 const dir = mkdtempSync(join(tmpdir(), "gg-work-"));
 try {
  const service = new GgWorkService(new GgAttentionStore(dir), async () => { throw Error("must_not_write"); }, () => 1000);
  expect((await service.handle(request({ task_id: "t1", action: "snooze", snoozed_until: new Date(8000).toISOString() }), feed, true)).status).toBe(200);
  expect(new GgWorkService(new GgAttentionStore(dir)).decorate(feed).tasks[0]!.snoozed_until).toBe(new Date(8000).toISOString());
  expect((await service.handle(request({ task_id: "t1", action: "snooze", snoozed_until: null }), { ...feed, tasks: [{ ...feed.tasks[0]!, state: "failed" }] }, true)).status).toBe(400);
 } finally { rmSync(dir, { recursive: true }); }
});

import { expect, test } from "bun:test";
import type { GgOverview } from "../../shared/gg-overview.ts";
import { GgOverviewFeed } from "./ggOverviewFeed.ts";
const data: GgOverview = { tasks: [], decisions: [], repositories: [], source: { observed_at: "2026-10-23T12:00:00Z", error: null } };
test("retains known data between readers and refreshes stale data in the background", async () => {
  let calls = 0, now = 0;
  const cache = new GgOverviewFeed(async () => { calls++; return data; }, () => now);
  await cache.refresh();
  await cache.refresh();
  expect(calls).toBe(1);
  expect(cache.read().feed).toBe(data);
  now = 31_000;
  await cache.refresh();
  expect(calls).toBe(2);
  await cache.refresh(true);
  expect(calls).toBe(3);
});
test("coalesces simultaneous reads and retains data when a subsequent refresh fails", async () => {
  let resolve!: (value: GgOverview) => void, fail = false, calls = 0;
  const cache = new GgOverviewFeed(async () => { calls++; if (fail) throw Error("private internal failure"); return new Promise<GgOverview>(done => { resolve = done; }); });
  const first = cache.refresh(); const second = cache.refresh(true);
  expect(calls).toBe(1);
  resolve(data); await Promise.all([first, second]);
  fail = true; await cache.refresh(true);
  expect(cache.read().feed).toBe(data);
  expect(cache.read().error).not.toContain("private");
  expect(cache.read().error).not.toBeNull();
  expect(cache.read().loading).toBe(false);
});
test("auth reset aborts a request and rejects its late response", async () => {
  let resolve!: (value: GgOverview) => void, signal!: AbortSignal;
  const cache = new GgOverviewFeed(async input => { signal = input; return new Promise<GgOverview>(done => { resolve = done; }); });
  const pending = cache.refresh();
  cache.clear();
  expect(signal.aborted).toBe(true);
  resolve(data); await pending;
  expect(cache.read()).toEqual({ feed: null, error: null, loading: false });
});
test("a late pre-reset read cannot overwrite a new authenticated read", async () => {
  const reads: Array<(value: GgOverview) => void> = [];
  const cache = new GgOverviewFeed(async () => new Promise<GgOverview>(resolve => { reads.push(resolve); }));
  const old = cache.refresh(); cache.clear(); const fresh = cache.refresh();
  const current = { ...data, source: { observed_at: "2026-10-23T13:00:00Z", error: null } };
  reads[1]!(current); await fresh;
  reads[0]!(data); await old;
  expect(cache.read().feed).toBe(current);
});

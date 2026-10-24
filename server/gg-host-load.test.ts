import { expect, it } from "bun:test";
import { GgHostLoads, parseGgHostLoad } from "./gg-host-load.ts";
it("Linux és macOS terhelést olvas, hibát nem változtat nullává", () => {
  expect(parseGgHostLoad("8\n1.2 2.3 4.5\n", 0)).toEqual({ cpus: 8, load: [1.2, 2.3, 4.5], observed_at: new Date(0).toISOString() });
  expect(() => parseGgHostLoad("8\nunknown")).toThrow();
});
it("gépenként összevon és percig cache-el, hiba esetén jelölt régi értéket őriz", async () => {
  let now = 100_000, calls = 0;
  const service = new GgHostLoads(async () => { calls++; if (calls > 1) throw Error("private"); return parseGgHostLoad("4 1 2 3", now); }, () => now);
  const machines = [{ id: "remote", state: "connected" as const }];
  await Promise.all([service.response(machines), service.response(machines)]);
  expect(calls).toBe(1);
  now += 61_000;
  const body = await (await service.response(machines)).json();
  expect(body.hosts[0].data.load).toEqual([1, 2, 3]); expect(body.hosts[0].error).toBeTruthy();
  const offline = await (await service.response([{ id: "remote", state: "disconnected" }])).json();
  expect(offline.hosts[0].error).toBeTruthy(); expect(calls).toBe(2);
});

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GgAttentionStore } from "./gg-attention.ts";

describe("GG személyes átnézési állapot", () => {
  it("újraindításkor is megőrzi a story-szintű halasztást és prioritásnyugtát", () => {
    const dir = mkdtempSync(join(tmpdir(), "gg-attention-"));
    try {
      const store = new GgAttentionStore(dir);
      store.set("IT-1", { snoozed_until: "2026-11-01T12:00:00.000Z" });
      store.set("IT-1", { reviewed_priority: 3, priority_override: { value: 3, updated_at: "2026-10-24T12:00:00Z" } });
      expect(new GgAttentionStore(dir).get("IT-1")).toEqual(store.get("IT-1"));
      store.set("IT-1", { snoozed_until: null });
      expect(store.get("IT-1").reviewed_priority).toBe(3);
    } finally { rmSync(dir, { recursive: true }); }
  });
  it("sérült állapotot nem ír felül üres adattal", () => {
    const dir = mkdtempSync(join(tmpdir(), "gg-attention-"));
    try {
      writeFileSync(join(dir, "gg-attention.json"), "broken");
      const store = new GgAttentionStore(dir);
      expect(() => store.set("IT-1", { snoozed_until: null })).toThrow();
    } finally { rmSync(dir, { recursive: true }); }
  });
});

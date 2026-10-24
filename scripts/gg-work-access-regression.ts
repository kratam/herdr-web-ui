import "./test-herdr.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEVICE_COOKIE } from "../server/auth.ts";
import { createServer } from "../server/index.ts";
import { GgOverviewService } from "../server/gg-overview.ts";
import { UsageService } from "../server/usage.ts";
const root = mkdtempSync(join(tmpdir(), "gg-access-"));
const token = "gg-access-fixture", watchToken = "gg-watch-fixture";
writeFileSync(join(root, "devices.json"), JSON.stringify({ gate_closed_at: new Date().toISOString(), devices: [{ id: "watch-fixture", label: "Watch fixture", role: "watch", token_hash: createHash("sha256").update(watchToken).digest("hex"), created_at: new Date().toISOString(), last_seen_at: null }] }));
let reads = 0;
const service = new GgOverviewService({ load: async () => { reads++; return { version: 3, items: [], questions: [] }; }, mappings: () => ({}) });
const server = createServer({ port: 0, hostname: "127.0.0.1", stateDir: root, token, tailscaleOwner: null, tailscaleServeOnly: false, machines: false, usage: new UsageService(undefined, []), ggOverview: service });
try {
 const origin = `http://127.0.0.1:${server.port}`;
 for (const path of ["overview", "host-loads", "work"]) {
  const method = path === "work" ? "PUT" : "GET";
  const anonymous = await fetch(`${origin}/api/gg/${path}`, { method, headers: { origin } });
  assert.equal(anonymous.status, 401); await anonymous.body?.cancel();
  const watch = await fetch(`${origin}/api/gg/${path}`, { method, headers: { origin, cookie: `${DEVICE_COOKIE}=${watchToken}` } });
  assert.equal(watch.status, 403); await watch.body?.cancel();
 }
 assert.equal(reads, 0);
 const crossSite = await fetch(`${origin}/api/gg/work`, { method: "PUT", headers: { authorization: `Bearer ${token}`, origin: "https://other.invalid", "content-type": "application/json" }, body: "{}" });
 assert.equal(crossSite.status, 403); await crossSite.body?.cancel();
 assert.equal(reads, 0);
 const allowed = await fetch(`${origin}/api/gg/overview`, { headers: { authorization: `Bearer ${token}` } });
 assert.equal(allowed.status, 200); await allowed.body?.cancel(); assert.equal(reads, 1);
 console.log("PASS: anonim/watch/cross-origin GG-írás és privát olvasás elutasítva forrásolvasás nélkül; interaktív olvasás engedett.");
} finally { server.stop(); rmSync(root, { recursive: true, force: true }); }

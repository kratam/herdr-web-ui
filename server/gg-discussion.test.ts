import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GgDiscussionService, selectDiscussionAgent, type DiscussionIdentity } from "./gg-discussion.ts";
import type { GgDecisionDetail } from "../shared/gg-decisions.ts";
import { PendingInputError } from "./pending-input.ts";

const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
const question: GgDecisionDetail = { binding: { decision_id: "e604002f-2993-4675-9c68-4808a010f808", task_id: "01e66a97-c5de-4526-aad8-3d996843d693", expected_epoch: 2, expected_source_revision: "a".repeat(64) },
  question_key: "CORE-TEST", story: "IT-1", text: "A kép látszódjon?", state: "pending", response_type: "boolean", choices: [], proposal: "Igen", rationale: null, risk: null, plans: [], blocked_reason: null };
const identity: DiscussionIdentity = { pane_id: "w1:p3", terminal_id: "terminal-owned", agent: "claude", name: "gg-decisions", process_pid: 100, process_birth: 200, session: "session-owned" };
function setup() {
  const root = mkdtempSync(join(tmpdir(), "ovis-decision-test-")); roots.push(root);
  let live: DiscussionIdentity | null = null, creates = 0, starts = 0;
  const prompts: string[] = [];
  const deps = {
    inspect: async () => live,
    create: async () => { creates++; return { pane_id: identity.pane_id, terminal_id: identity.terminal_id }; },
    choose: async () => ({ kind: "claude" as const, args: ["--model", "sonnet"], env: { CLAUDE_CONFIG_DIR: "" } }),
    start: async (_pane: string, _choice: unknown, name: string) => { starts++; live = { ...identity, name }; return true; },
    queue: async (_pane: string, prompt: string) => { prompts.push(prompt); return true; },
  };
  return { root, deps, service: new GgDiscussionService(root, deps), prompts, stats: () => ({ creates, starts }), replace: (next: DiscussionIdentity | null) => { live = next; } };
}
it("két egyidejű kattintás egy tabot és egy döntési üzenetet hoz létre, újraindítás után is ugyanazt használja", async () => {
  const fixture = setup();
  const [a, b] = await Promise.all([fixture.service.open(question, "page"), fixture.service.open(question, "page")]);
  expect(a.pane_id).toBe(b.pane_id); expect(fixture.stats()).toEqual({ creates: 1, starts: 1 }); expect(fixture.prompts).toHaveLength(1);
  const reopened = new GgDiscussionService(fixture.root, fixture.deps);
  await reopened.open({ ...question, binding: { ...question.binding, decision_id: "e604002f-2993-4675-9c68-4808a010f809" } }, "page");
  expect(fixture.stats()).toEqual({ creates: 1, starts: 1 }); expect(fixture.prompts).toHaveLength(2);
  expect(fixture.prompts[0]).toContain("e604002f-2993-4675-9c68-4808a010f808");
  expect(fixture.prompts[0]).toContain("agent-decisions");
});
it("lecserélt folyamatnak nem küld kontextust, bezárt pane után viszont új saját tabot nyit", async () => {
  const fixture = setup(); await fixture.service.open(question, "page");
  fixture.replace({ ...identity, process_pid: 101 });
  await expect(fixture.service.open(question, "page")).rejects.toThrow("discussion_identity_changed");
  expect(fixture.prompts).toHaveLength(1);
  fixture.replace(null); await fixture.service.open(question, "page");
  expect(fixture.stats().creates).toBe(2);
});
it("bizonytalan üzenetsorba adást nem ismétel automatikusan", async () => {
  const fixture = setup();
  fixture.deps.queue = async () => { throw Error("connection lost"); };
  const a = await fixture.service.open(question, "page");
  expect(a.queued).toBeFalse(); expect(a.error).toBe("discussion_delivery_unconfirmed");
  fixture.deps.queue = async () => { throw Error("must not retry"); };
  const b = await fixture.service.open(question, "page");
  expect(b.error).toBe("discussion_delivery_unconfirmed"); expect(fixture.stats()).toEqual({ creates: 1, starts: 1 });
});
it("az induláshoz a tényleges heti keretet nézi; elfogyott vagy nem mért keretből nem választ", () => {
  const now = Date.now(), checked_at = new Date(now).toISOString();
  const providers = ["codex", "claude"].map((id, index) => ({ id: id as "codex" | "claude", key: id, account: null, plan: null, problem: null,
    checked_at, windows: [{ kind: "week" as const, scope: null, used_percent: index ? 89 : 100, resets_at: null, starts_at: null }] }));
  expect(selectDiscussionAgent(providers.map(usage => ({ usage, env: {} })), now).kind).toBe("claude");
  expect(() => selectDiscussionAgent([], now)).toThrow("discussion_quota_unavailable");
});
it("Ovis-újraindítás után nem állítja kézbesítettnek a régi memóriabeli üzenetet", async () => {
  const fixture = setup(); await fixture.service.open(question, "page");
  const reopened = new GgDiscussionService(fixture.root, fixture.deps);
  const result = await reopened.open(question, "page");
  expect(result.queued).toBeFalse(); expect(result.error).toBe("discussion_delivery_unconfirmed");
  expect(fixture.prompts).toHaveLength(1);
});
it("a bizonyítottan megtelt üzenetsor után későbbi kézi kérés újrapróbálható, új tab nélkül", async () => {
  const fixture = setup();
  fixture.deps.queue = async () => { throw new PendingInputError("pending_limit", "full"); };
  const held = await fixture.service.open(question, "page"); expect(held.error).toBe("discussion_queue_full");
  fixture.deps.queue = async () => true;
  expect((await fixture.service.open(question, "page")).queued).toBeTrue(); expect(fixture.stats().creates).toBe(1);
});
it("hiányzó mapping javítása után indulhat; egyszeri indulás utáni olvasóhibából ugyanazt a sessiont állítja helyre", async () => {
  const fixture = setup(), create = fixture.deps.create, inspect = fixture.deps.inspect;
  fixture.deps.create = async () => { throw Error("discussion_workspace_missing"); };
  await expect(fixture.service.open(question, "page")).rejects.toThrow("discussion_workspace_missing");
  fixture.deps.create = create;
  fixture.deps.inspect = async () => { throw Error("temporary rpc failure"); };
  const first = await fixture.service.open(question, "page"); expect(first.error).toBe("discussion_start_unconfirmed");
  fixture.deps.inspect = inspect;
  const recovered = await fixture.service.open(question, "page"); expect(recovered.queued).toBeTrue();
  expect(fixture.stats()).toEqual({ creates: 1, starts: 1 }); expect(fixture.prompts).toHaveLength(1);
});
it("az igazolt profil környezetét adja tovább, és kimerült profilt nem választ", async () => {
  const now = Date.now(), checked_at = new Date(now).toISOString();
  const usage = { id: "codex" as const, key: "codex:default", account: null, plan: null, problem: null, checked_at, windows: [{ kind: "week" as const, scope: null, used_percent: 5, resets_at: null, starts_at: null }] };
  const profile = { usage, env: { CODEX_HOME: "/fixture/codex-primary" } };
  const agent = selectDiscussionAgent([profile], now);
  expect(agent.kind).toBe("codex"); expect(agent.env).toEqual(profile.env);
  expect(() => selectDiscussionAgent([{ ...profile, usage: { ...usage, windows: [{ ...usage.windows[0]!, used_percent: 100 }] } }], now)).toThrow("discussion_quota_unavailable");
  const fixture = setup();
  const environments: Record<string, string>[] = [];
  const create = fixture.deps.create;
  const service = new GgDiscussionService(fixture.root, { ...fixture.deps, choose: async () => agent, create: async selected => { environments.push(selected.env); return create(); } });
  await service.open(question, "page");
  expect(environments).toEqual([profile.env]);
});

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { GgDecisionService, projectDecision } from "./gg-decisions.ts";

const decisionId = "e604002f-2993-4675-9c68-4808a010f808";
const taskId = "01e66a97-c5de-4526-aad8-3d996843d693";
const requestId = "8752423d-9ea7-4ad8-b2df-062be6a7f6d4";
const revision = "a".repeat(64);
const question = {
  id: decisionId, task_id: taskId, story_identifier: "IT-1", question_key: "CORE-TEST",
  text: "A kép jelenjen meg?", state: "pending", purpose: "information", response_type: "boolean",
  epoch: 2, source_revision: revision, choices: [], proposal: { label: "Kép", value: true, rationale: "Könnyebb elolvasni." },
  proposal_risk: { score: 4, explanation: "Megjelenés változik." }, authorizations: [],
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const binding = { decision_id: decisionId, task_id: taskId, expected_epoch: 2, expected_source_revision: revision };

describe("GG canonical döntésválasz", () => {
  it("a teljes nyers választ és a megtekintett kötést a session_reply-nak adja, ready/Linear-írás nélkül", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const raw = " Igen.\nA második sor is az eredeti válasz. ";
    const service = new GgDecisionService(async (name, args) => {
      calls.push({ name, args });
      return { version: 3, operation: "session_reply", state: "recorded", decision_id: decisionId, task_id: taskId,
        request_key: requestId, response_id: "e604002f-2993-4675-9c68-4808a010f809", delivery: "direct",
        raw_text_sha256: hash(raw), answer_text_sha256: hash(raw), answer_processing: "answered" };
    });
    const result = await service.reply({ binding, request_key: requestId, raw_text: raw });
    expect(result.answer_processing).toBe("answered");
    expect(calls).toEqual([{ name: "autoagent_task_action", args: { action: { ...binding, operation: "session_reply", request_key: requestId,
      raw_text: raw, answer_text: raw, origin: { kind: "native_ui", message_ref: requestId } } } }]);
  });
  it("a félreérthető választ rögzítettként, de továbbra is pontosítandóként adja vissza", async () => {
    const service = new GgDecisionService(async () => ({ version: 3, operation: "session_reply", state: "recorded", decision_id: decisionId,
      task_id: taskId, request_key: requestId, response_id: requestId, delivery: "direct", raw_text_sha256: hash("talán"),
      answer_text_sha256: hash("talán"), answer_processing: "ambiguous" }));
    expect((await service.reply({ binding, request_key: requestId, raw_text: "talán" })).answer_processing).toBe("ambiguous");
  });
  it("más döntés nyugtáját és üres választ nem állítja sikeres mentésnek", async () => {
    const service = new GgDecisionService(async () => ({ state: "recorded", decision_id: taskId, answer_processing: "answered" }));
    await expect(service.reply({ binding, request_key: requestId, raw_text: "igen" })).rejects.toThrow("reply_unconfirmed");
    await expect(service.reply({ binding, request_key: requestId, raw_text: "  " })).rejects.toThrow("invalid_reply");
  });
  it("a hiányzó döntést a következő oldalon is megkeresi; nem teszi egyenlővé az üres első lapot a teljes sorral", async () => {
    const offsets: unknown[] = [];
    const service = new GgDecisionService(async (name, args) => {
      expect(name).toBe("autoagent_decisions"); offsets.push(args.offset);
      return args.offset === 0 ? { items: Array.from({ length: 50 }, () => ({ ...question, id: taskId })), total: 51 }
        : { items: [question], total: 51 };
    });
    expect((await service.detail(decisionId, "IT-1")).binding).toEqual(binding);
    expect(offsets).toEqual([0, 50]);
  });
  it("a tiszta review-hoz a PR-headhalmazt, vegyes engedélyhez a teljes tervhalmazt köti", () => {
    const refs = [{ repository: "GuestGuru/example", url: "https://github.com/GuestGuru/example/pull/1", head_sha: "b".repeat(40) }];
    const plan = { id: requestId, descriptor_hash: "c".repeat(64), expires_at: "2099-01-01T00:00:00Z", descriptor: {
      operation_name: "task.review.accept", arguments: { pr_refs: refs }, scope: { resource_ids: [taskId] }, cost_limit_units: 0, max_uses: 1,
    } };
    const review = projectDecision({ ...question, purpose: "authorization", authorizations: [plan] });
    expect(review.binding.expected_pr_refs).toEqual(refs);
    expect(review.binding.expected_plan_hashes).toBeUndefined();
    const mixed = projectDecision({ ...question, purpose: "authorization", authorizations: [plan, { ...plan, id: taskId, descriptor: { ...plan.descriptor, operation_name: "github.pr.merge" } }] });
    expect(mixed.binding.expected_plan_hashes).toEqual([{ plan_id: requestId, descriptor_hash: "c".repeat(64) }, { plan_id: taskId, descriptor_hash: "c".repeat(64) }]);
    expect(projectDecision({ ...question, purpose: "authorization", authorizations: [{ ...plan, expires_at: "2000-01-01T00:00:00Z" }] }).blocked_reason).toBe("expired_plan");
  });
});

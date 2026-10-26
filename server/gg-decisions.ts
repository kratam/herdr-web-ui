import { createHash } from "node:crypto";
import type { GgDecisionBinding, GgDecisionDetail, GgDecisionReceipt, GgPrRef } from "../shared/gg-decisions.ts";
import { callGgTool, type GgToolCall } from "./gg-mcp.ts";

const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const sha = (value: unknown, length = 64): value is string => typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`, "i").test(value);
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function prRefs(value: unknown): GgPrRef[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw Error("invalid_reply");
  return value.map(raw => {
    const ref = object(raw);
    if (typeof ref.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(ref.repository) || typeof ref.url !== "string" || !sha(ref.head_sha, 40)) throw Error("invalid_reply");
    const expected = `https://github.com/${ref.repository}/pull/`;
    if (!ref.url.toLowerCase().startsWith(expected.toLowerCase()) || !/^\d+$/.test(ref.url.slice(expected.length))) throw Error("invalid_reply");
    return { repository: ref.repository, url: ref.url, head_sha: ref.head_sha };
  });
}

function readBinding(value: unknown): GgDecisionBinding {
  const input = object(value);
  if (!uuid(input.decision_id) || !uuid(input.task_id) || !Number.isSafeInteger(input.expected_epoch) || Number(input.expected_epoch) < 1 || !sha(input.expected_source_revision)) throw Error("invalid_reply");
  const binding: GgDecisionBinding = { decision_id: input.decision_id, task_id: input.task_id, expected_epoch: Number(input.expected_epoch), expected_source_revision: input.expected_source_revision };
  if (input.expected_pr_refs !== undefined) binding.expected_pr_refs = prRefs(input.expected_pr_refs);
  if (input.expected_plan_hashes !== undefined) {
    if (!Array.isArray(input.expected_plan_hashes) || input.expected_plan_hashes.length < 1 || input.expected_plan_hashes.length > 20) throw Error("invalid_reply");
    binding.expected_plan_hashes = input.expected_plan_hashes.map(raw => {
      const item = object(raw);
      if (!uuid(item.plan_id) || !sha(item.descriptor_hash)) throw Error("invalid_reply");
      return { plan_id: item.plan_id, descriptor_hash: item.descriptor_hash };
    });
  }
  return binding;
}

/** A forrás tervét kötjük a válaszhoz; nem találunk ki választ vagy kockázatot. */
export function projectDecision(value: unknown, now = Date.now()): GgDecisionDetail {
  const item = object(value);
  if (!text(item.text) || !text(item.question_key) || !Array.isArray(item.authorizations)) throw Error("invalid_decision");
  const binding = readBinding({ decision_id: item.id, task_id: item.task_id, expected_epoch: item.epoch, expected_source_revision: item.source_revision });
  const authorizations = item.authorizations.map(object);
  const plans = authorizations.map(plan => {
    const descriptor = object(plan.descriptor);
    if (!uuid(plan.id) || !sha(plan.descriptor_hash) || !text(descriptor.operation_name) || !text(plan.expires_at) || !Number.isFinite(Date.parse(String(plan.expires_at)))) throw Error("invalid_decision");
    const resources = object(descriptor.scope).resource_ids;
    return { id: plan.id, operation: String(descriptor.operation_name), expires_at: String(plan.expires_at),
      resources: Array.isArray(resources) ? resources.filter((entry): entry is string => typeof entry === "string") : [],
      cost_limit: typeof descriptor.cost_limit_units === "number" ? descriptor.cost_limit_units : null, currency: text(descriptor.currency) };
  });
  const refs = new Map<string, GgPrRef>();
  for (const plan of authorizations) {
    const descriptor = object(plan.descriptor);
    for (const raw of [object(descriptor.arguments).pr_refs, object(descriptor.preconditions).pr_refs]) {
      if (raw === undefined) continue;
      for (const ref of prRefs(raw)) {
        const key = ref.url.toLowerCase(), previous = refs.get(key);
        if (previous && previous.head_sha.toLowerCase() !== ref.head_sha.toLowerCase()) throw Error("invalid_decision");
        refs.set(key, ref);
      }
    }
  }
  if (refs.size) binding.expected_pr_refs = [...refs.values()];
  if (plans.length && !plans.every(plan => plan.operation.startsWith("task.review."))) {
    binding.expected_plan_hashes = authorizations.map(plan => ({ plan_id: String(plan.id), descriptor_hash: String(plan.descriptor_hash) }));
  }
  const proposal = object(item.proposal), risk = object(item.proposal_risk);
  return { binding, story: text(item.story_identifier), question_key: String(item.question_key), text: String(item.text), state: String(item.state),
    response_type: String(item.response_type), proposal: text(proposal.label) ?? text(item.proposal), rationale: text(proposal.rationale),
    risk: Number.isInteger(risk.score) && Number(risk.score) >= 1 && Number(risk.score) <= 5 ? { score: Number(risk.score), explanation: text(risk.explanation) ?? "" } : null,
    choices: (Array.isArray(item.choices) ? item.choices : []).flatMap(choice => {
      if (typeof choice === "string") return [{ label: choice, value: choice }];
      const row = object(choice);
      return text(row.label) && ["string", "number", "boolean"].includes(typeof row.value) ? [{ label: String(row.label), value: String(row.value) }] : [];
    }), plans, blocked_reason: item.state !== "pending" ? "decision_closed" : plans.some(plan => Date.parse(plan.expires_at) <= now) ? "expired_plan" : null };
}

export class GgDecisionService {
  constructor(private call: GgToolCall = callGgTool) {}
  async detail(id: string, story: string): Promise<GgDecisionDetail> {
    if (!uuid(id) || !/^[A-Z][A-Z0-9]*-\d+$/.test(story)) throw Error("invalid_decision");
    // A story szűk listája csak megnyitáskor kell, nem kerül a rendszeres pollingba.
    for (let offset = 0; offset < 1000; offset += 50) {
      const page = object(await this.call("autoagent_decisions", { version: 3, story, limit: 50, offset }));
      if (!Array.isArray(page.items) || !Number.isInteger(page.total) || Number(page.total) < 0) throw Error("invalid_decision");
      const item = page.items.map(object).find(row => row.id === id);
      if (item) {
        if (item.story_identifier !== story) throw Error("invalid_decision");
        return projectDecision(item);
      }
      if (offset + page.items.length >= Number(page.total)) throw Error("decision_not_found");
      if (page.items.length < 50) throw Error("invalid_decision");
    }
    throw Error("decision_list_too_large");
  }
  async reply(input: unknown): Promise<GgDecisionReceipt> {
    const body = object(input), binding = readBinding(body.binding), raw = body.raw_text;
    if (!uuid(body.request_key) || typeof raw !== "string" || !raw.trim() || [...raw].length > 16000) throw Error("invalid_reply");
    const result = object(await this.call("autoagent_task_action", { action: { ...binding, operation: "session_reply", request_key: body.request_key,
      raw_text: raw, answer_text: raw, origin: { kind: "native_ui", message_ref: body.request_key } } }));
    if (result.version !== 3 || result.operation !== "session_reply" || result.state !== "recorded" || result.delivery !== "direct"
      || result.decision_id !== binding.decision_id || result.task_id !== binding.task_id || result.request_key !== body.request_key
      || !uuid(result.response_id) || result.raw_text_sha256 !== hash(raw) || result.answer_text_sha256 !== hash(raw)
      || !["answered", "ambiguous"].includes(String(result.answer_processing))) throw Error("reply_unconfirmed");
    return { decision_id: binding.decision_id, response_id: result.response_id, answer_processing: result.answer_processing as GgDecisionReceipt["answer_processing"] };
  }
}

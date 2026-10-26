/** Az Áttekintés ugyanahhoz a core-döntéshez kötött olvasó- és válaszadata. */
export interface GgPrRef { repository: string; url: string; head_sha: string }
export interface GgDecisionBinding {
  decision_id: string;
  task_id: string;
  expected_epoch: number;
  expected_source_revision: string;
  expected_pr_refs?: GgPrRef[];
  expected_plan_hashes?: { plan_id: string; descriptor_hash: string }[];
}
export interface GgDecisionDetail {
  binding: GgDecisionBinding;
  story: string | null;
  question_key: string;
  text: string;
  state: string;
  response_type: string;
  choices: { label: string; value: string }[];
  proposal: string | null;
  rationale: string | null;
  risk: { score: number; explanation: string } | null;
  plans: { id: string; operation: string; expires_at: string; resources: string[]; cost_limit: number | null; currency: string | null }[];
  blocked_reason: "expired_plan" | "decision_closed" | null;
}
export interface GgDecisionReply { binding: GgDecisionBinding; request_key: string; raw_text: string }
export interface GgDecisionReceipt { decision_id: string; response_id: string; answer_processing: "answered" | "ambiguous" }
export interface GgDiscussionReceipt { pane_id: string; agent_started: boolean; queued: boolean; error?: string }

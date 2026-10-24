/** Saját GG-kiegészítés: GET /api/gg/overview, hitelesített interaktív kliensnek. */
export interface GgTask {
  id: string;
  title: string;
  state: string;
  story: string | null;
  url: string | null;
  repositories: string[];
  reason: string | null;
  updated_at: string | null;
  priority?: number | null;
  priority_source_updated_at?: string | null;
  priority_needs_review?: boolean;
  priority_sync_pending?: boolean;
  snoozed_until?: string | null;
}
export interface GgDecision {
  id: string;
  task_id: string;
  text: string;
  proposal: string | null;
  url: string | null;
}
export interface GgRepository { repository: string; label: string; path: string | null }
export interface GgOverview {
  /** A nyitott helyi cwd-k mért git-common-dir szerinti fő checkoutja. */
  roots?: Record<string, string>;
  tasks: GgTask[];
  decisions: GgDecision[];
  repositories: GgRepository[];
  source: { observed_at: string | null; error: string | null };
}

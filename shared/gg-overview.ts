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
  /** a forrás proposal_risk mezője; hibás vagy hiányzó érték esetén null */
  risk?: { score: number; explanation: string } | null;
  /** a döntés taskjának storyja */
  story?: string | null;
}
/** A core v3 felmérés felületi vetülete; a brief, a checkpoint és a nyers bizonyíték nem jön át. */
export interface GgAssessmentContextSection { label: string; items: string[] }
export interface GgAssessment {
  // előkészítési osztály (clarification, prepared, completion_candidate…); döntés felmérésénél null
  preparation: string | null;
  freshness: "current" | "stale";
  assessed_at: string | null;
  risk: { score: number; explanation: string } | null;
  summary: string;
  recommendation: string;
  rationale: string;
  missing_information: string[];
  // opcionális bővítések a döntési kártyához (3. fázistól)
  goal?: string;
  situation?: string;
  question?: string;
  after_yes?: string;
  if_no?: string;
  context?: GgAssessmentContextSection[];
}
/** A gg-mb óránkénti forrás-ellenőrzése (intake): brief-változás taskonként, forrás-parkolás storynként. */
export interface GgSourceChecks {
  brief_changed: Record<string, { changed_at: string | null }>;
  parked: Record<string, { reason: string; blockers: { identifier: string; title: string | null }[] }>;
}
/** megőrzött (elavult briefre adott) válasz */
export interface GgPreservedAnswer { raw_text: string; recorded_at: string | null }
export interface GgAssessmentFeed {
  /** null: az intake most nem friss vagy nem olvasható, ilyenkor nem jelölünk */
  source_checks?: GgSourceChecks | null;
  /** döntés-azonosító → megőrzött válaszok */
  preserved?: Record<string, GgPreservedAnswer[]>;
  tasks: Record<string, GgAssessment>;
  decisions: Record<string, GgAssessment>;
  /** story-azonosító → story-cím */
  stories: Record<string, string>;
  observed_at: string | null;
  error: string | null;
}
export interface GgRepository { repository: string; label: string; path: string | null }
export interface GgOverview {
  /** A nyitott helyi cwd-k mért git-common-dir szerinti fő checkoutja. */
  roots?: Record<string, string>;
  tasks: GgTask[];
  decisions: GgDecision[];
  repositories: GgRepository[];
  assessments?: GgAssessmentFeed;
  source: { observed_at: string | null; error: string | null };
}

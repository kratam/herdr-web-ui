import { useRef, useState } from "react";
import type { GgAssessment, GgDecision } from "../../shared/gg-overview.ts";
import type { GgDecisionDetail, GgDecisionReply } from "../../shared/gg-decisions.ts";
import type { DecisionPackage } from "../lib/ggAttentionBoard.ts";
import { decisionRequestKey, ggDecisionApi } from "../lib/ggDecisions.ts";

export const riskMark = (score: number) => score >= 4 ? "🟢" : score === 3 ? "🟡" : "🔴";
const discussionErrors: Record<string, string> = {
  discussion_start_unconfirmed: "A tab megnyílt, az agent indulását ellenőrizni kell. Nyisd meg a meglévő tabot.",
  discussion_delivery_unconfirmed: "Az üzenet átadása nem igazolt. A meglévő beszélgetést nyisd meg; nem küldjük újra.",
  discussion_message_held: "A kérdés a tabon küldésre vár. Nyisd meg, és küldd el az ott látható üzenetet.",
  discussion_queue_full: "A beszélgetésben még egy korábbi üzenet vár. Nyisd meg, és rendezd azt; utána ezt a kérdést is átadhatod.",
};
const answerChoices = (detail: GgDecisionDetail) => detail.response_type === "boolean" ? [{ label: "Igen", value: "Igen" }, { label: "Nem", value: "Nem" }] : detail.choices;
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("hu-HU") : null;

/** A lenyitható háttér: amit a felmérés tud, kitalált tartalom nélkül. */
export function AssessmentBackground({ assessment }: { assessment: GgAssessment }) {
  const sections = [
    ...(assessment.goal ? [{ label: "Miért csináljuk", items: [assessment.goal] }] : []),
    ...(assessment.context ?? []),
    // az indok gyakran csak az összefoglaló és a javaslat összefűzése; ilyenkor nem ismételjük
    ...(assessment.rationale.includes(assessment.summary) || assessment.rationale.includes(assessment.recommendation) ? [] : [{ label: "Indok", items: [assessment.rationale] }]),
    ...(assessment.if_no ? [{ label: "Ha nemet mondasz", items: [assessment.if_no] }] : []),
    ...(assessment.missing_information.length ? [{ label: "Hiányzó információ", items: assessment.missing_information }] : []),
  ];
  return <div className="gg-background">{sections.map(section => <div key={section.label}><h4>{section.label}</h4><ul>{section.items.map((item, index) => <li key={index}>{item}</li>)}</ul></div>)}</div>;
}

interface Props {
  pack: DecisionPackage;
  unavailable: boolean;
  connection(): Promise<string>;
  openPane(pane: string, started: boolean): void;
  saved(): Promise<void>;
}

/** Egy story döntései egy kártyán: előbb a tartalom (helyzet, kérdés, javaslat, kockázat), utána a válasz. */
export function GgDecisionPackage({ pack, unavailable, connection, openPane, saved }: Props) {
  const risk = pack.risk;
  const taskCount = pack.tasks.length;
  return <article className="gg-package" aria-label={(pack.story ?? "Döntés") + " · " + pack.title}>
    <header className="gg-package-head">
      <div><small>{pack.story ?? "Ismeretlen story"}{taskCount > 1 ? " · " + taskCount + " task" : ""}</small><h3>{pack.title}</h3></div>
      {risk && <span className={"gg-risk gg-risk--" + (risk.score >= 4 ? "low" : risk.score === 3 ? "mid" : "high")}>{riskMark(risk.score)} {risk.score}</span>}
    </header>
    {pack.decisions.map(decision => <DecisionBody key={decision.id} decision={decision} story={pack.story} assessment={pack.assessments[decision.id] ?? null} unavailable={unavailable} connection={connection} openPane={openPane} saved={saved} />)}
  </article>;
}

function DecisionBody({ decision, story, assessment, unavailable, connection, openPane, saved }: Omit<Props, "pack"> & { decision: GgDecision; story: string | null; assessment: GgAssessment | null }) {
  const [detail, setDetail] = useState<GgDecisionDetail | null>(null);
  const [raw, setRaw] = useState(""), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const [status, setStatus] = useState(""), [pane, setPane] = useState<{ id: string; started: boolean } | null>(null);
  const [mode, setMode] = useState<"accept" | "other">("accept");
  const inFlight = useRef(false), intent = useRef<GgDecisionReply | null>(null);
  const risk = decision.risk ?? assessment?.risk ?? null;
  const proposal = assessment?.recommendation ?? decision.proposal;
  const situation = assessment?.situation ?? assessment?.summary ?? null;
  // a válaszhoz mindig a forrás friss kötése kell; az űrlap csak ennek beolvasása után nyílik
  const open = async (mode: "accept" | "other") => {
    if (!story || inFlight.current) return;
    inFlight.current = true; setBusy("read"); setError("");
    try {
      const loaded = await ggDecisionApi.detail(decision.id, story);
      setDetail(loaded);
      // elfogadásnál igen-nem kérdésre „Igen”, egyébként a forrás javaslata kerül a válaszba; rögzíteni külön kell
      const suggested = loaded.response_type === "boolean" ? "Igen" : loaded.proposal ?? proposal ?? "";
      // ha a javaslat egy felkínált lehetőség, azt jelöljük ki
      const choice = answerChoices(loaded).find(item => item.label === suggested || item.value === suggested);
      setMode(mode); setRaw(mode === "other" ? "" : choice?.value ?? suggested);
    }
    catch (error) { setError(error instanceof Error ? error.message : "A döntés nem olvasható."); }
    finally { inFlight.current = false; setBusy(null); }
  };
  const send = async () => {
    if (!detail || detail.blocked_reason || inFlight.current || !raw.trim()) return;
    inFlight.current = true; setBusy("reply"); setError(""); setStatus("");
    const signature = JSON.stringify(detail.binding);
    if (!intent.current || intent.current.raw_text !== raw || JSON.stringify(intent.current.binding) !== signature) intent.current = { binding: detail.binding, request_key: decisionRequestKey(), raw_text: raw };
    try {
      const receipt = await ggDecisionApi.reply(intent.current);
      if (receipt.answer_processing === "ambiguous") setStatus("A válasz megérkezett, de pontosítás kell; a döntés még nyitott. Fogalmazd át, vagy beszéljük át agenttel.");
      else { setStatus("A válasz rögzítve."); await saved(); }
    } catch (error) { setError(error instanceof Error ? error.message : "A mentés nem igazolt."); }
    finally { inFlight.current = false; setBusy(null); }
  };
  const discuss = async () => {
    if (!story || inFlight.current) return;
    inFlight.current = true; setBusy("discuss"); setError("");
    try {
      const client = await connection();
      const result = await ggDecisionApi.discuss(decision.id, story, client);
      if (result.queued) openPane(result.pane_id, result.agent_started);
      else { setPane({ id: result.pane_id, started: result.agent_started }); setError(discussionErrors[result.error ?? ""] ?? "A meglévő tabot ellenőrizni kell."); }
    } catch (error) { setError(error instanceof Error ? error.message : "A tab megnyitása nem igazolt."); }
    finally { inFlight.current = false; setBusy(null); }
  };
  const disabled = unavailable || Boolean(busy) || !story;
  return <div className="gg-package-body">
    {situation && <p className="gg-package-situation">{situation}</p>}
    <p className="gg-package-question">{detail?.text ?? decision.text}</p>
    <div className="gg-package-facts">
      {proposal && <div><h4>Javaslat</h4><p>{proposal}</p></div>}
      <div><h4>Kockázat</h4><p>{risk ? riskMark(risk.score) + " " + risk.score + (risk.explanation ? " · " + risk.explanation : "") : "Nincs megadva."}</p></div>
      {assessment?.after_yes && <div><h4>Ha igent mondasz</h4><p>{assessment.after_yes}</p></div>}
    </div>
    {assessment && <details className="gg-package-more"><summary>Bővebb háttér</summary><AssessmentBackground assessment={assessment} /></details>}
    <footer className="gg-package-foot">
      <small>{assessment ? (assessment.freshness === "stale" ? "Elavult előkészítés: " : "Előkészítve: ") + (day(assessment.assessed_at) ?? "ismeretlen időpont") : "A kérdés saját javaslata; bővebb agent-előkészítés még nincs"}</small>
      <div className="gg-decision-actions">
        <button className="btn" disabled={disabled || !proposal} onClick={() => void open("accept")}>{busy === "read" ? "Betöltés…" : "Elfogadom a javaslatot"}</button>
        <button className="btn btn-ghost" disabled={disabled} onClick={() => void open("other")}>Mást mondok</button>
        <button className="btn btn-ghost" disabled={disabled} onClick={() => void discuss()}>{busy === "discuss" ? "Beszélgetés megnyitása…" : "Beszéljük át"}</button>
      </div>
    </footer>
    {detail && <form className="gg-decision-form" aria-label={mode === "accept" ? "A javaslat elfogadása" : "Saját válasz"} onSubmit={event => { event.preventDefault(); void send(); }}>
      <h4>{mode === "accept" ? "A javaslat elfogadása: ellenőrizd, majd rögzítsd" : "Saját válasz"}</h4>
      {detail.blocked_reason && <p className="gg-overview-warning">{detail.blocked_reason === "expired_plan" ? "A terv lejárt. A folytatást a Beszéljük át gombbal rendezhetjük." : "Ez a döntés már lezárult. Frissítsd az áttekintőt."}</p>}
      {(detail.plans.length > 0 || detail.binding.expected_pr_refs?.length) ? <details><summary>Mire vonatkozik a döntés?</summary><div className="gg-overview-details">{detail.binding.expected_pr_refs?.map(ref => <p key={ref.url}><a href={ref.url} target="_blank" rel="noreferrer">{ref.repository} PR</a><br /><code>{ref.head_sha}</code></p>)}{detail.plans.map(plan => <PlanDetails key={plan.id} plan={plan} />)}</div></details> : null}
      {answerChoices(detail).length > 0 && <div className="gg-decision-actions" role="group" aria-label="Válaszlehetőségek">{answerChoices(detail).map(choice => <button type="button" className="btn btn-ghost gg-choice" aria-pressed={raw === choice.value} key={choice.value} disabled={disabled || Boolean(detail.blocked_reason)} onClick={() => setRaw(choice.value)}>{choice.label}</button>)}</div>}
      <label htmlFor={"answer-" + decision.id}>Válaszod</label><textarea id={"answer-" + decision.id} value={raw} maxLength={16000} rows={3} disabled={Boolean(busy)} onChange={event => setRaw(event.target.value)} placeholder="Saját szavaiddal is válaszolhatsz." />
      <div className="gg-decision-actions"><button className="btn" type="submit" disabled={disabled || Boolean(detail.blocked_reason) || !raw.trim()}>{busy === "reply" ? "Mentés…" : "Válasz rögzítése"}</button><button className="btn btn-ghost" type="button" disabled={Boolean(busy)} onClick={() => { setDetail(null); setRaw(""); intent.current = null; }}>Mégse</button></div>
    </form>}
    {status && <p className="gg-overview-warning" role="status">{status}</p>}
    {error && <p className="gg-overview-warning" role="alert">{error}{pane && <><br /><button className="gg-overview-link" onClick={() => openPane(pane.id, pane.started)}>Döntések átbeszélése · Tab megnyitása</button></>}</p>}
  </div>;
}

function PlanDetails({ plan }: { plan: GgDecisionDetail["plans"][number] }) {
  const scope = plan.descriptor.scope && typeof plan.descriptor.scope === "object" ? plan.descriptor.scope as Record<string, unknown> : {};
  return <div className="gg-decision-plan"><p>{plan.operation}<br />Rendszer: {String(scope.system ?? "nincs megadva")} · Környezet: {String(scope.environment ?? "nincs megadva")}<br />Lejár: {new Date(plan.expires_at).toLocaleString("hu-HU")}<br />Érintett: {plan.resources.join(", ")}<br />Felhasználható: {String(plan.descriptor.max_uses ?? "nincs megadva")} alkalommal<br />Költséglimit: {plan.cost_limit ?? "nincs megadva"} {plan.currency}</p>
    <details><summary>A teljes művelet, paraméterek és feltételek</summary><pre>{JSON.stringify(plan.descriptor, null, 2)}</pre></details></div>;
}

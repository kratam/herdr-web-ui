import { useRef, useState } from "react";
import type { GgDecision, GgTask } from "../../shared/gg-overview.ts";
import type { GgDecisionDetail, GgDecisionReply } from "../../shared/gg-decisions.ts";
import { decisionConnection, decisionRequestKey, ggDecisionApi } from "../lib/ggDecisions.ts";
import { useMachineSessions } from "../lib/machineSessionContext.tsx";

interface Props {
  decisions: GgDecision[];
  tasks: GgTask[];
  unavailable: boolean;
  refresh(): Promise<void>;
  openPane(paneId: string, started: boolean): void;
}
const risk = (score: number) => score >= 4 ? "🟢" : score === 3 ? "🟡" : "🔴";
const discussionErrors: Record<string, string> = {
  discussion_start_unconfirmed: "A tab megnyílt, az agent indulását ellenőrizni kell. Nyisd meg a meglévő tabot.",
  discussion_delivery_unconfirmed: "Az üzenet átadása nem igazolt. A meglévő beszélgetést nyisd meg; nem küldjük újra.",
  discussion_message_held: "A kérdés a tabon küldésre vár. Nyisd meg, és küldd el az ott látható üzenetet.",
  discussion_queue_full: "A beszélgetésben még egy korábbi üzenet vár. Nyisd meg, és rendezd azt; utána ezt a kérdést is átadhatod.",
};

/** A két művelet ugyanarra a döntésre mutat; az átbeszélés az Ovis saját agentnézetét nyitja. */
export function GgDecisions({ decisions, tasks, unavailable, refresh, openPane }: Props) {
  const sessions = useMachineSessions();
  const [notice, setNotice] = useState("");
  return <section className="gg-overview-section gg-decisions" aria-label="Tőlem döntés kell">
    <h2>Tőlem döntés kell <span className="gg-section-count">{decisions.length}</span></h2>
    <p className="gg-section-hint">Az autonóm sor kérdéseire itt válaszolhatsz. Ha pontosítani szeretnél, a Beszéljük át ugyanabba az agentes beszélgetésbe visz.</p>
    {notice && <p className="gg-overview-warning" role="status">{notice}</p>}
    {decisions.map(decision => <DecisionCard key={decision.id} decision={decision} task={tasks.find(task => task.id === decision.task_id)} unavailable={unavailable}
      connection={() => decisionConnection(sessions)} openPane={openPane} saved={async () => { setNotice("A válasz rögzítve. A feladatsor frissül."); await refresh(); }} />)}
    {!decisions.length && <p className="gg-overview-empty">{unavailable ? "A döntési sor állapota most nem ismert." : "Nincs nyitott döntés az autonóm sorban."}</p>}
  </section>;
}

function DecisionCard({ decision, task, unavailable, connection, openPane, saved }: {
  decision: GgDecision; task?: GgTask; unavailable: boolean;
  connection(): Promise<string>; openPane(pane: string, started: boolean): void; saved(): Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false), [detail, setDetail] = useState<GgDecisionDetail | null>(null);
  const [raw, setRaw] = useState(""), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const [status, setStatus] = useState(""), [pane, setPane] = useState<{ id: string; started: boolean } | null>(null);
  const inFlight = useRef(false), intent = useRef<GgDecisionReply | null>(null);
  const story = task?.story;
  const read = async () => {
    if (!story || inFlight.current) return;
    inFlight.current = true; setExpanded(true); setBusy("read"); setError("");
    try { setDetail(await ggDecisionApi.detail(decision.id, story)); }
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
  return <article className="gg-decision" aria-label={(story ?? "Döntés") + " · " + decision.text}>
    <small>{story ?? "Ismeretlen story"}{task ? " · " + task.title : ""}</small>
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>{detail?.text ?? decision.text}</summary>
      <div className="gg-overview-details">{!detail && decision.proposal && <p>{decision.proposal}</p>}{task?.url && <a href={task.url} target="_blank" rel="noreferrer">Kapcsolódó feladat</a>}</div>
    </details>
    <div className="gg-decision-actions"><button className="btn" disabled={disabled} onClick={() => void read()}>{busy === "read" ? "Betöltés…" : detail ? "Kérdés újraolvasása" : "Válaszolok"}</button><button className="btn btn-ghost" disabled={disabled} onClick={() => void discuss()}>{busy === "discuss" ? "Beszélgetés megnyitása…" : "Beszéljük át"}</button></div>
    {detail && <form className="gg-decision-form" onSubmit={event => { event.preventDefault(); void send(); }}>
      {detail.risk && <p>{risk(detail.risk.score)}{detail.risk.score} · {detail.risk.explanation}</p>}
      {detail.proposal && <p><strong>Javaslat:</strong> {detail.proposal}{detail.rationale ? " — " + detail.rationale : ""}</p>}
      {(detail.plans.length > 0 || detail.binding.expected_pr_refs?.length) ? <details><summary>Mire vonatkozik a döntés?</summary><div className="gg-overview-details">{detail.binding.expected_pr_refs?.map(ref => <p key={ref.url}><a href={ref.url} target="_blank" rel="noreferrer">{ref.repository} PR</a><br /><code>{ref.head_sha}</code></p>)}{detail.plans.map(plan => <PlanDetails key={plan.id} plan={plan} />)}</div></details> : null}
      {detail.blocked_reason && <p className="gg-overview-warning">{detail.blocked_reason === "expired_plan" ? "A terv lejárt. A folytatást a Beszéljük át gombbal rendezhetjük." : "Ez a döntés már lezárult. Frissítsd az áttekintőt."}</p>}
      <div className="gg-decision-actions" role="group" aria-label="Válaszlehetőségek">{(detail.response_type === "boolean" ? [{ label: "Igen", value: "Igen" }, { label: "Nem", value: "Nem" }] : detail.choices).map(choice => <button type="button" className="btn btn-ghost" key={choice.value} disabled={disabled || Boolean(detail.blocked_reason)} onClick={() => setRaw(choice.value)}>{choice.label}</button>)}</div>
      <label htmlFor={"answer-" + decision.id}>Válaszod</label><textarea id={"answer-" + decision.id} value={raw} maxLength={16000} rows={3} disabled={Boolean(busy)} onChange={event => setRaw(event.target.value)} placeholder="Saját szavaiddal is válaszolhatsz." />
      <button className="btn" type="submit" disabled={disabled || Boolean(detail.blocked_reason) || !raw.trim()}>{busy === "reply" ? "Mentés…" : "Válasz rögzítése"}</button>
    </form>}
    {status && <p className="gg-overview-warning" role="status">{status}</p>}
    {error && <p className="gg-overview-warning" role="alert">{error}{pane && <><br /><button className="gg-overview-link" onClick={() => openPane(pane.id, pane.started)}>Döntések átbeszélése · Tab megnyitása</button></>}</p>}
  </article>;
}

function PlanDetails({ plan }: { plan: GgDecisionDetail["plans"][number] }) {
  const scope = plan.descriptor.scope && typeof plan.descriptor.scope === "object" ? plan.descriptor.scope as Record<string, unknown> : {};
  return <div className="gg-decision-plan"><p>{plan.operation}<br />Rendszer: {String(scope.system ?? "nincs megadva")} · Környezet: {String(scope.environment ?? "nincs megadva")}<br />Lejár: {new Date(plan.expires_at).toLocaleString("hu-HU")}<br />Érintett: {plan.resources.join(", ")}<br />Felhasználható: {String(plan.descriptor.max_uses ?? "nincs megadva")} alkalommal<br />Költséglimit: {plan.cost_limit ?? "nincs megadva"} {plan.currency}</p>
    <details><summary>A teljes művelet, paraméterek és feltételek</summary><pre>{JSON.stringify(plan.descriptor, null, 2)}</pre></details></div>;
}

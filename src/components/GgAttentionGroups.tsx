import { useState } from "react";
import type { AttentionBoard, StoryRow } from "../lib/ggAttentionBoard.ts";
import { GG_PRIORITIES } from "../lib/ggTaskAttention.ts";
import { AssessmentBackground, riskMark } from "./GgDecisionPackage.tsx";

const SOON_PREVIEW = 10;

/** Egy story-sor: mi ez, mi a következő lépés, és ha van előkészítés, annak rövid tartalma. */
function Row({ row, showNext = true }: { row: StoryRow; showNext?: boolean }) {
  const url = row.tasks.find(task => task.url)?.url ?? null;
  const assessment = row.assessment;
  const priority = Math.min(...row.tasks.map(task => task.priority || 5));
  return <li className="gg-row">
    <div className="gg-row-main">
      <span className="gg-row-title">{row.story && <small>{row.story}</small>}{url ? <a href={url} target="_blank" rel="noreferrer">{row.title}</a> : row.title}</span>
      {showNext && <span className="gg-row-next">{row.next}</span>}
      {(row.meta || priority <= 2) && <small>{[priority <= 2 ? "P" + priority + " · " + GG_PRIORITIES[priority] : "", row.meta].filter(Boolean).join(" · ")}</small>}
    </div>
    {assessment && <details className="gg-row-more"><summary>{assessment.risk ? riskMark(assessment.risk.score) + "\u00a0" : ""}{assessment.summary}</summary>
      <p><strong>Javaslat:</strong> {assessment.recommendation}</p><AssessmentBackground assessment={assessment} /></details>}
  </li>;
}

const oldest = (rows: StoryRow[]) => Math.max(0, ...rows.map(row => row.age_days ?? 0));
function Group({ name, summary, rows, className, open, limit, showNext }: { name: string; summary: string; rows: StoryRow[]; className?: string; open?: boolean; limit?: number; showNext?: boolean }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = limit && !all ? rows.slice(0, limit) : rows;
  return <details className={"gg-group " + (className ?? "")} open={open}>
    <summary><span className="gg-group-name">{name} <span className="gg-section-count">{rows.length}</span></span><small>{summary}</small></summary>
    <ul className="gg-rows">{shown.map(row => <Row key={(row.story ?? "") + ":" + row.tasks[0]!.id} row={row} showNext={showNext} />)}</ul>
    {shown.length < rows.length && <button type="button" className="btn btn-ghost gg-group-more" onClick={() => setAll(true)}>Továbbiak ({rows.length - shown.length})</button>}
  </details>;
}

/** A döntések alatti elakadt és „hamarosan” sáv, majd a „most nincs vele teendőd” csoportok. */
export function GgAttentionGroups({ board }: { board: AttentionBoard }) {
  const quiet = board.parked.length + board.cleanup.length + board.running.length;
  return <>
    <Group className="gg-group--stuck" open name="Elakadt, figyelmet kér" summary="hibás munka, sürgősség szerint" rows={board.stuck} />
    <Group className="gg-group--soon" name="Hamarosan hozzád kerül" summary={"az agent előkészíti · prioritás szerint · legrégebbi: " + oldest(board.soon) + " napja"} rows={board.soon} limit={SOON_PREVIEW} showNext={false} />
    {quiet > 0 && <section className="gg-overview-section gg-quiet" aria-label="Most nincs vele teendőd">
      <h2>Most nincs vele teendőd <span className="gg-section-count">{quiet}</span></h2>
      <Group name="Parkolt" summary="feltételhez kötve" rows={board.parked} />
      <Group name="Rendezendő, valószínűleg kész" summary="gazda: agent" rows={board.cleanup} />
      <Group name="Folyamatban" summary="fut, sorra vár vagy review-ban van" rows={board.running} />
    </section>}
  </>;
}

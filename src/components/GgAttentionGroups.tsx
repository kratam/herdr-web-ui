import type { AttentionBoard, StoryRow } from "../lib/ggAttentionBoard.ts";
import { AssessmentBackground, riskMark } from "./GgDecisionPackage.tsx";

/** Egy story-sor: mi ez, mi a következő lépés, és ha van előkészítés, annak rövid tartalma. */
function Row({ row }: { row: StoryRow }) {
  const url = row.tasks.find(task => task.url)?.url ?? null;
  const assessment = row.assessment;
  return <li className="gg-row">
    <div className="gg-row-main">
      <span className="gg-row-title">{row.story && <small>{row.story}</small>}{url ? <a href={url} target="_blank" rel="noreferrer">{row.title}</a> : row.title}</span>
      <span className="gg-row-next">Következő: {row.next}</span>
      {row.meta && <small>{row.meta}</small>}
    </div>
    {assessment && <details className="gg-row-more"><summary>{assessment.risk ? riskMark(assessment.risk.score) + " " : ""}{assessment.summary}</summary>
      <p><strong>Javaslat:</strong> {assessment.recommendation}</p><AssessmentBackground assessment={assessment} /></details>}
  </li>;
}

const oldest = (rows: StoryRow[]) => Math.max(0, ...rows.map(row => row.age_days ?? 0));
function Group({ name, summary, rows, className }: { name: string; summary: string; rows: StoryRow[]; className?: string }) {
  if (!rows.length) return null;
  return <details className={"gg-group " + (className ?? "")}>
    <summary><span className="gg-group-name">{name} <span className="gg-section-count">{rows.length}</span></span><small>{summary}</small></summary>
    <ul className="gg-rows">{rows.map(row => <Row key={(row.story ?? "") + ":" + row.tasks[0]!.id} row={row} />)}</ul>
  </details>;
}

/** A döntések alatti „hamarosan” sor és a „most nincs vele teendőd” csoportok. */
export function GgAttentionGroups({ board }: { board: AttentionBoard }) {
  const quiet = board.parked.length + board.cleanup.length + board.running.length;
  return <>
    <Group className="gg-group--soon" name="Hamarosan hozzád kerül" summary={"az agent előkészíti · legrégebbi: " + oldest(board.soon) + " napja"} rows={board.soon} />
    {quiet > 0 && <section className="gg-overview-section gg-quiet" aria-label="Most nincs vele teendőd">
      <h2>Most nincs vele teendőd <span className="gg-section-count">{quiet}</span></h2>
      <Group name="Parkolt" summary="feltételhez kötve" rows={board.parked} />
      <Group name="Rendezendő, valószínűleg kész" summary="gazda: agent" rows={board.cleanup} />
      <Group name="Folyamatban vagy elakadt" summary={board.running.filter(row => row.next.startsWith("hibás")).length + " hibás"} rows={board.running} />
    </section>}
  </>;
}

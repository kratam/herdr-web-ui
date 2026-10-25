import { useEffect, useId, useRef, useState } from "react";
import type { Machine } from "../../shared/machines.ts";
import { apiFetch } from "../lib/api-request-id.ts";
import "./GgHostLoads.css";

interface HostRow { id: string; data: { cpus: number; load: number[]; observed_at: string } | null; error: string | null }
/** Percenként látható lapon, gépenként szerveroldali közös méréssel. */
export function GgHostLoads({ machines }: { machines: Machine[] }) {
  const [rows, setRows] = useState<HostRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const detailId = useId();
  useEffect(() => {
    if (!selected) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setSelected(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [selected]);
  const key = machines.map(machine => machine.id + ":" + machine.state).join(",");
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const read = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const response = await apiFetch("/api/gg/host-loads", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
        if (!response.ok) throw Error("unavailable");
        const data = await response.json() as { hosts: HostRow[] };
        if (!controller.signal.aborted) { setRows(data.hosts); setFailed(false); }
      } catch { if (!controller.signal.aborted) setFailed(true); }
      finally { pending = false; }
    };
    void read();
    const timer = window.setInterval(() => void read(), 60_000);
    const visible = () => void read();
    document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [key]);
  const number = (n: number) => n.toLocaleString("hu-HU", { maximumFractionDigits: 1 });
  return <div className="gg-host-loads" ref={root} aria-label="Gépek terhelése" onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setSelected(null);
  }} onKeyDown={event => {
    if (event.key !== "Escape" || !selected) return;
    event.stopPropagation();
    root.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus();
    setSelected(null);
  }}><div className="gg-host-load-strip">{machines.map(machine => {
    const row = rows.find(item => item.id === machine.id);
    const data = row?.data;
    const stale = failed || Boolean(row?.error) || machine.state !== "connected" || Boolean(data && Date.now() - Date.parse(data.observed_at) > 120_000);
    const value = data ? number(data.load[0]!) + " / " + data.cpus : "—";
    const problem = stale ? " Régi vagy nem elérhető mérés. " + (row?.error ?? "") : "";
    const open = selected === machine.id;
    return <button type="button" key={machine.id} className={"gg-host-load-chip" + (stale ? " is-stale" : data && data.load[0]! > data.cpus ? " is-high" : "")} aria-label={machine.name + ": " + value + problem} title={machine.name + ": " + value + problem} aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => setSelected(open ? null : machine.id)}>{value}</button>;
  })}</div>{machines.map(machine => {
    if (selected !== machine.id) return null;
    const row = rows.find(item => item.id === machine.id);
    const data = row?.data;
    const stale = failed || Boolean(row?.error) || machine.state !== "connected" || Boolean(data && Date.now() - Date.parse(data.observed_at) > 120_000);
    return <div key={machine.id} id={detailId} className="gg-host-load-popover" role="dialog" aria-label={machine.name + " terhelése"}>
      <strong>{machine.name}</strong>
      {data ? <><p>Terhelési átlag (1 / 5 / 15 perc): {data.load.map(number).join(" / ")}</p><p>Logikai CPU: {data.cpus}. Ez nem CPU-százalék.</p><p>Mérve: {new Date(data.observed_at).toLocaleTimeString("hu-HU")}</p></> : <p>A terhelés még nem mérhető.</p>}
      {stale && <p role="status">Régi vagy nem elérhető mérés. {row?.error}</p>}
    </div>;
  })}</div>;
}

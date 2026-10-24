import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import type { Machine } from "../../shared/machines.ts";
import { apiFetch } from "../lib/api-request-id.ts";
import "./GgHostLoads.css";

interface HostRow { id: string; data: { cpus: number; load: number[]; observed_at: string } | null; error: string | null }
/** Percenként látható lapon, gépenként szerveroldali közös méréssel. */
export function GgHostLoads({ machines }: { machines: Machine[] }) {
  const [rows, setRows] = useState<HostRow[]>([]);
  const [failed, setFailed] = useState(false);
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
  return <div className="gg-host-loads" aria-label="Gépek terhelése"><div className="gg-host-loads-heading"><Activity aria-hidden="true" /><span>Host load · 1 perc</span></div>{machines.map(machine => {
    const row = rows.find(item => item.id === machine.id);
    const data = row?.data;
    const stale = failed || Boolean(row?.error) || machine.state !== "connected" || Boolean(data && Date.now() - Date.parse(data.observed_at) > 120_000);
    const hint = data ? "Load 1 / 5 / 15 perc: " + data.load.map(number).join(" / ") + ". Logikai CPU: " + data.cpus + ". Mérve: " + new Date(data.observed_at).toLocaleTimeString("hu-HU") + ". Ez nem CPU-százalék." : "A terhelés még nem mérhető.";
    return <div key={machine.id} className={"gg-host-load-row" + (stale ? " is-stale" : data && data.load[0]! > data.cpus ? " is-high" : "")} title={hint + (stale ? " Régi vagy nem elérhető mérés. " + (row?.error ?? "") : "")}><span>{machine.name}</span><span>{data ? number(data.load[0]!) + " / " + data.cpus : "—"}{stale && <small> · régi / nem elérhető</small>}</span></div>;
  })}</div>;
}

import { cpus, loadavg, platform } from "node:os";
import type { Machine } from "../shared/machines.ts";
import { jsonResponse } from "./http.ts";

export interface GgHostLoad { cpus: number; load: number[]; observed_at: string }
/** Rögzített, olvasó mérés a már hitelesített SSH-mesteren. Nincs kliensből érkező parancs. */
export const GG_HOST_LOAD_SCRIPT = `LC_ALL=C; export LC_ALL
case "$(uname -s)" in
  Linux) getconf _NPROCESSORS_ONLN; cut -d ' ' -f 1-3 /proc/loadavg ;;
  Darwin) sysctl -n hw.logicalcpu; sysctl -n vm.loadavg | tr -d '{}' ;;
  *) exit 1 ;;
esac`;
export function parseGgHostLoad(text: string, now = Date.now()): GgHostLoad {
  const values = text.trim().split(/\s+/).map(Number);
  const [count, ...load] = values;
  if (values.length !== 4 || !Number.isInteger(count) || count! < 1 || load.some(n => !Number.isFinite(n) || n < 0)) throw Error("invalid_host_load");
  return { cpus: count!, load, observed_at: new Date(now).toISOString() };
}
export class GgHostLoads {
  private cache = new Map<string, { until: number; data: GgHostLoad | null; error: string | null }>();
  private pending = new Map<string, Promise<{ data: GgHostLoad | null; error: string | null }>>();
  constructor(private remote: (id: string) => Promise<GgHostLoad>, private now = Date.now) {}
  private read(id: string): Promise<{ data: GgHostLoad | null; error: string | null }> {
    const cached = this.cache.get(id);
    if (cached && cached.until > this.now()) return Promise.resolve(cached);
    const pending = this.pending.get(id); if (pending) return pending;
    const request = (async () => {
      let result;
      try {
        if (id === "local" && platform() === "win32") throw Error("unsupported");
        const data = id === "local" ? { cpus: cpus().length, load: loadavg(), observed_at: new Date(this.now()).toISOString() } : await this.remote(id);
        result = { data, error: null };
      } catch { result = { data: cached?.data ?? null, error: "A terhelés most nem mérhető." }; }
      this.cache.set(id, { ...result, until: this.now() + 60_000 });
      return result;
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, request); return request;
  }
  async response(machines: Pick<Machine, "id" | "state">[]): Promise<Response> {
    const rows = await Promise.all(machines.map(async machine => ({ id: machine.id, ...(machine.state === "connected" ? await this.read(machine.id) : { data: this.cache.get(machine.id)?.data ?? null, error: "Nincs élő kapcsolat." }) })));
    return jsonResponse({ hosts: rows }, 200, { "cache-control": "no-store" });
  }
}

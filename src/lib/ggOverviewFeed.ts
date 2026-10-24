import type { GgOverview } from "../../shared/gg-overview.ts";
import { apiFetch } from "./api-request-id.ts";
interface FeedState { feed: GgOverview | null; error: string | null; loading: boolean }
const empty = (): FeedState => ({ feed: null, error: null, loading: false });

/** Lapélettartamú cache: tabváltáskor megmarad, kijelentkezéskor a függő olvasással együtt törlődik. */
export class GgOverviewFeed {
  private state = empty();
  private listeners = new Set<() => void>();
  private request: { controller: AbortController; done: Promise<void> } | null = null;
  private mutation: AbortController | null = null;
  private readAt: number | null = null;
  constructor(private load: (signal: AbortSignal) => Promise<GgOverview> = async signal => {
    const response = await apiFetch("/api/gg/overview", { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
    if (!response.ok) throw Error("unavailable");
    const data = await response.json() as GgOverview;
    if (!Array.isArray(data.tasks) || !Array.isArray(data.decisions) || !Array.isArray(data.repositories) || !data.source) throw Error("invalid_feed");
    return data;
  }, private now: () => number = Date.now, private save: (body: Record<string, unknown>, signal: AbortSignal) => Promise<GgOverview> = async (body, signal) => {
    const response = await apiFetch("/api/gg/work", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
    let result;
    try { result = await response.json(); }
    catch { throw Error("A mentés eredménye nem igazolt. Frissítsd a nézetet és ellenőrizd a Lineart az újrapróbálás előtt."); }
    if (!response.ok) throw Error(result.error?.message ?? "A mentés eredménye nem igazolt.");
    if (!Array.isArray(result.tasks) || !Array.isArray(result.decisions) || !Array.isArray(result.repositories) || !result.source) throw Error("A mentés válasza nem értelmezhető. Ellenőrizd az eredményt újrapróbálás előtt.");
    return result as GgOverview;
  }) {}
  read = (): FeedState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: FeedState): void { this.state = state; for (const listener of this.listeners) listener(); }
  clear(): void {
    this.mutation?.abort(); this.mutation = null;
    this.request?.controller.abort(); this.request = null; this.readAt = null; this.publish(empty());
  }
  /** A sikeres szerverválasz mindkét nézetet egyszerre frissíti. Nincs automatikus írás-újrapróbálás. */
  async change(body: Record<string, unknown>): Promise<void> {
    if (this.mutation) throw Error("Már folyamatban van egy mentés.");
    const controller = new AbortController();
    this.mutation = controller;
    this.request?.controller.abort(); this.request = null;
    try {
      const result = await this.save(body, controller.signal);
      if (!controller.signal.aborted) { this.readAt = this.now(); this.publish({ feed: result as GgOverview, error: null, loading: false }); }
    } catch (error) {
      if (!controller.signal.aborted) { this.readAt = null; this.mutation = null; await this.refresh(true); }
      throw error;
    } finally { if (this.mutation === controller) this.mutation = null; }
  }
  refresh(force = false): Promise<void> {
    if (this.mutation) return Promise.resolve();
    if (this.request) return this.request.done;
    if (!force && this.readAt !== null && this.now() - this.readAt < 30_000) return Promise.resolve();
    const controller = new AbortController();
    this.publish({ ...this.state, loading: true });
    const done = this.load(controller.signal).then(feed => {
      if (controller.signal.aborted) return;
      this.readAt = this.now();
      this.publish({ feed, error: null, loading: false });
    }).catch(() => {
      if (!controller.signal.aborted) this.publish({ ...this.state, loading: false, error: "A GG-feladatsor nem érhető el. Az utolsó ismert adatot és az élő agenteket mutatjuk." });
    }).finally(() => { if (this.request?.controller === controller) this.request = null; });
    this.request = { controller, done };
    return done;
  }
}

import type { GgOverview } from "../../shared/gg-overview.ts";
import { apiFetch } from "./api-request-id.ts";
interface FeedState { feed: GgOverview | null; error: string | null; loading: boolean }
const empty = (): FeedState => ({ feed: null, error: null, loading: false });

/** Lapélettartamú cache: tabváltáskor megmarad, kijelentkezéskor a függő olvasással együtt törlődik. */
export class GgOverviewFeed {
  private state = empty();
  private listeners = new Set<() => void>();
  private request: { controller: AbortController; done: Promise<void> } | null = null;
  private readAt: number | null = null;
  constructor(private load: (signal: AbortSignal) => Promise<GgOverview> = async signal => {
    const response = await apiFetch("/api/gg/overview", { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
    if (!response.ok) throw Error("unavailable");
    const data = await response.json() as GgOverview;
    if (!Array.isArray(data.tasks) || !Array.isArray(data.decisions) || !Array.isArray(data.repositories) || !data.source) throw Error("invalid_feed");
    return data;
  }, private now: () => number = Date.now) {}
  read = (): FeedState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: FeedState): void { this.state = state; for (const listener of this.listeners) listener(); }
  clear(): void {
    this.request?.controller.abort(); this.request = null; this.readAt = null; this.publish(empty());
  }
  refresh(force = false): Promise<void> {
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

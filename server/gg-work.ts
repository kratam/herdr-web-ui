import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { GgOverview, GgTask } from "../shared/gg-overview.ts";
import { GgAttentionStore } from "./gg-attention.ts";
import reviewCandidates from "./gg-priority-review.json";
import { jsonResponse } from "./http.ts";
import { readCappedJson } from "./remote-json.ts";

type PriorityResult = { priority: number; updated_at: string; conflict?: boolean };
type WritePriority = (story: string, expected: number, priority: number) => Promise<PriorityResult>;
/** Csak a fix writer kap proxyzott Linear-tokent; stdin a validált három mező. */
export const writeGgPriority: WritePriority = (story, expected, priority) => new Promise((resolve, reject) => {
  const writer = fileURLToPath(new URL("./gg-priority-writer.py", import.meta.url));
  const child = spawn("gg-mcp-proxy", ["exec", "--alias", "linear", "--env-var", "LINEAR_TOKEN", "--", "python3", writer], { env: { PATH: process.env.PATH, HOME: homedir(), USER: process.env.USER, LANG: "en_US.UTF-8" }, stdio: ["pipe", "pipe", "ignore"], timeout: 40_000 });
  let output = "";
  child.stdout.on("data", chunk => { output += String(chunk); if (output.length > 8192) child.kill(); });
  child.stdin.on("error", () => {});
  child.on("error", () => reject(Error("priority_unconfirmed")));
  child.on("close", code => {
    if (code !== 0) { reject(Error("priority_unconfirmed")); return; }
    try {
      const result = JSON.parse(output) as PriorityResult;
      if (!Number.isInteger(result.priority) || result.priority < 0 || result.priority > 4 || !Number.isFinite(Date.parse(result.updated_at))) throw Error("invalid_result");
      resolve(result);
    } catch { reject(Error("priority_unconfirmed")); }
  });
  child.stdin.end(JSON.stringify({ story, expected, priority }));
});
const key = (task: GgTask) => task.story ?? task.id;
const priorityValue = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 4;

/** A Linear-prioritás és a személyes átnézés két külön adat. A core-ba soha nem írunk. */
export class GgWorkService {
  private busy = new Set<string>();
  constructor(private store: GgAttentionStore, private write: WritePriority = writeGgPriority, private now = Date.now) {}
  decorate(feed: GgOverview): GgOverview {
    try {
      const attentionState = this.store.snapshot();
      return { ...feed, tasks: feed.tasks.map(task => {
        const attention = attentionState[key(task)] ?? {};
        let override = attention.priority_override;
        // A core által utolért nyugtát tartósan kivesszük: későbbi forrásváltozáskor nem éledhet újra.
        if (override && (task.priority === override.value || Boolean(task.priority_source_updated_at && Date.parse(task.priority_source_updated_at) >= Date.parse(override.updated_at)))) {
          this.store.set(key(task), { priority_override: undefined });
          delete attention.priority_override;
          override = undefined;
        }
        const pending = Boolean(override && task.priority !== override.value && (!task.priority_source_updated_at || Date.parse(task.priority_source_updated_at) < Date.parse(override.updated_at)));
        const priority = pending ? override!.value : task.priority;
        const candidate = task.story ? (reviewCandidates as Record<string, number>)[task.story] : undefined;
        return { ...task, priority, priority_sync_pending: pending, priority_needs_review: candidate !== undefined && candidate === priority && attention.reviewed_priority !== priority, snoozed_until: attention.snoozed_until ?? null };
      }) };
    } catch { return { ...feed, source: { ...feed.source, error: "A személyes átnézési állapot nem olvasható. A későbbre tétel most nem alkalmazható." } }; }
  }
  async handle(request: Request, feed: GgOverview, allowed: boolean): Promise<Response> {
    const reply = (body: unknown, status = 200) => jsonResponse(body, status, { "cache-control": "no-store" });
    const fail = (code: string, message: string, status: number) => reply({ error: { code, message } }, status);
    if (!allowed) return fail("read_only", "Interaktív helyi hozzáférés szükséges.", 403);
    if (request.method !== "PUT") return fail("method_not_allowed", "Csak PUT támogatott.", 405);
    let body: Record<string, unknown>;
    try { body = await readCappedJson(new Response(request.body, { headers: request.headers }), 4096); }
    catch { return fail("invalid_body", "Hibás vagy túl nagy kérés.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("invalid_body", "Hibás kérés.", 400);
    const decorated = this.decorate(feed);
    const task = decorated.tasks.find(row => row.id === body.task_id);
    if (!task || decorated.source.error) return fail("stale_task", "A feladatsor nem friss. Frissítsd a nézetet.", 409);
    const identity = key(task);
    if (this.busy.has(identity)) return fail("busy", "Ehhez a storyhoz már folyamatban van mentés.", 409);
    if (body.action === "snooze") {
      if (task.state !== "planned") return fail("invalid_state", "Csak tervezett munka tehető későbbre az átnézésben.", 400);
      const date = body.snoozed_until;
      if (date !== null && (typeof date !== "string" || !Number.isFinite(Date.parse(date)) || Date.parse(date) <= this.now() || Date.parse(date) > this.now() + 366 * 86400_000)) return fail("invalid_date", "Jövőbeli dátumot válassz, legfeljebb egy évre.", 400);
      try { this.store.set(identity, { snoozed_until: date as string | null }); }
      catch { return fail("save_failed", "A későbbre tétel nem menthető.", 500); }
      return reply(this.decorate(feed));
    }
    if (body.action !== "priority" || !task.story || !priorityValue(body.priority) || !priorityValue(body.expected)) return fail("invalid_priority", "Érvényes Linear-story és prioritás szükséges.", 400);
    this.busy.add(identity);
    try {
      const result = await this.write(task.story, body.expected, body.priority);
      // Az ütköző, frissebb Linear-érték is feloldja a késő core-tükröt, de nem emberi besorolás.
      this.store.set(identity, { priority_override: { value: result.priority, updated_at: result.updated_at }, ...(result.conflict ? {} : { reviewed_priority: result.priority, priority_confirmed_at: new Date(this.now()).toISOString(), priority_intent: "Ovis kézi prioritásválasztás/megerősítés: " + task.story + " → " + result.priority }) });
      if (result.conflict) return fail("priority_conflict", "A prioritás közben megváltozott a Linearben. Frissíts, és ellenőrizd az új értéket.", 409);
      return reply(this.decorate(feed));
    } catch { return fail("priority_unconfirmed", "A Linear-mentés eredménye nem igazolt. Frissítsd a nézetet és ellenőrizd a Lineart az újrapróbálás előtt.", 502); }
    finally { this.busy.delete(identity); }
  }
}

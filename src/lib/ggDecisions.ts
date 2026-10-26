import type { GgDecisionDetail, GgDecisionReceipt, GgDecisionReply, GgDiscussionReceipt } from "../../shared/gg-decisions.ts";
import { apiFetch } from "./api-request-id.ts";
import type { MachineSessionRegistry } from "./machineSession.ts";

async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try { response = await apiFetch("/api/gg/decisions/" + path, { ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(120_000) }); }
  catch { throw Error(body === undefined ? "A döntés most nem olvasható." : "A művelet eredménye nem igazolt. A választ nem küldjük újra automatikusan."); }
  let data;
  try { data = await response.json(); }
  catch { throw Error("A művelet eredménye nem igazolt. Ellenőrizd újrapróbálás előtt."); }
  if (!response.ok) throw Error(data.error?.message ?? "A művelet nem sikerült.");
  return data as T;
}
export const ggDecisionApi = {
  detail: (id: string, story: string) => request<GgDecisionDetail>(encodeURIComponent(id) + "?story=" + encodeURIComponent(story)),
  reply: (input: GgDecisionReply) => request<GgDecisionReceipt>(input.binding.decision_id + "/reply", input),
  discuss: (id: string, story: string, connection: string) => request<GgDiscussionReceipt>(encodeURIComponent(id) + "/discuss", { story, connection }),
};
/** Csak kattintásra kapcsolódik; ugyanazt a kapcsolatot használja majd a megnyitott beszélgetés. */
export function decisionConnection(sessions: MachineSessionRegistry | null): Promise<string> {
  if (!sessions) return Promise.reject(Error("A gép kapcsolata nem érhető el."));
  const session = sessions.get("local");
  if (session.connection) return Promise.resolve(session.connection);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { off(); reject(Error("A gép kapcsolata nem állt helyre. Próbáld újra később.")); }, 5000);
    const off = session.on(message => { if (message.type === "snapshot" && session.connection) { window.clearTimeout(timer); off(); resolve(session.connection); } });
    session.connect();
  });
}
/** HTTPS-en és a helyi HTTP-próbában is működő, új szándékhoz egyszer készített UUID. */
export function decisionRequestKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

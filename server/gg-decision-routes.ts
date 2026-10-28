import type { GgDecisionService } from "./gg-decisions.ts";
import { DEFAULT_DISCUSSION_REPOSITORY, discussionRepository, type GgDiscussionService } from "./gg-discussion.ts";
import type { GgOverviewService } from "./gg-overview.ts";
import { jsonResponse } from "./http.ts";
import { readCappedJson } from "./remote-json.ts";

const messages: Record<string, string> = {
  stale_target: "A döntés alapja közben megváltozott. Olvasd újra a kérdést; a válaszod megmarad.",
  target_state_mismatch: "A döntés állapota közben megváltozott. Olvasd újra a kérdést.",
  review_head_mismatch: "A PR közben megváltozott. Az új változathoz friss review szükséges.",
  plan_mismatch: "A jóváhagyandó terv közben megváltozott. Olvasd újra a kérdést.",
  plan_expired: "A terv lejárt. A Beszéljük át gombbal lehet rendezni a folytatást.",
  owner_mismatch: "Ezt a döntést a címzettje válaszolhatja meg.",
  capability_missing: "A döntéshez szükséges művelet még nem érhető el.",
  idempotency_conflict: "Ehhez a mentési azonosítóhoz már más válasz tartozik. Olvasd újra a döntést.",
  decision_not_found: "A kérdés már nem található ebben a storyban. Frissítsd az áttekintőt.",
  discussion_quota_unavailable: "Most nincs egyértelműen igazolt szabad keret új agenthez. Csak az indítandó CLI-profil frissen mért szabad keretéből választunk.",
  discussion_workspace_missing: "A döntési beszélgetés munkakönyvtára nincs beállítva.",
  discussion_identity_changed: "A döntési tabon közben más session fut. Ellenőrizd a Döntések átbeszélése tabot; nem küldtünk neki üzenetet.",
  discussion_identity_unavailable: "A döntési tab futó sessionje most nem igazolható. Ellenőrizd a meglévő tabot.",
  discussion_state_unavailable: "A döntési tab nyugtája nem olvasható. Ellenőrizd a meglévő tabot új indítás előtt.",
  discussion_start_unconfirmed: "A tab indításának eredménye nem igazolt. Ellenőrizd a Döntések átbeszélése tabot új indítás előtt.",
};

export async function handleGgDecisionRequest(request: Request, allowed: boolean, decisions: GgDecisionService, discussion: GgDiscussionService, overview: GgOverviewService): Promise<Response> {
  const reply = (value: unknown, status = 200) => jsonResponse(value, status, { "cache-control": "no-store" });
  const fail = (code: string, message: string, status: number) => reply({ error: { code, message } }, status);
  if (!allowed) return fail("read_only", "Interaktív helyi hozzáférés szükséges.", 403);
  const url = new URL(request.url), match = /^\/api\/gg\/decisions\/([0-9a-f-]{36})(?:\/(reply|discuss))?$/.exec(url.pathname);
  if (!match) return fail("not_found", "Ismeretlen döntési művelet.", 404);
  const [, id, action] = match;
  if (request.method !== (action ? "POST" : "GET")) return fail("method_not_allowed", "Nem támogatott művelet.", 405);
  let body: Record<string, unknown> = {};
  if (action) {
    try {
      body = await readCappedJson(new Response(request.body, { headers: request.headers }), 65536);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("invalid_body");
    } catch { return fail("invalid_body", "Hibás vagy túl nagy kérés.", 400); }
  }
  try {
    if (!action) return reply(await decisions.detail(id!, url.searchParams.get("story") ?? ""));
    if (action === "reply") {
      if (!body.binding || typeof body.binding !== "object" || (body.binding as { decision_id?: unknown }).decision_id !== id) return fail("invalid_reply", "A válasz nem ehhez a döntéshez tartozik.", 400);
      const receipt = await decisions.reply(body);
      await overview.invalidate();
      return reply(receipt);
    }
    if (typeof body.story !== "string" || typeof body.connection !== "string" || !body.connection || body.connection.length > 200) return fail("invalid_body", "Az átbeszéléshez élő böngészőkapcsolat szükséges.", 400);
    const detail = await decisions.detail(id!, body.story);
    // A tab a story repójának workspace-ében nyílik; olvasási hibánál a gg-agent-skills marad.
    const repository = await overview.read().then(feed => discussionRepository(feed, detail.binding.task_id), () => DEFAULT_DISCUSSION_REPOSITORY);
    return reply(await discussion.open(detail, body.connection, repository));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["invalid_reply", "invalid_decision"].includes(code)) return fail(code, "A döntés vagy a válasz adata nem értelmezhető. Olvasd újra a kérdést.", 400);
    if (messages[code]) return fail(code, messages[code], 409);
    return fail("unconfirmed", action === "reply" ? "A mentés eredménye nem igazolt. A válaszod megmaradt; azonos szöveggel újrapróbálva ugyanazt a mentést ellenőrizzük." : action === "discuss" ? "Az átbeszélés megnyitása nem igazolt. Ellenőrizd a meglévő tabot új próbálkozás előtt." : "A döntés most nem olvasható. Próbáld újra később.", 502);
  }
}

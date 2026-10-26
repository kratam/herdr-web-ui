import { expect, it } from "bun:test";
import { handleGgDecisionRequest } from "./gg-decision-routes.ts";
import { GgDecisionService } from "./gg-decisions.ts";
import { GgDiscussionService } from "./gg-discussion.ts";
import { GgOverviewService } from "./gg-overview.ts";

it("watch/bridge kérésből sem olvasókapcsolat, sem döntésírás, sem tabnyitás nem indul", async () => {
  let calls = 0;
  const decisions = new GgDecisionService(async () => { calls++; throw Error("must not call"); });
  const discussion = new GgDiscussionService("/not-used", {} as never);
  for (const method of ["GET", "POST"]) {
    const response = await handleGgDecisionRequest(new Request("http://local/api/gg/decisions/e604002f-2993-4675-9c68-4808a010f808" + (method === "POST" ? "/reply" : "?story=IT-1"), { method }), false, decisions, discussion, new GgOverviewService());
    expect(response.status).toBe(403);
  }
  expect(calls).toBe(0);
});
it("más döntésre kötött és túlméretes válasz nem jut a kanonikus API-ig", async () => {
  let calls = 0;
  const decisions = new GgDecisionService(async () => { calls++; throw Error("must not call"); });
  for (const body of [{ binding: { decision_id: "other" } }, { raw_text: "x".repeat(70000) }]) {
    const response = await handleGgDecisionRequest(new Request("http://local/api/gg/decisions/e604002f-2993-4675-9c68-4808a010f808/reply", { method: "POST", body: JSON.stringify(body) }), true, decisions, new GgDiscussionService("/not-used", {} as never), new GgOverviewService());
    expect(response.status).toBe(400);
  }
  expect(calls).toBe(0);
});

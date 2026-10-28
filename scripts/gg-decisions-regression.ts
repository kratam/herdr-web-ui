/** A teljes döntési út izolált Herdr-sessionnel; nincs éles válasz vagy modellhívás. */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "./chrome-path.ts";
import { createServer } from "../server/index.ts";
import { GgOverviewService } from "../server/gg-overview.ts";
import { GgDecisionService } from "../server/gg-decisions.ts";
import { GgDiscussionService, type DiscussionIdentity } from "../server/gg-discussion.ts";
import { sessionSnapshot, tabCreate, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ovis-gg-decisions-")));
let server: ReturnType<typeof createServer> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let workspace: string | undefined, discussionPane = "", creates = 0, prompts = 0, queued = 0;
let live: DiscussionIdentity | null = null;
const questions = [1, 2, 3].map(index => ({ id: `e604002f-2993-4675-9c68-4808a010f80${index}`, task_id: `01e66a97-c5de-4526-aad8-3d996843d69${index}`, story_identifier: `IT-${index}`, epoch: 1, source_revision: "a".repeat(64), question_key: "CORE-TEST-" + index,
  state: "pending", text: ["Legyen egyszerűbb a nézet?", "Rövidebb legyen a lista?", "Ezt előbb beszéljük át?"][index - 1]!, response_type: "boolean", choices: [], proposal: { label: "Igen", rationale: "Gyorsabb átnézés." }, proposal_risk: { score: 4, explanation: "Visszafordítható változtatás." }, authorizations: index === 3 ? [{ id: "8752423d-9ea7-4ad8-b2df-062be6a7f6d4", descriptor_hash: "c".repeat(64), expires_at: "2099-01-01T00:00:00Z", descriptor: { operation_name: "example.publish", scope: { system: "fixture", environment: "production", resource_ids: ["fixture-only"] }, arguments: { target: "fixture-only" }, preconditions: { revision: "v1" }, max_uses: 100, cost_limit_units: 0 } }] : [] }));
const writes: Record<string, unknown>[] = [];
try {
  const created = await workspaceCreate({ cwd: root, label: "gg-decisions-fixture" }); workspace = created.workspace.workspace_id;
  const service = new GgDecisionService(async (name, args) => {
    if (name === "autoagent_decisions") return { version: 3, total: 1, items: questions.filter(question => question.story_identifier === args.story) };
    const action = args.action as Record<string, unknown>; writes.push(action);
    if (action.decision_id === questions[1]!.id && writes.filter(row => row.decision_id === action.decision_id).length === 1) throw Error("gg_mcp_unavailable");
    const question = questions.find(question => question.id === action.decision_id)!;
    const processing = action.raw_text === "Talán" ? "ambiguous" : "answered";
    if (processing === "answered") question.state = "answered";
    const hash = createHash("sha256").update(String(action.raw_text)).digest("hex");
    return { version: 3, operation: "session_reply", state: "recorded", delivery: "direct", task_id: question.task_id, decision_id: question.id, request_key: action.request_key, response_id: "9da81310-3120-43cd-8908-9ba34922c2e7", raw_text_sha256: hash, answer_text_sha256: hash, answer_processing: processing };
  });
  const overview = new GgOverviewService({ mappings: () => ({ "GuestGuru/fixture": { repository: "GuestGuru/fixture", label: "gg-decisions-fixture", path: root } }), load: async () => ({ version: 3,
    items: questions.map(question => ({ id: question.task_id, title: "Próba " + question.story_identifier, story_identifier: question.story_identifier, state: "waiting", package_state: "active", working_repositories: [{ repository: "GuestGuru/fixture" }] })), questions }) });
  const discussion = new GgDiscussionService(root, {
    inspect: async () => live,
    choose: async () => ({ kind: "claude", args: [], env: {} }),
    create: async () => { creates++; const tab = await tabCreate({ workspaceId: workspace!, cwd: root, label: "Döntések átbeszélése" }); discussionPane = tab.root_pane.pane_id; return { pane_id: discussionPane, terminal_id: tab.root_pane.terminal_id! }; },
    start: async (_pane, _agent, name, prompt) => { if (prompt) prompts++; const pane = (await sessionSnapshot()).panes.find(pane => pane.pane_id === discussionPane)!; live = { pane_id: discussionPane, terminal_id: pane.terminal_id!, agent: "claude", name, process_pid: 123, process_birth: 456, session: "test-session" }; return true; },
    queue: async () => { queued++; return true; },
  });
  server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: join(root, "state"), ggOverview: overview, ggDecisions: service, ggDiscussion: discussion, herdrProfiles: async () => [] });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}/?ggOverview=global`);
  const card = (index: number) => page.getByRole("article", { name: `IT-${index} · Próba IT-${index}`, exact: true });
  // a javaslat és a kockázat a válaszgombok előtt is látszik
  for (const fragment of [questions[0]!.text, "Gyorsabb átnézés.", "Visszafordítható változtatás."]) await card(1).getByText(fragment, { exact: false }).first().waitFor();
  await card(1).getByRole("button", { name: "Elfogadom a javaslatot", exact: true }).click();
  assert.equal(await card(1).getByRole("textbox", { name: "Válaszod" }).inputValue(), "Igen", "az elfogadás kitölti, de nem küldi a választ");
  assert.equal(writes.length, 0);
  await card(1).getByRole("textbox", { name: "Válaszod" }).fill("Talán");
  await card(1).getByRole("button", { name: "Válasz rögzítése" }).click();
  await card(1).getByText("A válasz megérkezett, de pontosítás kell", { exact: false }).waitFor();
  assert.equal(await card(1).getByRole("textbox").inputValue(), "Talán");
  await card(1).getByRole("button", { name: "Igen", exact: true }).click();
  await card(1).getByRole("button", { name: "Válasz rögzítése" }).click();
  await card(1).waitFor({ state: "detached" });
  await card(2).getByRole("button", { name: "Mást mondok", exact: true }).click();
  await card(2).getByRole("textbox", { name: "Válaszod" }).fill("  Igen, így jó.  ");
  await card(2).getByRole("button", { name: "Válasz rögzítése" }).click();
  await card(2).getByRole("alert").waitFor();
  assert.equal(writes.length, 3, "hiba után nincs automatikus újraküldés");
  assert.equal(await card(2).getByRole("textbox").inputValue(), "  Igen, így jó.  ");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator(".gg-overview").evaluate(element => element.scrollWidth <= element.clientWidth), true, "mobilon nincs vízszintes túlcsordulás");
  if (process.env.CHECK_BROWSER_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.CHECK_BROWSER_EVIDENCE_DIR, "gg-decision-mobile.png"), fullPage: true });
  await card(2).getByRole("button", { name: "Válasz rögzítése" }).click();
  await card(2).waitFor({ state: "detached" });
  assert.equal(writes[2]!.request_key, writes[3]!.request_key, "ugyanaz a válasz ugyanazt a mentést ellenőrzi");
  assert.notEqual(writes[0]!.request_key, writes[1]!.request_key, "az átfogalmazás új válasz");
  await page.setViewportSize({ width: 1440, height: 900 });
  await card(3).getByRole("button", { name: "Mást mondok", exact: true }).click();
  await card(3).getByText("Mire vonatkozik a döntés?", { exact: true }).click();
  await card(3).getByText("A teljes művelet, paraméterek és feltételek", { exact: true }).click();
  const plan = await card(3).locator(".gg-decision-plan").innerText();
  for (const fragment of ["production", "100 alkalommal", "fixture-only", '"preconditions"', '"arguments"']) assert.ok(plan.includes(fragment), fragment);
  if (process.env.CHECK_BROWSER_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.CHECK_BROWSER_EVIDENCE_DIR, "gg-decision-desktop.png"), fullPage: true });
  await card(3).getByRole("button", { name: "Beszéljük át" }).click();
  await page.locator(".gg-decisions").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Globális áttekintés", exact: true }).click();
  await card(3).getByRole("button", { name: "Beszéljük át" }).click();
  await page.locator(".gg-decisions").waitFor({ state: "detached" });
  // a kontextus a kezdő üzenettel megy be, ugyanarra a döntésre másodszor sem küldjük újra
  assert.equal(creates, 1); assert.equal(prompts, 1); assert.equal(queued, 0); assert.deepEqual(errors, []);
  console.log("GG decisions: direct/ambiguous/retry, mobile, shared conversation OK (isolated fixture).");
} finally {
  await browser?.close(); await server?.stop();
  if (workspace) await workspaceClose(workspace);
  rmSync(root, { recursive: true, force: true });
}

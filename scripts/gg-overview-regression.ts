/** Saját GG-MVP működéspróbája kizárólag izolált Herdr-workspace-ekkel. */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "./chrome-path.ts";
import { createServer } from "../server/index.ts";
import { GgAttentionStore } from "../server/gg-attention.ts";
import { GgWorkService } from "../server/gg-work.ts";
import { GgOverviewService } from "../server/gg-overview.ts";
import { sessionSnapshot, tabCreate, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ovis-gg-overview-")));
const openPath = join(root, "open"), closedPath = join(root, "closed");
mkdirSync(openPath); mkdirSync(closedPath);
let server: ReturnType<typeof createServer> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let sourceFails = false, now = Date.now();
let linearPriority = 0, priorityWrites = 0;
const prefix = "gg-overview-fixture";
try {
  const paneA = (await workspaceCreate({ cwd: openPath, label: prefix })).root_pane.pane_id;
  const auxiliaryPath = join(root, "auxiliary"); mkdirSync(auxiliaryPath);
  const paneB = (await workspaceCreate({ cwd: auxiliaryPath, label: prefix + "-auxiliary" })).root_pane.pane_id;
  const service = new GgOverviewService({ now: () => now, mappings: () => ({
    "GuestGuru/gg-closed-fixture": { repository: "GuestGuru/gg-closed-fixture", label: "gg-closed-fixture", path: closedPath },
    "GuestGuru/open": { repository: "GuestGuru/open", label: prefix, path: openPath },
  }), load: async () => {
    if (sourceFails) throw Error("fixture_source_failed");
    return { version: 3, items: [{ id: "t-open", title: "Nyitott feladat", github_url: "https://github.com/GuestGuru/agent-tasks/issues/195", story_identifier: "IT-1983", state: "review", package_state: "active", working_repositories: [{ repository: "GuestGuru/open" }] }, { id: "t-closed", title: "Tervezett munka", story_identifier: "IT-9999", priority: 0, state: "planned", package_state: "active", working_repositories: [{ repository: "GuestGuru/gg-closed-fixture" }] }], questions: [{ question_key: "q-open", task_id: "t-open", state: "pending", text: "Melyik irány legyen?", proposal: { value: true, label: "Az egyszerűbb megoldás.", rationale: "Kevesebb állapotot kell kezelni." } }] };
  } });
  server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: join(root, "state"), ggOverview: service, ggWork: new GgWorkService(new GgAttentionStore(join(root, "state")), async (story, expected, priority) => {
    assert.equal(story, "IT-9999"); assert.equal(expected, linearPriority);
    linearPriority = priority; priorityWrites++;
    return { priority, updated_at: new Date(now).toISOString() };
  }), herdrProfiles: async () => [] });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  let feedReads = 0, tabRequests = 0;
  const requests: Record<string, unknown>[] = [];
  await page.addInitScript(() => {
    const state = window as unknown as { ggCopied: string | null; ggCopyFails: boolean };
    state.ggCopied = null; state.ggCopyFails = false;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { if (state.ggCopyFails) throw Error("refused"); state.ggCopied = text; } } });
    document.execCommand = () => false;
  });
  await page.route("**/api/agents", route => route.fulfill({ json: { agents: [{ kind: "codex", label: "Codex", installed: true }, { kind: "claude", label: "Claude Code", installed: true }] } }));
  await page.route("**/api/tab/create", async route => {
    tabRequests++;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    assert.equal(await page.evaluate(() => (window as unknown as { ggCopied: string }).ggCopied), "https://github.com/GuestGuru/agent-tasks/issues/195");
    assert.deepEqual(body.agent, { kind: tabRequests === 1 ? "codex" : "claude" });
    assert.equal(body.first_message, undefined);
    assert.equal(body.first_message_connection, undefined);
    const created = await tabCreate({ workspaceId: String(body.workspace_id), cwd: openPath, label: "gg-created-agent-fixture" });
    await route.fulfill({ json: { action: "created", workspace_id: String(body.workspace_id), pane_id: created.root_pane.pane_id, agent_started: true } });
  });
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/gg/overview") feedReads++; });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.getByRole("button", { name: "Globális áttekintés", exact: true }).click();
  await page.locator(".gg-runtime-summary > summary").click();
  await page.getByRole("link", { name: "gg-closed-fixture", exact: true }).waitFor();
  if (process.env.CHECK_BROWSER_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.CHECK_BROWSER_EVIDENCE_DIR, "gg-global-mvp.png"), fullPage: true });
  await page.getByRole("link", { name: prefix, exact: true }).click();
  await page.getByRole("heading", { name: prefix, exact: true }).waitFor();
  const firstTab = page.getByRole("tab").first();
  assert.equal(await firstTab.innerText(), "Áttekintés");
  assert.equal(await firstTab.getAttribute("aria-selected"), "true");
  await page.getByText("Melyik irány legyen?", { exact: true }).click();
  await page.getByText("Az egyszerűbb megoldás.", { exact: false }).waitFor();
  await page.keyboard.press("Meta+Shift+K");
  await page.getByRole("dialog", { name: "Command palette", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 740, height: 500 });
  await page.getByRole("tab", { name: "Áttekintés", exact: true }).waitFor({ state: "visible" });
  await page.setViewportSize({ width: 1280, height: 960 });
  if (process.env.CHECK_BROWSER_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.CHECK_BROWSER_EVIDENCE_DIR, "gg-workspace-mvp.png"), fullPage: true });
  if (process.env.CHECK_BROWSER_EVIDENCE_DIR) {
    await page.setViewportSize({ width: 740, height: 900 });
    await page.screenshot({ path: join(process.env.CHECK_BROWSER_EVIDENCE_DIR, "gg-workspace-polish-narrow.png"), fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.screenshot({ path: join(process.env.CHECK_BROWSER_EVIDENCE_DIR, "gg-workspace-polish-light.png"), fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.setViewportSize({ width: 1280, height: 960 });
  }
  await page.getByRole("tab").nth(1).click();
  assert.equal(await page.getByRole("tab").first().getAttribute("aria-selected"), "false");
  // A sidebar a workspace utoljára látott natív/virtuális tabját hozza vissza.
  const rowA = page.locator(`.workspace-select[data-pane="${paneA}"]`);
  const rowB = page.locator(`.workspace-select[data-pane="${paneB}"]`);
  await rowB.click(); await rowA.click();
  assert.equal(await page.getByRole("tab").first().getAttribute("aria-selected"), "false");
  await page.keyboard.press("Meta+Shift+ArrowUp");
  await page.getByRole("heading", { name: prefix, exact: true }).waitFor();
  await page.keyboard.press("Meta+Shift+ArrowDown");
  await page.getByRole("heading", { name: prefix, exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("tab").nth(1).getAttribute("aria-selected"), "true");
  await page.getByRole("tab").first().click();
  await rowB.click(); await rowA.click();
  await page.getByRole("heading", { name: prefix, exact: true }).waitFor();
  await page.getByRole("tab").nth(1).click();
  const readsBeforeReturn = feedReads;
  await page.getByRole("tab").first().click();
  await page.getByText("Nyitott feladat", { exact: true }).waitFor();
  assert.equal(feedReads, readsBeforeReturn, "fresh cache is reused on returning to overview");
  assert.equal(await page.getByText("A feladatsor betöltése…", { exact: false }).count(), 0);
  await page.evaluate(() => { (window as unknown as { ggCopyFails: boolean }).ggCopyFails = true; });
  await page.getByRole("button", { name: "Codex · Nyitott feladat", exact: true }).click();
  await page.getByText("A vágólapra másolás nem sikerült", { exact: false }).waitFor();
  assert.equal(tabRequests, 0);
  await page.evaluate(() => { (window as unknown as { ggCopyFails: boolean }).ggCopyFails = false; });
  for (const kind of ["Codex", "Claude"]) {
    await page.getByRole("button", { name: kind + " · Nyitott feladat", exact: true }).click();
    await page.getByRole("heading", { name: prefix, exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("tab").first().click();
    await page.getByText("Nyitott feladat", { exact: true }).waitFor();
  }
  assert.equal(requests.length, 2);
  // A split-próba az eredeti natív tabbal fut tovább.
  await page.getByRole("tab").nth(1).click();
  const source = page.locator(`.pane-select[title^="${paneB} —"]`);
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 4, { steps: 2 });
  await page.waitForFunction(() => document.querySelector(".split-drop")?.classList.contains("is-visible") === true);
  const area = (await page.locator(".pane-split").boundingBox())!;
  await page.mouse.move(area.x + area.width * 0.8, area.y + area.height / 2, { steps: 8 });
  await page.mouse.move(area.x + area.width * 0.8, area.y + area.height / 2);
  await page.waitForFunction(() => document.querySelector(".split-drop")?.getAttribute("data-side") === "right");
  await page.mouse.up();
  await page.locator(`.pane-slot[data-side="right"] .pane-frame[data-layout-pane="${paneB}"]`).waitFor();
  await page.locator('.pane-slot[data-side="left"]').getByRole("tab", { name: "Áttekintés", exact: true }).click();
  await page.getByRole("heading", { name: prefix, exact: true }).waitFor();
  await page.getByRole("tab").nth(1).click();
  await page.locator(`.pane-slot[data-side="left"] .pane-frame[data-layout-pane="${paneA}"]`).waitFor();
  await page.locator(`.pane-slot[data-side="right"] .pane-frame[data-layout-pane="${paneB}"]`).waitFor();
  await page.getByRole("tab").first().click();
  await page.getByRole("heading", { name: prefix, exact: true }).waitFor();
  await page.getByRole("button", { name: "Vissza a globális áttekintéshez" }).click();
  await page.locator(".gg-runtime-summary > summary").click();
  await page.getByRole("link", { name: "gg-closed-fixture", exact: true }).click();
  await page.getByRole("heading", { name: "gg-closed-fixture", exact: true }).waitFor();
  assert.equal(await page.getByRole("tab").first().getAttribute("aria-selected"), "true");
  assert.equal((await sessionSnapshot()).workspaces.filter(workspace => workspace.label === "gg-closed-fixture").length, 1);
  // Valódi HTTP-mentés izolált tárba; a Linear-határ fixture, éles issue nem változik.
  await page.getByRole("combobox", { name: "Prioritás · Tervezett munka", exact: true }).selectOption("2");
  assert.equal(priorityWrites, 0, "selecting alone never writes Linear");
  await page.getByRole("button", { name: "Prioritás mentése · Tervezett munka", exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('[aria-label="Prioritás · Tervezett munka"]') as HTMLSelectElement)?.value === "2" && !(document.querySelector('[aria-label="Prioritás · Tervezett munka"]') as HTMLSelectElement)?.disabled);
  assert.equal(priorityWrites, 1);
  await page.getByRole("combobox", { name: "Későbbre · Tervezett munka", exact: true }).selectOption("7");
  await page.getByText("Tervezett munka", { exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("combobox", { name: "Munkák szűrése", exact: true }).selectOption("snoozed");
  await page.getByText("Tervezett munka", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Vissza a globális áttekintéshez" }).click();
  await page.getByText("Tervezett munka", { exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("combobox", { name: "Munkák szűrése", exact: true }).selectOption("snoozed");
  await page.getByText("Tervezett munka", { exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Prioritás · Tervezett munka", exact: true }).inputValue(), "2");
  await page.getByRole("combobox", { name: "Későbbre · Tervezett munka", exact: true }).selectOption("clear");
  await page.getByText("Tervezett munka", { exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("combobox", { name: "Munkák szűrése", exact: true }).selectOption("now");
  await page.getByRole("combobox", { name: "Prioritás · Tervezett munka", exact: true }).selectOption("3");
  assert.equal(priorityWrites, 1, "selecting alone never writes Linear");
  await page.getByRole("button", { name: "Prioritás mentése · Tervezett munka", exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('[aria-label="Prioritás · Tervezett munka"]') as HTMLSelectElement)?.value === "3" && !(document.querySelector('[aria-label="Prioritás · Tervezett munka"]') as HTMLSelectElement)?.disabled);
  assert.equal(priorityWrites, 2);
  await page.goto(`http://127.0.0.1:${server.port}/?ggOverview=global`);
  await page.locator(".gg-runtime-summary > summary").click();
  await page.getByRole("link", { name: "gg-closed-fixture", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Prioritás · Tervezett munka", exact: true }).inputValue(), "3");
  await page.getByRole("link", { name: "gg-closed-fixture", exact: true }).click();
  await page.getByRole("heading", { name: "gg-closed-fixture", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Prioritás · Tervezett munka", exact: true }).inputValue(), "3");
  sourceFails = true; now += 65_000;
  await page.getByRole("button", { name: "Frissítés", exact: true }).click();
  await page.getByText("Az autoagent-adatok most nem olvashatók.", { exact: false }).waitFor();
  await page.getByText("Tervezett munka", { exact: true }).waitFor();
  await page.route("**/api/gg/overview", route => route.fulfill({ json: { tasks: [], decisions: [], repositories: [], source: { observed_at: null, error: "Első forrásolvasás hibája" } } }));
  await page.goto(`http://127.0.0.1:${server.port}/?ggOverview=global`);
  await page.getByText("Első forrásolvasás hibája", { exact: true }).waitFor();
  await page.locator(".gg-runtime-summary > summary").click();
  const firstFailureRow = page.locator("tr", { has: page.getByRole("link", { name: prefix, exact: true }) });
  assert.ok((await firstFailureRow.locator("td").nth(1).innerText()).startsWith("—"));
  assert.ok((await firstFailureRow.locator("td").nth(2).innerText()).startsWith("—"));
  assert.deepEqual(errors, []);
  console.log("PASS: külön prioritás-mentés mindkét nézetben, tartós story-szintű halasztás/visszavonás, nincs írás puszta kiválasztásra; sidebar utolsó natív/áttekintő tabja, next/prev áttekintővel, cache tabváltás után, clipboard-hiba tabnyitás nélkül, másolás majd Codex/Claude tab üzenet nélkül; globális/workspace-nézet, jsonb javaslat, első tab kis képernyőn is, paletta-gyorsbillentyű, natív tabváltás, inaktív split megőrzése, bezárt workspace, első és későbbi forráshiba.");
} finally {
  await browser?.close(); server?.stop();
  for (const workspace of (await sessionSnapshot()).workspaces) {
    if ([prefix, prefix + "-auxiliary", "gg-closed-fixture"].includes(workspace.label)) await workspaceClose(workspace.workspace_id);
  }
  rmSync(root, { recursive: true, force: true });
}

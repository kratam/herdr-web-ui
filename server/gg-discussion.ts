import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AGENT_NAME_MAX_LENGTH } from "../shared/agent-name.ts";
import { unlinkSync } from "node:fs";
import type { GgDecisionDetail, GgDiscussionReceipt } from "../shared/gg-decisions.ts";
import type { UsageLaunchProfile } from "./usage.ts";
import { readStateDocument, writeStateDocument } from "./state-document.ts";
import { PendingInputError, samePendingIdentity } from "./pending-input.ts";

export interface DiscussionIdentity { pane_id: string; terminal_id: string; agent: string; name: string; process_pid: number; process_birth: number; session: string | null }
export interface DiscussionAgent { kind: "claude" | "codex"; args: string[]; env: Record<string, string> }
export interface DiscussionDeps {
  /** null kizárólag akkor, ha a pane bizonyíthatóan bezárult. Az olvasási hiba kivétel. */
  inspect(paneId: string): Promise<DiscussionIdentity | null>;
  create(agent: DiscussionAgent, repository: string): Promise<{ pane_id: string; terminal_id: string }>;
  choose(): Promise<DiscussionAgent>;
  /** A kezdő üzenet az indítás része, így nem függ attól, mikor ismeri fel a Herdr az agentet. */
  start(paneId: string, agent: DiscussionAgent, name: string, prompt: string): Promise<boolean>;
  queue(paneId: string, prompt: string, kind: string, connection: string, pid: number): Promise<boolean>;
  wait?(ms: number): Promise<void>;
  /** A tab nevét az átbeszélt storyra állítja; a hibája nem akasztja meg az átbeszélést. */
  label?(paneId: string, label: string): Promise<void>;
}
interface DiscussionTab {
  phase: "creating" | "starting" | "binding" | "running";
  name: string;
  agent: "claude" | "codex";
  pane: { pane_id: string; terminal_id: string } | null;
  identity: DiscussionIdentity | null;
  delivered: { key: string; instance: string; queued: boolean }[];
  delivering: string | null;
}
/** Repónként egy átbeszélő tab: a kulcs a workspace repója. */
interface DiscussionState { version: 2; tabs: Record<string, DiscussionTab> }

export const DEFAULT_DISCUSSION_REPOSITORY = "GuestGuru/gg-agent-skills";
/** Az indítás utáni felismerésre ennyiszer várunk (Herdr ~1 mp alatt ismeri fel az agentet). */
const BIND_ATTEMPTS = 20, BIND_DELAY_MS = 500;
const UNCONFIRMED_START = "unconfirmed-start";

/** A task első, helyben elérhető repója; ha nincs ilyen, a gg-agent-skills. */
export function discussionRepository(overview: { tasks: readonly { id: string; repositories: readonly string[] }[]; repositories: readonly { repository: string; path: string | null }[] }, taskId: string): string {
  const local = new Set(overview.repositories.filter(row => row.path).map(row => row.repository));
  return overview.tasks.find(task => task.id === taskId)?.repositories.find(name => local.has(name)) ?? DEFAULT_DISCUSSION_REPOSITORY;
}

/** A repó workspace-e: ahol a fő checkoutban áll pane, különben az azonos nevű workspace. */
export function discussionWorkspace(snapshot: { panes: readonly { workspace_id: string; cwd?: string | null }[]; workspaces: readonly { workspace_id: string; label: string }[] }, cwd: string, label: string): string | null {
  return snapshot.panes.find(pane => pane.cwd === cwd)?.workspace_id ?? snapshot.workspaces.find(workspace => workspace.label === label)?.workspace_id ?? null;
}

export function discussionLaunchArgs(agent: DiscussionAgent, prompt: string): string[] {
  return agent.kind === "codex" ? [...agent.args, "--", prompt] : [...agent.args, prompt];
}

/** Csak az új beszélgetéshez választunk: a már futó agent modelljéhez nem nyúlunk. */
export function selectDiscussionAgent(profiles: readonly UsageLaunchProfile[], now: number): DiscussionAgent {
  const candidates = profiles.filter(({ usage: provider }) => {
    if (!["claude", "codex"].includes(provider.id) || provider.problem || !provider.checked_at) return false;
    const age = now - Date.parse(provider.checked_at);
    if (!Number.isFinite(age) || age < -60_000 || age > 10 * 60_000) return false;
    const relevant = provider.windows.filter(window => window.scope === null || /sonnet/i.test(window.scope));
    return relevant.some(window => window.kind === "week" && window.scope === null) && relevant.every(window => Number.isFinite(window.used_percent) && window.used_percent >= 0 && window.used_percent < 100);
  }).sort((a, b) => a.usage.windows.find(w => w.kind === "week" && w.scope === null)!.used_percent - b.usage.windows.find(w => w.kind === "week" && w.scope === null)!.used_percent);
  const chosen = candidates[0];
  if (!chosen) throw Error("discussion_quota_unavailable");
  return chosen.usage.id === "claude" ? { kind: "claude", args: ["--model", "sonnet", "--effort", "high"], env: chosen.env } : { kind: "codex", args: ["-m", "gpt-6.1-sol", "--effort", "medium"], env: chosen.env };
}

/** Csak formailag ellenőrzött story-azonosító kerülhet a parancssorba és a tab nevébe. */
function storyKey(detail: GgDecisionDetail): string | null {
  return detail.story && /^[A-Za-z][A-Za-z0-9]{0,15}-\d{1,9}$/.test(detail.story) ? detail.story : null;
}

/**
 * Rövid kezdő üzenet: a Herdr a friss shellbe gépeli az indítóparancsot, és macOS-en a még
 * töltődő shell bemenete kb. 1 KB után csonkul (mérve 2026-10-28). A döntés részleteit ezért
 * nem visszük át, az agent az agent-decisions skillel maga olvassa be frissen.
 */
function prompt(detail: GgDecisionDetail): string {
  const story = storyKey(detail);
  return [
    `Tamás az Áttekintésből ${story ? `a(z) ${story} story` : "egy story"} egyik autonóm döntésének átbeszélését kérte (döntés: ${detail.binding.decision_id}).`,
    "Használd az agent-decisions skillt: olvasd be frissen ezt a döntést, és beszéljétek át egyesével, rövid kontextussal és javaslattal.",
    "Csak Tamás tényleges válaszát rögzítsd; ne indíts más munkát.",
  ].join(" ");
}

export class GgDiscussionService {
  private readonly path: string;
  private readonly instance = randomUUID();
  private serial: Promise<unknown> = Promise.resolve();
  constructor(root: string, private readonly deps: DiscussionDeps) { this.path = join(root, "gg-discussion.json"); }
  open(detail: GgDecisionDetail, connection: string, repository: string = DEFAULT_DISCUSSION_REPOSITORY): Promise<GgDiscussionReceipt> {
    const operation = this.serial.then(() => this.openSerial(detail, connection, repository)).then(async receipt => {
      const story = storyKey(detail);
      if (story && receipt.agent_started) await this.deps.label?.(receipt.pane_id, `Döntés: ${story}`).catch(() => undefined);
      return receipt;
    });
    this.serial = operation.catch(() => undefined);
    return operation;
  }
  private read(): DiscussionState {
    const doc = readStateDocument(this.path);
    if (doc.kind === "missing") return { version: 2, tabs: {} };
    if (doc.kind !== "json" || !doc.value || typeof doc.value !== "object") throw Error("discussion_state_unavailable");
    const raw = doc.value as Record<string, unknown>;
    // A régi, egytabos állapot a gg-agent-skills tabja volt.
    const state: DiscussionState = raw.version === 1 ? { version: 2, tabs: { [DEFAULT_DISCUSSION_REPOSITORY]: raw as unknown as DiscussionTab } } : raw as unknown as DiscussionState;
    if (state.version !== 2 || !state.tabs || typeof state.tabs !== "object") throw Error("discussion_state_unavailable");
    for (const tab of Object.values(state.tabs)) {
      if (!tab || !["creating", "starting", "binding", "running"].includes(tab.phase) || typeof tab.name !== "string" || !["claude", "codex"].includes(tab.agent) || !Array.isArray(tab.delivered)) throw Error("discussion_state_unavailable");
    }
    return state;
  }
  private save(state: DiscussionState): void { writeStateDocument(this.path, JSON.stringify(state), false); }
  private bind(state: DiscussionState, tab: DiscussionTab, live: DiscussionIdentity): void {
    if (!tab.pane || live.pane_id !== tab.pane.pane_id || live.terminal_id !== tab.pane.terminal_id || live.agent !== tab.agent || live.name !== tab.name || !live.process_pid || !live.process_birth) throw Error("discussion_identity_changed");
    tab.identity = live; tab.phase = "running"; this.save(state);
  }
  private async launch(state: DiscussionState, tab: DiscussionTab, pane: { pane_id: string; terminal_id: string }, agent: DiscussionAgent, detail: GgDecisionDetail, key: string): Promise<GgDiscussionReceipt> {
    tab.phase = "starting"; this.save(state);
    try {
      if (!await this.deps.start(pane.pane_id, agent, tab.name, prompt(detail))) throw Error("start_failed");
    } catch {
      // Ha mégis elindult, a kezdő üzenet bemehetett: ezt a döntést nem küldjük újra, csak bizonytalannak jelezzük.
      tab.delivered.push({ key, instance: UNCONFIRMED_START, queued: false }); this.save(state);
      return { pane_id: pane.pane_id, agent_started: false, queued: false, error: "discussion_start_unconfirmed" };
    }
    // A sikeres indítás igazolja, hogy a pane üres volt: a korábbi bizonytalan indítások nem futottak le.
    tab.delivered = tab.delivered.filter(item => item.instance !== UNCONFIRMED_START);
    // A kontextus a kezdő üzenettel már bement; a tab igazolása ettől függetlenül pótolható.
    tab.delivered.push({ key, instance: this.instance, queued: true }); tab.phase = "binding"; this.save(state);
    try {
      const live = await this.settle(pane.pane_id);
      if (live) this.bind(state, tab, live);
    } catch { /* A következő kattintás újra megpróbálja igazolni; az üzenet már a tabban van. */ }
    return { pane_id: pane.pane_id, agent_started: true, queued: true };
  }
  /** Indítás után a Herdr csak kis késéssel ismeri fel az agentet; addig az azonosítás hibát ad. */
  private async settle(paneId: string): Promise<DiscussionIdentity | null> {
    for (let attempt = 1; ; attempt++) {
      try { return await this.deps.inspect(paneId); }
      catch (error) {
        if (attempt >= BIND_ATTEMPTS) throw error;
        await (this.deps.wait ?? Bun.sleep)(BIND_DELAY_MS);
      }
    }
  }
  private async openSerial(detail: GgDecisionDetail, connection: string, repository: string): Promise<GgDiscussionReceipt> {
    const state = this.read();
    let tab: DiscussionTab | null = state.tabs[repository] ?? null;
    const key = `${detail.binding.decision_id}:${detail.binding.expected_epoch}:${detail.binding.expected_source_revision}`;
    if (tab?.pane) {
      let live: DiscussionIdentity | null;
      try { live = await this.deps.inspect(tab.pane.pane_id); }
      catch (error) {
        // Elbukott indítás után a pane él, de agent nincs benne: ugyanott újraindítunk.
        // A Herdr csak szabad shellbe indít, futó agentet így nem írhatunk felül.
        // A pane él, de a Herdr nem lát benne agentet: a tab elhagyható (félbegépelt parancs is lehet a shellben).
        if (error instanceof Error && error.message === "discussion_agent_absent") live = null;
        else {
          // Átmeneti olvasási hiba vagy eltérő agenttípus esetén nem nyitunk új tabot a még esetleg futó mellé.
          if (tab.phase !== "starting" || !(error instanceof Error) || error.message !== "discussion_identity_unavailable") throw error;
          const agent = await this.deps.choose();
          if (agent.kind !== tab.agent) return { pane_id: tab.pane.pane_id, agent_started: false, queued: false, error: "discussion_start_unconfirmed" };
          return this.launch(state, tab, tab.pane, agent, detail, key);
        }
      }
      if (!live) { delete state.tabs[repository]; tab = null; }
      else {
        // Csak a Herdr által már nyugtázott indítást fejezhetjük be; az egyedi RPC-név
        // a saját indításé, nem a felhasználó által szabadon átírható tabcím.
        // „starting”: az indítás nyugtája elveszhetett, de a saját egyedi nevű agent ettől még futhat.
        if (tab.phase === "binding" || tab.phase === "starting") this.bind(state, tab, live);
        const bound = tab.identity;
        if (tab.phase !== "running" || !bound) return { pane_id: tab.pane.pane_id, agent_started: false, queued: false, error: "discussion_start_unconfirmed" };
        const lease = (value: DiscussionIdentity) => ({ terminalId: value.terminal_id, agent: value.agent, processPid: value.process_pid, processBirth: value.process_birth, session: value.session });
        if (live.name !== bound.name || !samePendingIdentity(lease(bound), lease(live)) || bound.session !== null && live.session !== bound.session) throw Error("discussion_identity_changed");
        if (bound.session === null && live.session !== null) { tab.identity = live; this.save(state); }
      }
    }
    if (!tab) {
      const agent = await this.deps.choose();
      tab = { phase: "creating", name: ("gg-decisions-" + randomUUID().replaceAll("-", "")).slice(0, AGENT_NAME_MAX_LENGTH), agent: agent.kind, pane: null, identity: null, delivered: [], delivering: null };
      state.tabs[repository] = tab; this.save(state);
      try { tab.pane = await this.deps.create(agent, repository); }
      catch (error) {
        // A hiányzó mapping a runtime-ban minden Herdr-művelet ELŐTT derül ki.
        if (error instanceof Error && error.message === "discussion_workspace_missing") {
          delete state.tabs[repository];
          if (Object.keys(state.tabs).length) this.save(state); else unlinkSync(this.path);
        }
        throw error;
      }
      return this.launch(state, tab, tab.pane, agent, detail, key);
    }
    if (!tab.pane || !tab.identity) throw Error("discussion_start_unconfirmed");
    const receipt = { pane_id: tab.pane.pane_id, agent_started: true };
    if (tab.delivering) return { ...receipt, queued: false, error: "discussion_delivery_unconfirmed" };
    const previous = tab.delivered.find(item => item.key === key);
    if (previous) return previous.instance !== this.instance ? { ...receipt, queued: false, error: "discussion_delivery_unconfirmed" } : { ...receipt, queued: previous.queued, ...(!previous.queued ? { error: "discussion_message_held" } : {}) };
    tab.delivering = key; this.save(state);
    try {
      const queued = await this.deps.queue(tab.pane.pane_id, prompt(detail), tab.identity.agent, connection, tab.identity.process_pid);
      tab.delivered.push({ key, instance: this.instance, queued }); tab.delivering = null; this.save(state);
      return { ...receipt, queued, ...(!queued ? { error: "discussion_message_held" } : {}) };
    } catch (error) {
      if (error instanceof PendingInputError && ["pending_limit", "pending_uncertain", "invalid_submit_text"].includes(error.code)) {
        tab.delivering = null; this.save(state);
        return { ...receipt, queued: false, error: "discussion_queue_full" };
      }
      return { ...receipt, queued: false, error: "discussion_delivery_unconfirmed" };
    }
  }
}

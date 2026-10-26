import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { GgDecision, GgOverview, GgRepository, GgTask } from "../shared/gg-overview.ts";
import { jsonResponse } from "./http.ts";
import { sessionSnapshot } from "./herdr/client.ts";

const exec = promisify(execFile);
const FRESH_MS = 60_000;
const SOURCE_ERROR = "Az autoagent-adatok most nem olvashatók. Az élő Ovis-állapot ettől még látszik.";
const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown, max = 500): string | null => typeof value === "string" && value.trim() !== "" ? value.slice(0, max) : null;
const repo = (value: unknown): string | null => typeof value === "string" && /^[\w.-]+\/[\w.-]+$/.test(value) ? value : null;
const url = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try { const parsed = new URL(value); return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null; } catch { return null; }
};

/** Explicit projekció: brief, checkpoint, grant, token és nyers processzadat nem megy a kliensnek. */
export function projectCoreStatus(value: unknown): Pick<GgOverview, "tasks" | "decisions"> {
  const data = record(value);
  if (data.version !== 3 || !Array.isArray(data.items) || !Array.isArray(data.questions)) throw Error("invalid_core_status");
  const pendingTasks = new Set(data.questions.filter(raw => record(raw).state === "pending").map(raw => record(raw).task_id));
  const tasks: GgTask[] = [];
  for (const raw of data.items) {
    const item = record(raw);
    const relevant = ["planned", "ready", "running", "waiting", "review", "failed"].includes(String(item.state)) || pendingTasks.has(item.id) && ["succeeded", "canceled"].includes(String(item.state));
    if (item.package_state !== "active" || !relevant) continue;
    const id = str(item.id), title = str(item.title), state = str(item.state);
    if (!id || !title || !state) throw Error("invalid_task");
    const repositories = [...new Set((Array.isArray(item.working_repositories) ? item.working_repositories : []).map(v => repo(record(v).repository)).filter((v): v is string => v !== null))];
    tasks.push({ id, title, state, story: str(item.story_identifier), url: url(item.github_url), repositories, reason: str(item.blocked_reason), updated_at: str(item.updated_at), priority: Number.isInteger(item.priority) && Number(item.priority) >= 0 && Number(item.priority) <= 4 ? Number(item.priority) : null, priority_source_updated_at: str(item.priority_source_updated_at) });
  }
  const taskIds = new Set(tasks.map(task => task.id));
  const decisions: GgDecision[] = [];
  for (const raw of data.questions) {
    const item = record(raw);
    if (item.state !== "pending" || !taskIds.has(String(item.task_id))) continue;
    const id = str(item.id) ?? str(item.question_key), taskId = str(item.task_id), text = str(item.text, 8000);
    if (!id || !taskId || !text) throw Error("invalid_decision");
    const proposal = record(item.proposal);
    const proposalText = [str(proposal.label, 4000), str(proposal.rationale, 8000)].filter(Boolean).join("\n\n") || str(item.proposal, 8000);
    decisions.push({ id, task_id: taskId, text, proposal: proposalText, url: url(item.question_url) });
  }
  return { tasks, decisions };
}

/** Már létező operátori célmapping; címkéből sosem találunk ki könyvtárat. */
export function repositoryMappings(): Record<string, GgRepository> {
  const path = join(homedir(), ".config/auto-agent/herdr-worker.json");
  if (!existsSync(path)) return {};
  const data = record(JSON.parse(readFileSync(path, "utf8")));
  const result: Record<string, GgRepository> = {};
  for (const [name, raw] of Object.entries(record(data.workspaces))) {
    if (!repo(name)) continue;
    const entry = record(raw), directory = str(entry.main_checkout, 4096);
    let resolved: string | null = null;
    if (directory && isAbsolute(directory)) { try { resolved = realpathSync(directory); } catch { /* Nem tippelünk hiányzó checkout helyére. */ } }
    result[name] = { repository: name, label: str(entry.label) ?? name.split("/").at(-1)!, path: resolved };
  }
  return result;
}

/** Rögzített olvasóparancs, shell és kliensből érkező argv nélkül. A stderr soha nem jut a válaszba. */
async function loadCore(): Promise<unknown> {
  const reader = fileURLToPath(new URL("./gg-overview-reader.py", import.meta.url));
  const { stdout } = await exec("gg-mcp-proxy", ["exec", "--alias", "gg-agents-runner-database", "--env-var", "AUTOAGENT_DATABASE_URL", "--", "uv", "run", "--quiet", "--script", reader], {
    timeout: 45_000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: homedir(), USER: process.env.USER, LANG: "en_US.UTF-8" },
  });
  return JSON.parse(stdout);
}

/** A pane cwd-ja külön worktree is lehet, ezt csak a Git mérése kötheti a fő checkouthoz. */
export async function liveRepositoryRoots(): Promise<Record<string, string>> {
  const snapshot = await sessionSnapshot().catch(() => null);
  if (!snapshot) return {};
  const paths = [...new Set(snapshot.panes.map(pane => pane.cwd).filter((path): path is string => typeof path === "string" && isAbsolute(path)))];
  const roots: Record<string, string> = {};
  const deadline = Date.now() + 8000;
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, paths.length) }, async () => {
    while (index < paths.length && Date.now() < deadline) {
      const path = paths[index++]!;
      try {
        const result = await exec("git", ["-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir"], { timeout: 2000, maxBuffer: 8192, encoding: "utf8", env: { PATH: process.env.PATH, HOME: homedir() } });
        const common = result.stdout.trim();
        if (isAbsolute(common) && basename(common) === ".git") roots[path] = dirname(common);
      } catch { /* Nem repository, vagy nincs mérhető Git-kötés: címkéből nem helyettesítjük. */ }
    }
  }));
  return roots;
}

export class GgOverviewService {
  private cached: GgOverview = { tasks: [], decisions: [], repositories: [], source: { observed_at: null, error: SOURCE_ERROR } };
  private nextRead = 0;
  private inFlight: Promise<GgOverview> | null = null;
  constructor(private readonly options: { now?: () => number; load?: () => Promise<unknown>; mappings?: () => Record<string, GgRepository>; roots?: () => Promise<Record<string, string>> } = {}) {}
  async invalidate(): Promise<void> { await this.inFlight; this.nextRead = 0; }
  read(): Promise<GgOverview> {
    const now = (this.options.now ?? Date.now)();
    if (this.inFlight) return this.inFlight;
    if (now < this.nextRead) return Promise.resolve(this.cached);
    this.inFlight = (async () => {
      try {
        const data = projectCoreStatus(await (this.options.load ?? loadCore)());
        const mappings = (this.options.mappings ?? repositoryMappings)();
        const repositories = [...new Set(data.tasks.flatMap(task => task.repositories))].map(name => mappings[name] ?? { repository: name, label: name.split("/").at(-1)!, path: null });
        const roots = this.options.roots ? await this.options.roots() : {};
        this.cached = { ...data, repositories, roots, source: { observed_at: new Date((this.options.now ?? Date.now)()).toISOString(), error: null } };
      } catch { this.cached = { ...this.cached, source: { ...this.cached.source, error: SOURCE_ERROR } }; }
      this.nextRead = (this.options.now ?? Date.now)() + FRESH_MS;
      return this.cached;
    })().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
}

export async function handleGgOverviewRequest(request: Request, service: GgOverviewService, allowed: boolean, transform: (feed: GgOverview) => GgOverview = feed => feed): Promise<Response> {
  if (!allowed) return jsonResponse({ error: { code: "read_only", message: "A GG-áttekintő interaktív helyi hozzáférést igényel." } }, 403);
  if (request.method !== "GET") return jsonResponse({ error: { code: "method_not_allowed", message: "Csak olvasás támogatott." } }, 405);
  const response = jsonResponse(transform(await service.read()));
  response.headers.set("cache-control", "no-store");
  return response;
}

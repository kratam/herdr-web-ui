import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { homedir } from "node:os";

export type GgToolCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;
const TOOLS = new Set(["autoagent_decisions", "autoagent_task_action", "autoagent_tasks", "autoagent_work_packages"]);
const KNOWN_ERRORS = ["stale_target", "target_state_mismatch", "review_head_mismatch", "plan_mismatch", "owner_mismatch", "idempotency_conflict", "capability_missing", "plan_expired"];

/** A meglévő személyes proxy kezeli az identitást; a rövid kapcsolat végén a child is kilép. */
export const callGgTool: GgToolCall = async (name, args) => {
  if (!TOOLS.has(name)) throw Error("invalid_gg_tool");
  const transport = new StdioClientTransport({ command: "gg-mcp-proxy", args: [], stderr: "ignore",
    env: { PATH: process.env.PATH ?? "", HOME: homedir(), USER: process.env.USER ?? "", LANG: "en_US.UTF-8" } });
  const client = new Client({ name: "ovis-gg-decisions", version: "1.0.0" });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 45_000 });
    const blocks = result.content;
    if (!Array.isArray(blocks)) throw Error("gg_mcp_unavailable");
    const raw = blocks.filter(block => block.type === "text").map(block => String(block.text)).join("\n");
    if (raw.length > 4 * 1024 * 1024) throw Error("gg_mcp_unavailable");
    if (result.isError) throw Error(KNOWN_ERRORS.find(code => raw.includes(code)) ?? "gg_mcp_unavailable");
    const envelope = JSON.parse(raw) as { data?: unknown };
    if (!envelope || !Object.hasOwn(envelope, "data")) throw Error("gg_mcp_unavailable");
    return envelope.data;
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    throw Error(KNOWN_ERRORS.includes(code) ? code : "gg_mcp_unavailable");
  } finally { await client.close().catch(() => {}); }
};

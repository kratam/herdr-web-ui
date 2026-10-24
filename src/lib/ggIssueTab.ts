import type { CreateTabRequest, TabCreated } from "../../shared/protocol.ts";
export interface GgIssueTab { workspaceId: string; title: string; url: string; kind: "codex" | "claude" }
type Outcome = { kind: "created"; tab: TabCreated } | { kind: "copy_failed" | "canceled" | "unconfirmed" };

/** Először másolunk, azután kizárólag új agenttabot kérünk; üzenetet soha nem adunk át. */
export async function openGgIssueTab(input: GgIssueTab, copy: (text: string) => Promise<boolean>, create: (request: CreateTabRequest) => Promise<TabCreated>, active: () => boolean = () => true): Promise<Outcome> {
  try { if (!await copy(input.url)) return { kind: "copy_failed" }; }
  catch { return { kind: "copy_failed" }; }
  if (!active()) return { kind: "canceled" };
  try {
    return { kind: "created", tab: await create({ workspace_id: input.workspaceId, label: input.title, agent: { kind: input.kind } }) };
  } catch { return { kind: "unconfirmed" }; }
}

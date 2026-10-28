import type { PendingMessage } from "../shared/protocol.ts";
import { agentLaunch } from "./agent-launch.ts";
import { launchArgsFault } from "../shared/launch-rules.ts";
import { agentProcesses } from "./conversation.ts";
import { DEFAULT_DISCUSSION_REPOSITORY, discussionLaunchArgs, discussionWorkspace, GgDiscussionService, selectDiscussionAgent, type DiscussionIdentity } from "./gg-discussion.ts";
import { repositoryMappings } from "./gg-overview.ts";
import { paneProcessInfo, sessionSnapshot, tabCreate, tabRename, workspaceCreate } from "./herdr/client.ts";
import { processStartedAt } from "./process-start.ts";
import type { UsageService } from "./usage.ts";

/** Az Ovis meglévő indítása és üzenetsora; nincs új háttérfigyelő vagy közvetlen billentyűküldés. */
export function discussionRuntime(root: string, usage: UsageService, queue: (pane: string, text: string, kind: string, requester: string, pid: number) => Promise<PendingMessage>): GgDiscussionService {
  const inspect = async (paneId: string): Promise<DiscussionIdentity | null> => {
    const snapshot = await sessionSnapshot();
    const pane = snapshot.panes.find(row => row.pane_id === paneId);
    if (!pane) return null;
    const agent = snapshot.agents.find(row => row.pane_id === paneId);
    if (!agent?.name || !pane.agent || !pane.terminal_id) throw Error("discussion_identity_unavailable");
    const info = await paneProcessInfo(paneId);
    const foreground = agentProcesses(info?.foreground_processes ?? [], pane.agent)[0];
    const birth = foreground ? processStartedAt(foreground.pid) : null;
    if (!foreground || birth === null) throw Error("discussion_identity_unavailable");
    return { pane_id: paneId, terminal_id: pane.terminal_id, agent: pane.agent, name: agent.name, process_pid: foreground.pid, process_birth: birth, session: agent.agent_session?.value ?? null };
  };
  return new GgDiscussionService(root, {
    inspect,
    choose: async () => selectDiscussionAgent(await usage.forLaunch(), Date.now()),
    create: async (agent, repository) => {
      const mappings = repositoryMappings();
      const mapping = mappings[repository]?.path ? mappings[repository] : mappings[DEFAULT_DISCUSSION_REPOSITORY];
      const cwd = mapping?.path;
      if (!mapping || !cwd) throw Error("discussion_workspace_missing");
      const workspaceId = discussionWorkspace(await sessionSnapshot(), cwd, mapping.label);
      const created = workspaceId
        ? await tabCreate({ workspaceId, cwd, label: "Döntések átbeszélése", env: agent.env })
        : await workspaceCreate({ cwd, label: "Döntések átbeszélése", env: agent.env });
      if (!created.root_pane.terminal_id) throw Error("discussion_start_unconfirmed");
      return { pane_id: created.root_pane.pane_id, terminal_id: created.root_pane.terminal_id };
    },
    start: async (paneId, agent, name, prompt) => {
      const args = discussionLaunchArgs(agent, prompt);
      // ugyanaz az ellenőrzés, mint az Ovis többi indításánál
      if (launchArgsFault(agent.kind, args) !== null) throw Error("discussion_prompt_invalid");
      return (await agentLaunch(paneId, { kind: agent.kind, args, name })).agent_started;
    },
    label: async (paneId, label) => {
      const tab = (await sessionSnapshot()).panes.find(pane => pane.pane_id === paneId)?.tab_id;
      if (tab) await tabRename(tab, label);
    },
    queue: async (pane, text, kind, requester, pid) => {
      const pending = await queue(pane, text, kind, requester, pid);
      return pending.state === "queued" || pending.state === "sending";
    },
  });
}

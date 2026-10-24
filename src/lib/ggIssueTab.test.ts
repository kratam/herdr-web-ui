import { expect, test } from "bun:test";
import { openGgIssueTab } from "./ggIssueTab.ts";
import type { CreateTabRequest } from "../../shared/protocol.ts";
const input = { workspaceId: "w1", title: "IT-1983 · Áttekintő", url: "https://github.com/GuestGuru/agent-tasks/issues/195", kind: "codex" as const };
test("copies the URL before creating an agent tab without any prompt or send fields", async () => {
  const events: string[] = []; const requests: CreateTabRequest[] = [];
  const result = await openGgIssueTab(input, async text => { events.push(text); return true; }, async body => { events.push("create"); requests.push(body); return { action: "created", workspace_id: "w1", pane_id: "w1:p2", agent_started: true }; });
  expect(events).toEqual([input.url, "create"]);
  expect(requests[0]).toEqual({ workspace_id: "w1", label: "IT-1983 · Áttekintő", agent: { kind: "codex" } });
  expect(result.kind).toBe("created");
});
test("clipboard refusal and a changed selection create no tab", async () => {
  let calls = 0;
  const create = async () => { calls++; throw Error("unexpected"); };
  expect((await openGgIssueTab(input, async () => false, create)).kind).toBe("copy_failed");
  expect((await openGgIssueTab(input, async () => true, create, () => false)).kind).toBe("canceled");
  expect(calls).toBe(0);
});
test("ambiguous create failure is reported once, never retried", async () => {
  let calls = 0;
  const result = await openGgIssueTab({ ...input, kind: "claude" }, async () => true, async () => { calls++; throw Error("network"); });
  expect(result.kind).toBe("unconfirmed"); expect(calls).toBe(1);
});

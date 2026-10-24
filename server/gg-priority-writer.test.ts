import { expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

it("a Python Linear-határ ütközéskor nem mutál, csak az ellenőrzött story prioritását írja", () => {
  const path = fileURLToPath(new URL("./gg-priority-writer.py", import.meta.url));
  const script = `
import contextlib, importlib.util, io, json, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("writer", sys.argv[1])
writer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(writer)
calls = []
def graphql(query, variables):
    calls.append((query, variables))
    if query.startswith("query"):
        return {"issue": {"id": "fixture-uuid", "identifier": "IT-1", "priority": 4, "updatedAt": "2026-10-24T12:00:00Z"}}
    return {"issueUpdate": {"success": True, "issue": {"priority": variables["input"]["priority"], "updatedAt": "2026-10-24T12:01:00Z"}}}
writer.graphql = graphql
sys.stdin = io.StringIO(json.dumps({"story": "IT-1", "expected": 0, "priority": 2}))
with contextlib.redirect_stdout(io.StringIO()) as output:
    writer.main()
assert json.loads(output.getvalue())["conflict"] is True
assert len(calls) == 1
calls.clear()
sys.stdin = io.StringIO(json.dumps({"story": "IT-1", "expected": 4, "priority": 2}))
with contextlib.redirect_stdout(io.StringIO()) as output:
    writer.main()
assert len(calls) == 2
assert calls[1][1] == {"id": "fixture-uuid", "input": {"priority": 2}}
assert json.loads(output.getvalue())["priority"] == 2
print("ok")
`;
  expect(execFileSync("python3", ["-c", script, path], { encoding: "utf8", timeout: 5000 }).trim()).toBe("ok");
});

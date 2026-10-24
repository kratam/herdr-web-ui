"""Kizárólag explicit Ovis-kattintásra írja a kanonikus Linear-prioritást."""
import json
import os
import sys
import urllib.request


def graphql(query, variables):
    request = urllib.request.Request("https://api.linear.app/graphql", data=json.dumps({"query": query, "variables": variables}).encode(), headers={"Authorization": os.environ["LINEAR_TOKEN"], "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.load(response)
    if result.get("errors"):
        raise RuntimeError("linear_error")
    return result["data"]


def main():
    body = json.load(sys.stdin)
    story, expected, priority = body["story"], body["expected"], body["priority"]
    if not isinstance(story, str) or not story or type(priority) is not int or priority not in range(5) or type(expected) is not int or expected not in range(5):
        raise ValueError("invalid_request")
    issue = graphql("query($id:String!){issue(id:$id){id identifier priority updatedAt}}", {"id": story})["issue"]
    if not issue or issue["identifier"] != story:
        raise RuntimeError("unknown_story")
    if issue["priority"] != expected:
        print(json.dumps({"conflict": True, "priority": issue["priority"], "updated_at": issue["updatedAt"]}))
        return
    if priority != expected:
        result = graphql("mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{priority updatedAt}}}", {"id": issue["id"], "input": {"priority": priority}})["issueUpdate"]
        if not result["success"]:
            raise RuntimeError("update_failed")
        issue = result["issue"]
    print(json.dumps({"priority": issue["priority"], "updated_at": issue["updatedAt"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit("A Linear-prioritás módosítása nem igazolt.")

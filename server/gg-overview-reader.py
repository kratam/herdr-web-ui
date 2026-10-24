# /// script
# requires-python = ">=3.9"
# dependencies = ["psycopg[binary]>=3.2", "pyyaml>=6"]
# ///
"""A meglévő core-adapter csak olvasó nézete, CLI-státuszlapozási csonkolás nélkül."""
import json
import sys
from pathlib import Path


def main():
    # A telepített közös runtime az adatgazda; nem másoljuk át az állapotgépet.
    runtime = Path.home() / ".agents/gg-agent-skills/gg-mb/skills/auto-agent/scripts"
    sys.path.insert(0, str(runtime))
    from task_state import CoreStore

    with CoreStore() as store:
        with store.connection.transaction():
            store.connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            store.connection.execute("SET LOCAL statement_timeout = '10s'")
            # A történeti brief/checkpoint/result nem terheli a child stdoutját és a méretkorlátot.
            fields = ("id", "title", "state", "package_state", "story_identifier", "github_url", "working_repositories", "blocked_reason", "updated_at")
            tasks = [{key: task.get(key) for key in fields} for task in store.tasks() if task.get("package_state") == "active"]
            # A CLI status csak az utolsó 100 (válaszolt és függő) kérdést adja. Itt az összes
            # aktív csomag nyitott kérdése kell; a túl nagy adathalmaz látható hiba, nem csonkolás.
            questions = store.all("SELECT d.question_key,d.task_id,d.state,d.text,d.proposal,d.question_url "
                                  "FROM agent_core_decision d JOIN agent_core_package w ON w.id=d.package_id "
                                  "WHERE d.state='pending' AND w.state='active' ORDER BY d.created_at LIMIT 5001")
            if len(questions) > 5000 or len(tasks) > 10000:
                raise RuntimeError("overview_capacity_exceeded")
    print(json.dumps({"version": 3, "items": tasks, "questions": questions}, default=str, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # A DB-hiba vagy processzkörnyezet részlete nem kerülhet az Ovis-naplóba.
        sys.exit("A GG-áttekintő forrásolvasása sikertelen.")

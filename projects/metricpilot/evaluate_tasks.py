"""Replay a fixed, hand-checkable task set. No model/API requests are made."""
import datetime as dt
import json
import time
from pathlib import Path

from analytics import run_analysis
from orders_import import preview_csv, commit_import

ROOT = Path(__file__).resolve().parent


def main():
    draft = preview_csv((ROOT / "tests/fixtures/hand-check-orders.csv").read_text(encoding="utf-8"), "hand-check-orders.csv")
    dataset = commit_import(draft, draft["mapping"], {"date_format":"iso", "amount_unit":"major", "currency":"CNY"})
    tasks = json.loads((ROOT / "eval/tasks.json").read_text(encoding="utf-8"))
    cases = []
    for task in tasks:
        started = time.perf_counter()
        contract = {"confirmed":True, "refund_basis":task.get("refund_basis", "order_date"), "cancelled":"exclude", "cancelled_values":["cancelled"]}
        record = {"id":task["id"], "question":task["question"], "engine":"offline_csv_rules", "failure_reasons":[], "external_model_calls":0, "cost_usd":0}
        try:
            run = run_analysis(task["question"], dataset=dataset, contract=contract)
            if "clarification" in task:
                understanding = run["status"] == "needs_clarification" and run["plan"].get("kind") == task["clarification"]
                checks = {"question_understanding":understanding, "tool_parameters":not run["queries"], "numbers":"not_applicable", "citations":"not_applicable"}
            else:
                understanding = run["status"] == "completed" and all(run["plan"].get(k) == v for k, v in task["plan"].items())
                plan = run["plan"]
                expected_dimensions = {"summary", "channel"} if plan["dimension"] == "channel" else {"summary"}
                params = all(q["params"]["period"] in plan["periods"] and q["params"]["dimension"] in expected_dimensions and q["params"]["channel"] == plan["channel"] and q["filters"]["refund_basis"] == contract["refund_basis"] for q in run["queries"])
                params = params and {q["params"]["dimension"] for q in run["queries"]} == expected_dimensions
                report = run["report"]
                numbers = all(report["totals"].get(k) == v for k, v in task["expected"].items())
                if "groups" in task:
                    numbers = numbers and {r["label"]:r["net_cents"] for r in report["rows"]} == task["groups"]
                by_id = {q["id"]:q for q in run["queries"]}
                citations = all(f["evidence"] and all(qid in by_id for qid in f["evidence"]) for f in report["findings"])
                citations = citations and all(any(all(r[k] == raw[k] for k in task["expected"] if k in r) for raw in by_id[r["evidence"]]["rows"]) for r in [report["totals"]])
                citations = citations and all(q["source_hash"] == dataset["source_hash"] and q["source_rows"] for q in run["queries"])
                checks = {"question_understanding":understanding, "tool_parameters":params, "numbers":numbers, "citations":citations}
            record.update(checks)
            record["failure_reasons"] += [k + " incorrect" for k, value in checks.items() if value is False]
            record["status"] = "passed" if not record["failure_reasons"] else "failed"
            record["run"] = run
        except Exception as exc:
            record.update(status="failed", failure_reasons=[type(exc).__name__ + ": " + str(exc)])
        record["elapsed_ms"] = round((time.perf_counter() - started)*1000, 2)
        cases.append(record)
    result = {"version":"csv-v2", "generated_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(), "scope":"Fixed offline tasks; stage checks concern application behavior. No external model or real-user evaluation.", "task_set":"eval/tasks.json", "fixture":"tests/fixtures/hand-check-orders.csv", "tasks":len(cases), "passed":sum(c["status"] == "passed" for c in cases), "external_model_calls":0, "cost_usd":0, "cases":cases}
    (ROOT / "docs/task_report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Offline CSV tasks: {result['passed']}/{result['tasks']}; external model calls: 0")
    return int(result["passed"] != result["tasks"])


if __name__ == "__main__":
    raise SystemExit(main())

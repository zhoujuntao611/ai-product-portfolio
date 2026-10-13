"""Repeatable synthetic offline regression; not a live model benchmark."""
import argparse
import json
import statistics
from datetime import datetime, timezone
from core import ROOT, generate, KB

def run():
    cases = json.loads((ROOT / "eval" / "cases.json").read_text(encoding="utf-8"))
    rows = []
    for case in cases:
        result = generate(case["ticket"],case["region"],"demo")
        source_ids = [s["id"] for s in result["sources"]]
        statements = {f'{doc["id"]}:{i+1}':sentence for doc in KB["documents"] if doc["active"] for i,sentence in enumerate(doc["statements"])}
        failures = []
        route_ok = result["status"]==case["expected_status"]
        source_ok = set(source_ids)==set(case["expected_sources"])
        grounding_ok = all(claim["id"] in statements and claim["text"]==statements[claim["id"]] and claim["citation"] in result["draft"] and claim["source_id"] in source_ids for claim in result["claims"])
        if not route_ok: failures.append("route")
        if not source_ok: failures.append("source_exact_match")
        if not grounding_ok: failures.append("claim_source_integrity")
        for fragment in case.get("required_fragments",[]):
            if fragment not in result["draft"]: failures.append("missing_fragment:"+fragment)
        for fragment in case.get("forbidden_fragments",[]):
            if fragment in result["draft"]: failures.append("forbidden_fragment:"+fragment)
        if set(case.get("forbidden_sources",[]))&set(source_ids): failures.append("archived_source")
        if case.get("expect_no_claims") and result["claims"]: failures.append("unexpected_claims")
        for value in case.get("redacted_values",[]):
            if value in result["input_redacted"]: failures.append("unredacted_input")
        rows.append({"id":case["id"],"scenario":case["scenario"],"expected_status":case["expected_status"],"actual_status":result["status"],"expected_sources":case["expected_sources"],"actual_sources":source_ids,"route_ok":route_ok,"source_exact_match":source_ok,"claim_source_integrity":grounding_ok,"claim_count":len(result["claims"]),"latency_ms":result["latency_ms"],"passed":not failures,"failures":failures})
    n = len(rows)
    report = {"project":"SupportFlow","evaluated_at_utc":datetime.now(timezone.utc).isoformat(timespec="seconds"),"mode":"offline_rule_engine","real_model_calls":0,
        "dataset":"Manually specified synthetic regression cases; authored alongside the implementation; not held-out user traffic",
        "knowledge_snapshot":KB["snapshot_date"],"case_count":n,"passed_count":sum(r["passed"] for r in rows),
        "metrics":{"routing_exact_match":{"numerator":sum(r["route_ok"] for r in rows),"denominator":n},"retrieval_doc_set_exact_match":{"numerator":sum(r["source_exact_match"] for r in rows),"denominator":n},
        "claim_source_integrity":{"numerator":sum(r["claim_source_integrity"] for r in rows if r["claim_count"]),"denominator":sum(bool(r["claim_count"]) for r in rows)},
        "offline_latency_ms":{"median":round(statistics.median(r["latency_ms"] for r in rows),3),"max":max(r["latency_ms"] for r in rows)}},
        "limitations":["No live LLM evaluation; no measured user adoption, handling-time reduction or satisfaction.","Regex risk routing is finite and bypassable, not a general prompt-injection defense.","Exact quotes prevent invented policy text but do not establish semantic relevance or policy truth.","Synthetic scenario expectations are inspectable and not independent human ratings."],"results":rows}
    (ROOT / "eval_report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f'SupportFlow offline regression: {report["passed_count"]}/{n} passed; real model calls: 0')
    for row in rows:
        if not row["passed"]: print(row["id"],row["failures"])
    return report["passed_count"]==n

if __name__=="__main__":
    raise SystemExit(0 if run() else 1)

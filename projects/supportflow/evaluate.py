"""Repeatable synthetic offline regression; not a live model benchmark."""
import json
import statistics
import hashlib
import importlib.util
import copy
from datetime import datetime, timezone
from unittest.mock import patch
from core import ROOT, generate
import core

def run_regression():
    cases = json.loads((ROOT / "eval" / "cases.json").read_text(encoding="utf-8"))
    snapshot = json.loads((ROOT / "eval" / "fixtures_v2.json").read_text(encoding="utf-8"))["fixtures"]["default"]
    rows = []
    for case in cases:
        result = generate(case["ticket"],case["region"],"demo",knowledge=snapshot)
        source_ids = [s["id"] for s in result["sources"]]
        statements = {f'{doc["id"]}:{i+1}':sentence for doc in snapshot["documents"] if doc["active"] for i,sentence in enumerate(doc["statements"])}
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
        "knowledge_snapshot":snapshot["snapshot_date"],"engine_version":core.ENGINE_VERSION,"case_count":n,"passed_count":sum(r["passed"] for r in rows),
        "metrics":{"routing_exact_match":{"numerator":sum(r["route_ok"] for r in rows),"denominator":n},"retrieval_doc_set_exact_match":{"numerator":sum(r["source_exact_match"] for r in rows),"denominator":n},
        "claim_source_integrity":{"numerator":sum(r["claim_source_integrity"] for r in rows if r["claim_count"]),"denominator":sum(bool(r["claim_count"]) for r in rows)},
        "offline_latency_ms":{"median":round(statistics.median(r["latency_ms"] for r in rows),3),"max":max(r["latency_ms"] for r in rows)}},
        "limitations":["No live LLM evaluation; no measured user adoption, handling-time reduction or satisfaction.","Regex risk routing is finite and bypassable, not a general prompt-injection defense.","Exact quotes prevent invented policy text but do not establish semantic relevance or policy truth.","Synthetic scenario expectations are inspectable and not independent human ratings."],"results":rows}
    (ROOT / "eval_report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f'SupportFlow offline regression: {report["passed_count"]}/{n} passed; real model calls: 0')
    for row in rows:
        if not row["passed"]: print(row["id"],row["failures"])
    return report["passed_count"]==n


def digest(relative):
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()


def inspect_result(case, result, snapshot):
    """Independent case oracle: metadata, whole quotes, expected facts and routing.

    Does not trust the engine's own evidence_checks as the acceptance label.
    No-claim outcomes are excluded from emitted-claim support denominators.
    """
    sources = {source["id"]:source for source in result["sources"]}
    docs = {doc["id"]:doc for doc in snapshot["documents"]}
    claims = result["claims"]
    failures = []
    route_ok = result["status"] == case["expected_status"]
    source_ok = set(sources) == set(case["expected_sources"])
    quote_ok, applicable_ok = True, True
    for claim in claims:
        ident, _, ordinal = claim["id"].rpartition(":")
        doc = docs.get(ident)
        index = int(ordinal)-1 if ordinal.isdigit() else -1
        quote_ok = quote_ok and bool(doc and 0 <= index < len(doc["statements"])
            and claim["text"] == doc["statements"][index] and claim["citation"] in result["draft"]
            and claim["citation"] == f'[{ident} §{index+1}]'
            and (claim.get("source_version") if result.get("engine_version") else claim.get("source_version", sources.get(ident,{}).get("version"))) == doc["version"]
            and claim["source_id"] == ident and ident in sources
            and sources[ident]["version"] == doc["version"])
        applicable_ok = applicable_ok and bool(doc and doc["active"] and doc["updated"] <= snapshot["snapshot_date"]
            and doc.get("effective_from", "") <= snapshot["snapshot_date"]
            and (not doc.get("effective_to") or snapshot["snapshot_date"] <= doc["effective_to"])
            and doc.get("region", "all") in ("all", result["region"]))
    required_ok = all(fragment in result["draft"] for fragment in case.get("required_fragments", []))
    forbidden_ok = not any(fragment in result["draft"] for fragment in case.get("forbidden_fragments", []))
    no_claims_ok = not (case.get("expect_no_claims") and claims)
    if case["expected_status"] == "ready" and not claims:
        failures.append("ready_answer_missing_claims")
    privacy_ok = not any(value in result["input_redacted"] for value in case.get("redacted_values", []))
    archived_ok = not set(case.get("forbidden_sources", [])) & set(sources)
    answer_support = (bool(claims) and quote_ok and applicable_ok and required_ok and forbidden_ok
                      and case["expected_status"] == "ready"
                      and all(claim["source_id"] in case["expected_sources"] for claim in claims))
    for label, passed in (("routing",route_ok),("retrieval_doc_set",source_ok),("quote_integrity",quote_ok),
                          ("policy_applicability",applicable_ok),("required_facts_or_conditions",required_ok),
                          ("forbidden_facts",forbidden_ok),("must_abstain",no_claims_ok),("privacy",privacy_ok),("retired_source",archived_ok)):
        if not passed:
            failures.append(label)
    if claims and not answer_support:
        failures.append("citation_does_not_support_expected_answer")
    return {"status":result["status"],"source_ids":list(sources),"source_versions":[{"id":s["id"],"version":s["version"],"source":s.get("source"),"region":s.get("region","all")} for s in result["sources"]],
        "draft":result["draft"],"claims":claims,"question_coverage":result.get("intent_coverage", []),"evidence_checks":result.get("evidence_checks", []),
        "routing_correct":route_ok,"retrieval_exact":source_ok,"quote_integrity":quote_ok,"policy_applicable":applicable_ok,
        "answer_supported":answer_support if claims else None,"has_claims":bool(claims),"latency_ms":result["latency_ms"],
        "passed":not failures,"failures":failures}


def summarize(rows, engine):
    values = [row[engine] for row in rows]
    def metric(key, selected=None):
        selected = values if selected is None else selected
        return {"numerator":sum(bool(row[key]) for row in selected),"denominator":len(selected)}
    emitted = [row for row in values if row["has_claims"]]
    clarify = [row[engine] for row in rows if row["expected"]["status"] in {"needs_context","conflict"}]
    handoff = [row[engine] for row in rows if row["expected"]["status"] in {"unknown","escalate"}]
    return {"passed_count":sum(row["passed"] for row in values),"case_count":len(values),
        "metrics":{"routing":metric("routing_correct"),"retrieval_exact":metric("retrieval_exact"),
        "policy_applicability_on_emitted_answers":metric("policy_applicable",emitted),
        "quote_integrity_on_emitted_answers":metric("quote_integrity",emitted),
        "citation_support_on_emitted_answers":metric("answer_supported",emitted),
        "clarification":metric("routing_correct",clarify),"handoff":metric("routing_correct",handoff)},
        "failed_case_ids":[row["id"] for row in rows if not row[engine]["passed"]]}


def run_comparison():
    spec = importlib.util.spec_from_file_location("supportflow_frozen_v1", ROOT / "eval" / "baseline_v1_core.py")
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    original = json.loads((ROOT / "eval" / "cases.json").read_text(encoding="utf-8"))
    challenges = json.loads((ROOT / "eval" / "challenge_cases_v2.json").read_text(encoding="utf-8"))
    fixtures = json.loads((ROOT / "eval" / "fixtures_v2.json").read_text(encoding="utf-8"))
    rows = []
    for case in original + challenges["cases"]:
        snapshot = fixtures["fixtures"][case.get("fixture", "default")]
        legacy = copy.deepcopy(snapshot)
        # v1 represents global scope by an absent region, v2 by explicit 'all'.
        # Adapt the schema, keeping both engines on the same policy contents.
        for doc in legacy["documents"]:
            if doc.get("region") == "all":
                del doc["region"]
        baseline.KB = legacy
        mode = "model" if "selector_ids" in case else "demo"
        if mode == "model":
            info = {"model":"stub-evidence-selection", "latency_ms":0, "usage":{}}
            with patch.object(baseline,"model_select",return_value=(case["selector_ids"],info)), patch.object(core,"model_select",return_value=(case["selector_ids"],info)):
                before = baseline.generate(case["ticket"],case["region"],mode)
                after = generate(case["ticket"],case["region"],mode,knowledge=snapshot)
        else:
            before = baseline.generate(case["ticket"],case["region"],mode)
            after = generate(case["ticket"],case["region"],mode,knowledge=snapshot)
        rows.append({"id":case["id"],"scenario":case["scenario"],"question":case["ticket"],"region":case["region"],
            "fixture":case.get("fixture","default"),"mode":"stub_model_selection" if mode=="model" else "offline_rules",
            "selector_ids":case.get("selector_ids"),"expected":{"status":case["expected_status"],"sources":case["expected_sources"],
                "required_fragments":case.get("required_fragments",[]),"expect_no_claims":case.get("expect_no_claims",False)},
            "baseline":inspect_result(case,before,snapshot),"improved":inspect_result(case,after,snapshot)})
    report = {"project":"SupportFlow", "report_version":"comparison-v2.0", "dataset_version":challenges["version"],
        "evaluated_at_utc":datetime.now(timezone.utc).isoformat(timespec="seconds"),"knowledge_as_of":fixtures["as_of"],
        "provenance":challenges["provenance"],"baseline_version":"v1.0@5aef4cc","improved_version":core.ENGINE_VERSION,
        "retrieval_version":core.RETRIEVAL["version"],"real_model_calls":0,"stub_model_cases":sum(row["mode"]=="stub_model_selection" for row in rows),
        "hashes":{path:digest(path) for path in ("core.py","knowledge.py","evaluate.py","data/retrieval_config.json","eval/cases.json","eval/challenge_cases_v2.json","eval/fixtures_v2.json","eval/baseline_v1_core.py","eval/baseline_v1_knowledge.json")},
        "summary":{"baseline":summarize(rows,"baseline"),"improved":summarize(rows,"improved")},
        "unmeasured":["Live provider connectivity and model selection quality", "Real user acceptance, handling time and commercial impact", "Open-domain semantic entailment and conflict detection beyond the documented rules"],
        "results":rows}
    (ROOT / "eval" / "comparison_v2.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    failures = {"report_version":report["report_version"],"dataset_version":report["dataset_version"],
        "baseline_version":report["baseline_version"],"improved_version":report["improved_version"],"hashes":report["hashes"],
        "cases":[row for row in rows if not row["baseline"]["passed"] or not row["improved"]["passed"]]}
    (ROOT / "eval" / "failure_cases_v2.json").write_text(json.dumps(failures,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    for engine in ("baseline","improved"):
        summary = report["summary"][engine]
        print(f'{engine}: {summary["passed_count"]}/{summary["case_count"]}; failures: {summary["failed_case_ids"]}')
    return all(row["improved"]["passed"] for row in rows)


def run():
    regression_ok = run_regression()
    comparison_ok = run_comparison()
    return regression_ok and comparison_ok

if __name__=="__main__":
    raise SystemExit(0 if run() else 1)

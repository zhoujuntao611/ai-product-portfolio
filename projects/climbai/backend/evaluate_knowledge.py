"""Reproducible, developer-authored lexical retrieval acceptance set.

Run from the project root: python -m backend.evaluate_knowledge --output <path>
These known regression questions are not a blind benchmark or an LLM-quality,
professional-coaching, user-adoption, or training-effect evaluation.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path

from .knowledge import KnowledgeBase, RETRIEVAL_RULES, is_medical_query


PROJECT = Path(__file__).resolve().parent.parent
CASES_PATH = PROJECT / "tests" / "backend" / "knowledge_cases.json"


def load_cases() -> list[dict]:
    return json.loads(CASES_PATH.read_text(encoding="utf-8"))


def evaluate_case(kb: KnowledgeBase, case: dict) -> dict:
    citations = kb.search(case["query"], limit=3)
    actual_ids = [item["id"] for item in citations]
    route = "medical_boundary" if is_medical_query(case["query"]) else "grounded_demo" if citations else "insufficient_evidence"
    checks = {"citation_ids_valid": all(item_id in kb.items for item_id in actual_ids)}
    if "expected_ids" in case:
        checks["required_ids_in_top3"] = set(case["expected_ids"]).issubset(actual_ids)
    if "expected_any_ids" in case:
        checks["one_expected_id_in_top3"] = bool(set(case["expected_any_ids"]) & set(actual_ids))
    if "expected_exact_ids" in case:
        checks["exact_ids_match"] = actual_ids == case["expected_exact_ids"]
    if "expected_first_id" in case:
        checks["first_id_matches"] = bool(actual_ids) and actual_ids[0] == case["expected_first_id"]
    if "expected_route" in case:
        checks["route_matches"] = route == case["expected_route"]
    return {**case, "actual_ids": actual_ids, "actual_route": route, "checks": checks, "passed": all(checks.values())}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    kb = KnowledgeBase()
    results = [evaluate_case(kb, case) for case in load_cases()]
    category_totals = Counter(row["category"] for row in results)
    category_passed = Counter(row["category"] for row in results if row["passed"])
    report = {
        "report_type": "developer_authored_lexical_retrieval_acceptance",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "knowledge_version": kb.version,
        "retrieval_rules_version": RETRIEVAL_RULES["version"],
        "knowledge_count": len(kb.items),
        "retrieval_backend": kb.backend,
        "model_calls": 0,
        "method": "Fixed developer-authored questions; required IDs within top 3, specific-topic first ID where declared, empty results for unsupported questions, K09-only medical boundary, all source IDs resolve.",
        "limitations": [
            "Known regression set authored while implementing lexical rules, not a blind or held-out benchmark.",
            "Checks retrieval and deterministic boundary routing only; not real-model answer correctness or medical classification accuracy.",
            "No real user adoption, task-value, coaching quality, or training outcomes measured.",
            "Native Chroma and real embedding/model services not exercised; local character-hash tie-break used.",
        ],
        "cases_path": "tests/backend/knowledge_cases.json",
        "passed": sum(row["passed"] for row in results),
        "total": len(results),
        "categories": {category: {"passed": category_passed[category], "total": total} for category, total in category_totals.items()},
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"knowledge_version": kb.version, "passed": report["passed"], "total": report["total"], "output": str(args.output)}, ensure_ascii=False))
    for row in results:
        if not row["passed"]:
            print(json.dumps(row, ensure_ascii=False))
    return 0 if report["passed"] == report["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

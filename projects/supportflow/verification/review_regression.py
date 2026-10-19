"""Reproduce the 2026-10-19 review against frozen local v2.0 and current code.

All policies/questions are synthetic, and both databases are disposable. Model
selection is stubbed locally. No provider API is called. This is a development
regression comparison, not an unseen test or measured user outcome.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import urllib.request
from datetime import datetime, timezone
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import core
import knowledge
import server

SPEC_PATH = ROOT / "eval" / "review_cases_v2_1.json"
SPEC = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
DAY = SPEC["as_of"]
FROZEN = ROOT / "eval" / "baseline_v2_0"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def snapshot_for(case):
    snapshot = json.loads((ROOT / "data" / "knowledge.json").read_text(encoding="utf-8"))
    snapshot["snapshot_date"] = DAY
    for source_id, statement in case.get("append", {}).items():
        next(doc for doc in snapshot["documents"] if doc["id"] == source_id)["statements"].append(statement)
    return snapshot


def inspect_answer(case, result, snapshot):
    """Check external expectations/provenance; do not trust engine passed flags."""
    errors = []
    if result["status"] != case["status"]:
        errors.append(f'route: expected {case["status"]}, got {result["status"]}')
    if "expected_region" in case and result["region"] != case["expected_region"]:
        errors.append("inferred region differs")
    if case["status"] != "ready":
        if result["claims"] or result["can_approve"]:
            errors.append("unsupported/context-conflicting request emitted approvable facts")
    else:
        if not result["claims"] or not result["can_approve"]:
            errors.append("supported request has no approvable facts")
        if {doc["id"] for doc in result["sources"]} != set(case["sources"]):
            errors.append("retrieved source set differs")
        text = " ".join(claim["text"] for claim in result["claims"])
        for fragment in case.get("fragments", []):
            if fragment not in text:
                errors.append("missing required fact: " + fragment)
    by_id = {doc["id"]:doc for doc in snapshot["documents"]}
    for claim in result["claims"]:
        doc = by_id.get(claim["source_id"])
        try:
            ident, number = claim["id"].rsplit(":", 1)
            index = int(number) - 1
            consistent = (doc and ident == doc["id"] and 0 <= index < len(doc["statements"])
                and claim["text"] == doc["statements"][index]
                and claim["source_version"] == doc["version"]
                and claim["citation"] == f'[{doc["id"]} §{index + 1}]')
        except (KeyError, ValueError):
            consistent = False
        if not consistent:
            errors.append("claim does not match frozen source text/version/citation")
    return {"passed":not errors,"errors":errors,"actual":result}


def run_quality_case(engine, case):
    snapshot = snapshot_for(case)
    if "selector_ids" in case:
        with patch.object(engine, "model_select", return_value=(case["selector_ids"], {"model":"local-stub", "usage":{}})):
            result = engine.generate(case["question"], case["region"], "model", knowledge=snapshot)
    else:
        result = engine.generate(case["question"], case["region"], knowledge=snapshot)
    return inspect_answer(case, result, snapshot)


def run_workflow_cases(engine, app, store):
    rows = []
    with tempfile.TemporaryDirectory(prefix="supportflow-review-") as directory:
        with patch.object(app, "DB_PATH", Path(directory) / "tickets.sqlite3"), patch.object(store, "STORE_PATH", Path(directory) / "knowledge.json"), patch.object(store, "_today", return_value=DAY):
            app.init_db()
            for action in ("escalate", "reject"):
                ticket = app.create_ticket("合成审核回归", "请问在哪里申请发票？", "unknown", "demo")
                edited = "人工交接稿：请由主管核对发票资料后联系用户。"
                reviewed = app.review_ticket(ticket["id"], action, edited, "需确认资料", ["missing_condition"])
                reloaded = app.get_ticket(ticket["id"])
                exported = next(row for row in app.export_review_examples()["examples"] if row["id"] == ticket["id"])
                checks = {
                    "current_draft_survives_reload":reloaded["current_draft"] == edited,
                    "event_keeps_edited_text":reloaded["audit"][-1]["details"].get("draft") == edited,
                    "export_keeps_text_and_reason":exported["current_draft"] == edited and exported["review_reasons"] == ["missing_condition"],
                    "original_draft_unchanged":exported["original_draft"] == ticket["result"]["draft"],
                    "terminal_state":reviewed["state"] == app.STATES[action],
                }
                rows.append({"id":"W01" if action == "escalate" else "W02", "category":"edited_handoff", "action":action,
                    "expected":"Edited text/reasons survive terminal action, reload and export; original preserved",
                    "passed":all(checks.values()),"checks":checks})
            before = store.get_knowledge()
            doc = {key:copy.deepcopy(value) for key,value in before["documents"][0].items() if key in store.DOCUMENT_FIELDS}
            doc.update(id="REVIEW-ATOMIC", version="1.0")
            invalid = copy.deepcopy(doc)
            invalid.update(id="REVIEW-INVALID")
            invalid.pop("source")
            rejected = False
            try:
                store.import_documents({"documents":[doc, invalid]})
            except ValueError:
                rejected = True
            after = store.get_knowledge()
            checks = {"batch_rejected":rejected,"snapshot_unchanged":after == before,
                "no_partial_document":not any(doc["id"].startswith("REVIEW-") for doc in after["documents"])}
            rows.append({"id":"W03","category":"atomic_import","expected":"Invalid batch does not partially import or change revision", "passed":all(checks.values()),"checks":checks})
            ticket = app.create_ticket("合成版本回归", "请问在哪里申请发票？", "unknown", "demo")
            invoice = next(doc for doc in before["documents"] if doc["id"] == "KB-002")
            replacement = {key:copy.deepcopy(value) for key,value in invoice.items() if key in store.DOCUMENT_FIELDS}
            replacement.update(version="review-2.0", updated=DAY)
            replacement["statements"][1] = "开票申请通常在 4 个工作日内处理；资料错误时需要更正后重新提交。"
            store.update_document("KB-002", replacement)
            blocked = False
            try:
                app.review_ticket(ticket["id"], "approve", ticket["current_draft"], "")
            except ValueError:
                blocked = True
            reloaded = app.get_ticket(ticket["id"])
            fresh = app.create_ticket("新版开票", "开票申请通常多久处理？", "unknown", "demo")
            checks = {"old_approval_blocked":blocked,"old_record_unchanged":reloaded["state"] == "DRAFT" and reloaded["result"] == ticket["result"],
                "fresh_generation_uses_new_version":any(source["id"] == "KB-002" and source["version"] == "review-2.0" for source in fresh["result"]["sources"]),
                "fresh_generation_contains_new_fact":"4 个工作日" in fresh["result"]["draft"]}
            rows.append({"id":"W04","category":"policy_update","expected":"Updated policy blocks old approval, retains old record, and appears in fresh generation", "passed":all(checks.values()),"checks":checks})
            with patch.object(app, "now", return_value="2026-10-19T08:00:00+00:00"):
                tied = [app.create_ticket("同秒工单 " + str(index), "请问在哪里申请发票？", "unknown", "demo") for index in range(3)]
            http = app.ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
            worker = threading.Thread(target=http.serve_forever, daemon=True)
            worker.start()
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{http.server_port}/api/tickets", timeout=4) as response:
                    listed = json.loads(response.read())["tickets"]
            finally:
                http.shutdown()
                http.server_close()
                worker.join()
            identifiers = {ticket["id"] for ticket in tied}
            actual = [ticket["id"] for ticket in listed if ticket["id"] in identifiers]
            expected = [ticket["id"] for ticket in reversed(tied)]
            rows.append({"id":"W05","category":"same_second_history","expected":"Three tickets sharing one timestamp are listed newest insertion first",
                "passed":actual == expected,"actual_ticket_order":actual,"expected_ticket_order":expected})
    return rows


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run():
    manifest = json.loads((FROZEN / "manifest.json").read_text(encoding="utf-8"))
    frozen_intact = all(digest(FROZEN / rel) == expected for rel,expected in manifest["files"].items())
    if not frozen_intact:
        raise ValueError("Frozen v2.0 bytes differ from their recorded hash")
    baseline_core = load("review_frozen_core", FROZEN / "core.py")
    baseline_store = load("review_frozen_knowledge", FROZEN / "knowledge.py")
    baseline_app = load("review_frozen_server", FROZEN / "server.py")
    # server.py's absolute imports bind to current module names. Rebind only
    # these imports to frozen modules; frozen file bytes remain untouched.
    baseline_app.generate = baseline_core.generate
    baseline_app.check_evidence = baseline_core.check_evidence
    baseline_app.knowledge = baseline_store
    results = []
    for case in SPEC["cases"]:
        results.append({"id":case["id"],"category":case["category"],"input":case,
            "baseline":run_quality_case(baseline_core, case),"improved":run_quality_case(core, case)})
    before = run_workflow_cases(baseline_core, baseline_app, baseline_store)
    after = run_workflow_cases(core, server, knowledge)
    for original, fixed in zip(before, after):
        results.append({"id":original["id"],"category":original["category"],"expected":original["expected"],
            "baseline":original,"improved":fixed})
    summary = {}
    for version in ("baseline", "improved"):
        failed = [row["id"] for row in results if not row[version]["passed"]]
        summary[version] = {"passed":len(results)-len(failed),"total":len(results),"failed_case_ids":failed,
            "quality_passed":sum(row[version]["passed"] for row in results if row["id"].startswith(("R", "T", "C", "M"))),
            "quality_total":len(SPEC["cases"]),"workflow_passed":sum(row[version]["passed"] for row in results if row["id"].startswith("W")),"workflow_total":5}
    report = {"evaluated_at_utc":datetime.now(timezone.utc).isoformat(timespec="seconds"),"dataset_version":SPEC["version"],"as_of":DAY,
        "provenance":SPEC["provenance"],"real_model_calls":0,"stub_model_cases":2,"baseline":"local supportflow-v2.0 frozen before 2026-10-19 review fixes",
        "improved":core.ENGINE_VERSION,"frozen_bytes_verified":frozen_intact,
        "baseline_manifest":manifest,"current_hashes":{rel:digest(ROOT / rel) for rel in ("core.py","server.py","knowledge.py","eval/review_cases_v2_1.json","verification/review_regression.py")},
        "summary":summary,"results":results,
        "limits":["All 26 cases are synthetic and participated in diagnosis/development, not a held-out quality estimate", "Four workflow cases already passed in local v2.0; only same-second history ordering is newly fixed", "No real model, customer, time saving, satisfaction or business impact measured", "Time/region gates are explicit lexical rules with incomplete language coverage"]}
    output = ROOT / "verification" / "review-comparison-v2.1.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output":str(output),"summary":summary,"real_model_calls":0},ensure_ascii=False,indent=2))
    return summary["improved"]["passed"] == summary["improved"]["total"]


if __name__ == "__main__":
    raise SystemExit(0 if run() else 1)

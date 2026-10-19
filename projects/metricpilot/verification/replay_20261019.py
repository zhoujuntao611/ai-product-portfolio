"""Replay independently specified task expectations against frozen/current v2.

Run from any directory: python verification/replay_20261019.py --baseline
Then after editing: python verification/replay_20261019.py
The CSV passes through the real preview/mapping/commit entry points. No API calls.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

CASES = [
    {"id":"mixed-quarter-month", "question":"2026年第一季度对比2026年2月净收入", "kind":"date", "group":"new_gap"},
    {"id":"mixed-range-month", "question":"2026-01-01至2026-01-31对比2026年2月净收入", "kind":"date", "group":"new_gap"},
    {"id":"refund-basis-conflict", "question":"2026年2月按退款发生日统计退款金额", "kind":"contract", "group":"new_gap"},
    {"id":"order-basis-conflict", "question":"2026年2月按原订单日统计退款金额", "refund_basis":"refund_date", "kind":"contract", "group":"new_gap"},
    {"id":"unknown-denominator", "question":"2026年1月退款金额占已收款比例", "kind":"metric", "group":"new_gap"},
    {"id":"ambiguous-income-denominator", "question":"2026年1月退款金额占收入比例", "kind":"metric", "group":"new_gap"},
    {"id":"arithmetic-denominator", "question":"2026年1月退款金额占毛收入减退款金额后的比例", "kind":"metric", "group":"new_gap"},
    {"id":"spaced-arithmetic-denominator", "question":"2026年1月退款金额占毛收入 减 退款金额后的比例", "kind":"metric", "group":"new_gap"},
    {"id":"conditional-denominator", "question":"2026年1月退款金额占毛收入中线上部分的比例", "kind":"metric", "group":"new_gap"},
    {"id":"multiplied-denominator", "question":"2026年1月退款金额占毛收入乘2的比例", "kind":"metric", "group":"new_gap"},
    {"id":"punctuated-denominator-condition", "question":"2026年1月退款金额占毛收入，减退款金额后的比例", "kind":"metric", "group":"new_gap"},
    {"id":"known-net-denominator", "question":"2026年1月退款金额占净收入比例", "kind":"metric", "group":"previously_fixed"},
    {"id":"known-multiple-channel", "question":"2026年1月比较organic与paid两个渠道净收入", "kind":"channel", "group":"previously_fixed"},
    {"id":"known-product-scope", "question":"2026年1月比较基础版与团队版两个产品净收入", "kind":"scope", "group":"previously_fixed"},
    {"id":"known-two-quarter", "question":"2026年第一季度对比2026年第二季度净收入", "kind":"date", "group":"previously_fixed"},
    {"id":"known-multiple-metric", "question":"2026年1月净收入和退款金额", "kind":"metric", "group":"previously_fixed"},
    {"id":"positive-refund-basis", "question":"2026年2月按退款发生日统计退款金额", "refund_basis":"refund_date", "metric":"refund_cents", "expected":12000, "group":"positive_control"},
    {"id":"positive-month-comparison", "question":"2026年2月对比2026年1月净收入", "metric":"net_cents", "expected":9010, "group":"positive_control"},
    {"id":"positive-denominator", "question":"2026年1月退款金额占毛收入比例", "metric":"refund_amount_rate", "expected":12000/35000, "group":"positive_control"},
    {"id":"positive-denominator-question", "question":"2026年1月退款金额占毛收入的比例是多少？", "metric":"refund_amount_rate", "expected":12000/35000, "group":"positive_control"},
    {"id":"positive-denominator-spaces", "question":"2026年1月退款金额 / 毛收入 是多少呢？", "metric":"refund_amount_rate", "expected":12000/35000, "group":"positive_control"},
    {"id":"positive-order-denominator-question", "question":"2026年1月退款订单数占订单数的比例是多少？", "metric":"refund_order_rate", "expected":1, "group":"positive_control"},
]


def main():
    cli = argparse.ArgumentParser()
    stages = cli.add_mutually_exclusive_group()
    stages.add_argument("--baseline", action="store_true")
    stages.add_argument("--first-fix", action="store_true", help="Replay the independently reviewed intermediate patch")
    args = cli.parse_args()
    source = ROOT / ("verification/baselines/analytics-v2-before-20261019.py" if args.baseline else "verification/baselines/analytics-v2-first-fix-20261019.py" if args.first_fix else "analytics.py")
    spec = importlib.util.spec_from_file_location("audit_analytics", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    import_source = ROOT / ("verification/baselines/orders-import-v2-before-20261019.py" if args.baseline else "orders_import.py")
    import_spec = importlib.util.spec_from_file_location("audit_orders_import", import_source)
    importer = importlib.util.module_from_spec(import_spec)
    import_spec.loader.exec_module(importer)
    fixture = ROOT / "tests/fixtures/hand-check-orders.csv"
    draft = importer.preview_csv(fixture.read_text(encoding="utf-8"), fixture.name)
    dataset = importer.commit_import(draft, draft["mapping"], {"date_format":"iso", "amount_unit":"major", "currency":"CNY"})
    records = []
    for case in CASES:
        contract = {"confirmed":True, "refund_basis":case.get("refund_basis", "order_date"), "cancelled":"exclude", "cancelled_values":["cancelled"]}
        run = module.run_analysis(case["question"], dataset=dataset, contract=contract)
        actual = {"status":run["status"], "plan":run["plan"], "query_count":len(run["queries"]), "totals":run.get("report",{}).get("totals")}
        if "kind" in case:
            ok = run["status"] == "needs_clarification" and run["plan"].get("kind") == case["kind"] and not run["queries"]
            expected = {"status":"needs_clarification", "kind":case["kind"], "query_count":0}
        else:
            ok = run["status"] == "completed" and run["plan"].get("metric") == case["metric"] and actual["totals"][case["metric"]] == case["expected"]
            expected = {"status":"completed", "metric":case["metric"], "value":case["expected"]}
        records.append({"id":case["id"], "group":case["group"], "question":case["question"], "contract":contract, "expected":expected, "actual":actual, "passed":ok})
    groups = {name:{"total":sum(r["group"] == name for r in records), "passed":sum(r["group"] == name and r["passed"] for r in records)} for name in ["new_gap","previously_fixed","positive_control"]}
    report = {"generated_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(), "stage":"frozen_before" if args.baseline else "first_fix" if args.first_fix else "after", "source":str(source.relative_to(ROOT)), "source_sha256":hashlib.sha256(source.read_bytes()).hexdigest(), "import_source":str(import_source.relative_to(ROOT)), "import_source_sha256":hashlib.sha256(import_source.read_bytes()).hexdigest(), "fixture_sha256":hashlib.sha256(fixture.read_bytes()).hexdigest(), "scope":f"{len(records)} authored offline CSV acceptance tasks; not a representative user sample or model accuracy benchmark.", "external_model_calls":0, "real_users_tested":False, "tasks":len(records), "passed":sum(r["passed"] for r in records), "groups":groups, "cases":records}
    output = ROOT / "verification" / ("20261019-before.json" if args.baseline else "20261019-first-fix.json" if args.first_fix else "20261019-after.json")
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"stage":report["stage"], "passed":report["passed"], "tasks":report["tasks"], "groups":groups}, ensure_ascii=False))
    return 0 if args.baseline or args.first_fix else int(report["passed"] != report["tasks"])


if __name__ == "__main__":
    raise SystemExit(main())

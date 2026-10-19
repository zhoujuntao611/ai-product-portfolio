"""Independent acceptance checks for the single-order-table workflow.

The expected values below are literals from nine hand-checkable orders, never
computed by the application's aggregation or parser.  January excludes A4:
gross = 100 + 200 + 50 = 350; refund = 20 + 50 + 50 = 120.
February event refunds = A0 20 + A1 20 + A2 50 + A5 30 = 120,
while February order count is three; its refund order ratio is 4 / 3.
"""
import copy
import hashlib
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(ROOT))

import analytics
import orders_import


OPTIONS = {"date_format": "iso", "amount_unit": "major", "currency": "CNY"}
MAPPING = {"order_id": "order_id", "order_date": "order_date", "gross_amount": "gross_amount",
           "refund_amount": "refund_amount", "refund_date": "refund_date", "channel": "channel",
           "status": "status", "currency": "currency"}
CONTRACT = {"confirmed": True, "refund_basis": "order_date", "cancelled": "exclude",
            "cancelled_values": ["cancelled"]}


def small_dataset():
    """Fixture construction is deliberately independent of the import module."""
    rows = [
        ("A0", "2025-12-31", 2000, 2000, "2026-02-01", "organic", "completed"),
        ("A1", "2026-01-01", 10000, 2000, "2026-02-03", "organic", "completed"),
        ("A2", "2026-01-15", 20000, 5000, "2026-02-02", "paid", "completed"),
        ("A3", "2026-01-31", 5000, 5000, "2026-01-31", "paid", "refunded"),
        ("A4", "2026-01-31", 8000, 8000, "2026-02-01", "organic", "cancelled"),
        ("A5", "2026-02-01", 12000, 3000, "2026-02-10", "organic", "completed"),
        ("A6", "2026-02-28", 0, 0, None, "paid", "completed"),
        ("A7", "2026-02-28", 10, 0, None, "paid", "completed"),
        ("A8", "2026-03-01", 20, 0, None, "organic", "completed"),
    ]
    keys = ["order_id", "order_date", "gross_cents", "refund_cents", "refund_date", "channel", "status"]
    orders = [{**dict(zip(keys, row)), "source_row": index + 2} for index, row in enumerate(rows)]
    return {"id": "ds_handcheck", "name": "hand-check-orders.csv", "orders": orders,
            "row_count": 9, "date_start": "2025-12-31", "date_end": "2026-03-01",
            "channels": ["organic", "paid"], "currency": "CNY", "amount_unit": "major",
            "mapping": MAPPING.copy(), "decisions": {},
            "source_hash": hashlib.sha256((FIXTURES / "hand-check-orders.csv").read_bytes()).hexdigest(),
            "capabilities": {"refunds": True, "refund_dates": True, "channel": True, "status": True}}


class ImportedAnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.dataset = small_dataset()
        self.contract = copy.deepcopy(CONTRACT)

    def run_q(self, question, filters=None, contract=None):
        return analytics.run_analysis(question, filters=filters, dataset=self.dataset,
                                      contract=self.contract if contract is None else contract)

    def totals(self, question, filters=None):
        run = self.run_q(question, filters)
        self.assertEqual(run["status"], "completed", run)
        return run["report"]["totals"]

    def test_january_order_cohort_amounts_and_denominators(self):
        totals = self.totals("2026年1月净收入")
        self.assertEqual((totals["orders"], totals["gross_cents"], totals["refund_cents"],
                          totals["net_cents"], totals["refund_orders"]), (3, 35000, 12000, 23000, 3))
        self.assertAlmostEqual(totals["refund_amount_rate"], 12 / 35)
        self.assertEqual(totals["refund_order_rate"], 1)

    def test_february_cohort_includes_zero_orders_and_exact_ten_cents(self):
        totals = self.totals("2026年2月净收入")
        self.assertEqual((totals["orders"], totals["gross_cents"], totals["refund_cents"],
                          totals["net_cents"], totals["refund_orders"]), (3, 12010, 3000, 9010, 1))
        self.assertAlmostEqual(totals["refund_amount_rate"], 300 / 1201)
        self.assertAlmostEqual(totals["refund_order_rate"], 1 / 3)

    def test_cancelled_inclusion_is_explicit(self):
        self.contract["cancelled"] = "include"
        totals = self.totals("2026年1月净收入")
        self.assertEqual((totals["orders"], totals["gross_cents"], totals["refund_cents"],
                          totals["net_cents"], totals["refund_orders"]), (4, 43000, 20000, 23000, 4))

    def test_refund_date_event_ledger_includes_older_orders(self):
        self.contract["refund_basis"] = "refund_date"
        totals = self.totals("2026年2月退款订单占比")
        self.assertEqual((totals["orders"], totals["gross_cents"], totals["refund_cents"],
                          totals["net_cents"], totals["refund_orders"]), (3, 12010, 12000, 10, 4))
        self.assertAlmostEqual(totals["refund_amount_rate"], 1200 / 1201)
        self.assertAlmostEqual(totals["refund_order_rate"], 4 / 3)

    def test_refund_only_day_keeps_negative_net_and_undefined_ratios(self):
        self.contract["refund_basis"] = "refund_date"
        totals = self.totals("2026-02-02 至 2026-02-02 净收入")
        self.assertEqual((totals["orders"], totals["gross_cents"], totals["refund_cents"],
                          totals["net_cents"], totals["refund_orders"]), (0, 0, 5000, -5000, 1))
        self.assertIsNone(totals["refund_amount_rate"])
        self.assertIsNone(totals["refund_order_rate"])

    def test_both_date_boundaries_are_inclusive(self):
        totals = self.totals("2026-01-31 至 2026-02-01 毛收入")
        self.assertEqual((totals["orders"], totals["gross_cents"], totals["refund_cents"]), (2, 17000, 8000))

    def test_single_day_zero_gross_denominator(self):
        totals = self.totals("2026-02-28 至 2026-02-28 退款金额占比", {"channel": "paid"})
        self.assertEqual((totals["orders"], totals["gross_cents"], totals["net_cents"]), (2, 10, 10))
        self.assertEqual(totals["refund_amount_rate"], 0)

    def test_empty_day_zero_denominators(self):
        totals = self.totals("2026-01-02 至 2026-01-02 退款金额占比")
        self.assertEqual((totals["orders"], totals["gross_cents"], totals["net_cents"]), (0, 0, 0))
        self.assertIsNone(totals["refund_amount_rate"])
        self.assertIsNone(totals["refund_order_rate"])

    def test_channel_hand_totals(self):
        run = self.run_q("2026年1月渠道净收入对比")
        rows = {row["label"]: row for row in run["report"]["rows"]}
        self.assertEqual(set(rows), {"organic", "paid"})
        self.assertEqual((rows["organic"]["orders"], rows["organic"]["gross_cents"],
                          rows["organic"]["refund_cents"], rows["organic"]["net_cents"]), (1, 10000, 2000, 8000))
        self.assertEqual((rows["paid"]["orders"], rows["paid"]["gross_cents"],
                          rows["paid"]["refund_cents"], rows["paid"]["net_cents"]), (2, 25000, 10000, 15000))
        self.assertAlmostEqual(rows["paid"]["refund_amount_rate"], 2 / 5)

    def test_channel_counts_and_amounts_add_to_total_for_both_date_bases(self):
        for basis in ["order_date", "refund_date"]:
            with self.subTest(basis=basis):
                self.contract["refund_basis"] = basis
                report = self.run_q("2026年2月渠道净收入对比")["report"]
                for metric in ["orders", "gross_cents", "refund_cents", "net_cents", "refund_orders"]:
                    self.assertEqual(sum(row[metric] for row in report["rows"]), report["totals"][metric])

    def test_tool_is_read_only_and_does_not_mutate_uploaded_orders(self):
        before = copy.deepcopy(self.dataset)
        analytics.execute_tool(self.dataset, self.contract,
                               {"period": ["2026-01-01", "2026-01-31"], "dimension": "channel"})
        self.assertEqual(self.dataset, before)

    def test_every_finding_and_row_has_a_query_and_exact_result(self):
        run = self.run_q("2026年1月渠道净收入对比")
        queries = {query["id"]: query for query in run["queries"]}
        self.assertTrue(queries)
        for query in queries.values():
            params = query["params"]
            self.assertEqual(params["period"], ["2026-01-01", "2026-01-31"])
            self.assertIn(params["dimension"], {"summary", "channel"})
            self.assertEqual(query["source_hash"], self.dataset["source_hash"])
            self.assertTrue(isinstance(query["rows"], list))
        for row in run["report"]["rows"] + [run["report"]["totals"]]:
            self.assertIn(row["evidence"], queries)
            raw_rows = queries[row["evidence"]]["rows"]
            self.assertTrue(any(all(raw.get(key) == row.get(key) for key in
                                   ["orders", "gross_cents", "refund_cents", "net_cents"])
                                for raw in raw_rows), row)
        for finding in run["report"]["findings"]:
            self.assertTrue(finding["evidence"])
            self.assertTrue(set(finding["evidence"]) <= set(queries))

    def test_contract_definition_survives_report_serialization(self):
        run = self.run_q("2026年1月净收入")
        report_text = str(run["report"])
        for marker in ["退款", "订单", "CNY"]:
            self.assertIn(marker, report_text)

    def test_explicit_refund_attribution_preserves_event_calculation(self):
        run = self.run_q("2026年2月按退款发生日统计退款金额",
                         contract={**CONTRACT, "refund_basis":"refund_date"})
        self.assertEqual(run["status"], "completed", run)
        self.assertEqual(run["report"]["totals"]["refund_cents"], 12000)
        self.assertTrue(all(q["filters"]["refund_basis"] == "refund_date" for q in run["queries"]))
        # Gross revenue remains attributed to order date in either contract.
        gross = self.run_q("订单日期在2026年2月的毛收入",
                           contract={**CONTRACT, "refund_basis":"refund_date"})
        self.assertEqual(gross["status"], "completed", gross)
        self.assertEqual(gross["report"]["totals"]["gross_cents"], 12010)


class ImportedClarificationTests(unittest.TestCase):
    def setUp(self):
        self.dataset = small_dataset()

    def clarify(self, question, filters=None, contract=None):
        run = analytics.run_analysis(question, filters=filters, dataset=self.dataset,
                                      contract=CONTRACT if contract is None else contract)
        self.assertEqual(run["status"], "needs_clarification", run)
        self.assertTrue(run.get("clarification") or run["plan"].get("clarification"))
        self.assertEqual(run["queries"], [])
        self.assertNotIn("report", run)

    def test_missing_period_is_not_inferred_from_dataset(self):
        self.clarify("渠道净收入对比")

    def test_unsupported_conditions_are_not_silently_ignored(self):
        for question in ["2026年1月毛收入大于100的渠道", "2026年1月每天净收入", "2026年1月净收入排除取消订单"]:
            with self.subTest(question=question):
                self.clarify(question)

    def test_multiple_metrics_and_refund_order_count_are_not_reinterpreted(self):
        self.clarify("2026年1月净收入和退款金额")
        self.clarify("2026年1月退款订单数")

    def test_recent_period_is_not_guessed(self):
        self.clarify("最近退款金额占比")

    def test_missing_refund_rate_denominator(self):
        self.clarify("2026年1月退款率")

    def test_slash_and_division_refund_expressions_keep_ratio_semantics(self):
        for expression, metric, expected in [
            ("退款金额/毛收入", "refund_amount_rate", 12 / 35),
            ("退款金额除以毛收入", "refund_amount_rate", 12 / 35),
            ("退款订单数/订单数", "refund_order_rate", 1),
            ("退款订单数除以订单数", "refund_order_rate", 1),
        ]:
            with self.subTest(expression=expression):
                run = analytics.run_analysis("2026年1月" + expression, dataset=self.dataset, contract=CONTRACT)
                self.assertEqual(run["status"], "completed", run)
                self.assertEqual(run["plan"]["metric"], metric)
                self.assertAlmostEqual(run["report"]["totals"][metric], expected)

    def test_unsupported_order_qualifiers_are_clarified_instead_of_ignored(self):
        for question in ["2026年1月已完成订单毛收入", "2026年1月不含退款的毛收入", "2026年1月未退款订单毛收入"]:
            with self.subTest(question=question):
                self.clarify(question)

    def test_multiple_explicit_refund_denominators_are_not_silently_collapsed(self):
        self.clarify("2026年1月退款金额占比和退款订单占比")

    def test_unsupported_explicit_denominators_are_not_replaced(self):
        for question in ["2026年1月退款金额占订单数比例", "2026年1月退款订单数占毛收入比例",
                         "2026年1月退款金额占净收入比例", "2026年1月渠道毛收入占比"]:
            with self.subTest(question=question):
                self.clarify(question)

    def test_month_span_is_not_silently_treated_as_two_month_comparison(self):
        self.clarify("2026年1月至2026年3月毛收入")

    def test_named_channel_is_applied_or_clarified(self):
        run = analytics.run_analysis("2026年1月organic渠道毛收入", dataset=self.dataset, contract=CONTRACT)
        if run["status"] == "needs_clarification":
            self.assertEqual(run["queries"], [])
        else:
            self.assertEqual(run["report"]["totals"]["gross_cents"], 10000)
            self.assertTrue(all(query["params"]["channel"] == "organic" for query in run["queries"]))

    def test_natural_all_channel_question_is_not_mistaken_for_a_channel_name(self):
        run = analytics.run_analysis("比较各渠道净收入", {"start":"2026-01-01", "end":"2026-01-31"}, self.dataset, CONTRACT)
        self.assertEqual(run["status"], "completed")
        self.assertEqual(run["report"]["totals"]["net_cents"], 23000)

    def test_invalid_month_is_not_normalized(self):
        for question in ["2026年13月净收入", "2026年0月净收入", "2026-02-30 至 2026-03-01 毛收入"]:
            with self.subTest(question=question):
                self.clarify(question)

    def test_quarter_comparison_does_not_ignore_the_second_quarter(self):
        run = analytics.run_analysis("2026年第一季度对比2026年第二季度毛收入",
                                     dataset=self.dataset, contract=CONTRACT)
        if run["status"] == "needs_clarification":
            self.assertEqual(run["queries"], [])
        else:
            self.assertEqual(run["plan"]["periods"],
                             [["2026-01-01", "2026-03-31"], ["2026-04-01", "2026-06-30"]])

    def test_mixed_period_forms_cannot_drop_a_comparison_period(self):
        for question in ["2026年第一季度对比2026年2月净收入",
                         "2026-01-01至2026-01-31对比2026年2月净收入"]:
            with self.subTest(question=question):
                self.clarify(question)

    def test_refund_attribution_conflict_requires_confirmation_before_query(self):
        self.clarify("2026年2月按退款发生日统计退款金额")
        self.clarify("2026年2月按原订单日统计退款金额",
                     contract={**CONTRACT, "refund_basis":"refund_date"})

    def test_unknown_explicit_refund_denominators_cannot_become_gross(self):
        for question in ["2026年1月退款金额占已收款比例", "2026年1月退款金额占收入比例"]:
            with self.subTest(question=question):
                self.clarify(question)

    def test_modified_denominator_is_not_a_valid_standard_prefix(self):
        for question in ["2026年1月退款金额占毛收入减退款金额后的比例",
                         "2026年1月退款金额占毛收入 减 退款金额后的比例",
                         "2026年1月退款金额占毛收入\n减退款金额后的比例",
                         "2026年1月退款金额占毛收入中线上部分的比例",
                         "2026年1月退款金额占毛收入乘2的比例",
                         "2026年1月退款金额占毛收入，减退款金额后的比例"]:
            with self.subTest(question=question):
                self.clarify(question)

    def test_standard_denominator_question_endings_remain_supported(self):
        for question, metric, expected in [
                ("2026年1月退款金额占毛收入的比例是多少？", "refund_amount_rate", 12 / 35),
                ("2026年1月退款金额 / 毛收入 是多少呢？", "refund_amount_rate", 12 / 35),
                ("2026年1月退款订单数占订单数的比例是多少？", "refund_order_rate", 1)]:
            with self.subTest(question=question):
                run = analytics.run_analysis(question, dataset=self.dataset, contract=CONTRACT)
                self.assertEqual(run["status"], "completed", run)
                self.assertEqual(run["plan"]["metric"], metric)
                self.assertAlmostEqual(run["report"]["totals"][metric], expected)

    def test_revenue_without_gross_or_net(self):
        self.clarify("2026年1月收入")

    def test_missing_year(self):
        self.clarify("1月净收入")

    def test_explicit_filter_supplies_period(self):
        run = analytics.run_analysis("渠道净收入对比", {"start": "2026-01-01", "end": "2026-01-31"},
                                     self.dataset, CONTRACT)
        self.assertEqual(run["status"], "completed", run)
        self.assertEqual(run["report"]["totals"]["net_cents"], 23000)

    def test_explicit_filter_supplies_denominator(self):
        run = analytics.run_analysis("2026年1月退款率", {"metric": "refund_order_rate"}, self.dataset, CONTRACT)
        self.assertEqual(run["status"], "completed", run)
        self.assertEqual(run["report"]["totals"]["refund_order_rate"], 1)

    def test_question_filter_period_conflict(self):
        self.clarify("2026年1月净收入", {"start": "2026-02-01", "end": "2026-02-28"})

    def test_question_filter_denominator_conflict(self):
        self.clarify("2026年1月退款金额占比", {"metric": "refund_order_rate"})

    def test_missing_and_unconfirmed_contract(self):
        for contract in [{}, {**CONTRACT, "confirmed": False}]:
            with self.subTest(contract=contract):
                self.clarify("2026年1月净收入", contract=contract)

    def test_refund_and_cancel_choices_are_mandatory(self):
        for field in ["refund_basis", "cancelled"]:
            contract = dict(CONTRACT)
            contract.pop(field)
            with self.subTest(field=field):
                self.clarify("2026年1月净收入", contract=contract)

    def test_refund_date_without_refund_date_field(self):
        self.dataset["capabilities"]["refund_dates"] = False
        self.clarify("2026年1月净收入", contract={**CONTRACT, "refund_basis": "refund_date"})

    def test_missing_channel_cannot_compare_channels(self):
        self.dataset["capabilities"]["channel"] = False
        self.clarify("2026年1月渠道净收入对比")

    def test_missing_refund_cannot_claim_refund_analysis(self):
        self.dataset["capabilities"]["refunds"] = False
        for order in self.dataset["orders"]:
            order["refund_cents"] = None
        self.clarify("2026年1月退款金额占比")

    def test_gross_only_report_keeps_unknown_refunds_in_raw_query(self):
        self.dataset["capabilities"]["refunds"] = False
        for order in self.dataset["orders"]:
            order["refund_cents"] = None
        run = analytics.run_analysis("2026年1月毛收入", dataset=self.dataset, contract=CONTRACT)
        self.assertEqual(run["report"]["totals"]["gross_cents"], 35000)
        self.assertIsNone(run["report"]["totals"]["net_cents"])
        self.assertIsNone(run["queries"][0]["raw_rows"][0]["refund_cents"])

    def test_unsupported_causal_roi_and_behavior_requests(self):
        for question in ["2026年1月净收入增长原因", "2026年1月渠道投放ROI", "2026年1月用户留存行为"]:
            with self.subTest(question=question):
                self.clarify(question)


class ConstrainedOrderToolTests(unittest.TestCase):
    def setUp(self):
        self.dataset = small_dataset()
        self.params = {"period": ["2026-01-01", "2026-01-31"], "dimension": "summary"}

    def deny(self, params):
        with self.assertRaises(ValueError):
            analytics.execute_tool(self.dataset, CONTRACT, params)

    def test_sql_and_unknown_parameters_are_rejected(self):
        for extra in [{"sql": "SELECT * FROM orders"}, {"limit": 999}, {"where": "1=1"}]:
            with self.subTest(extra=extra):
                self.deny({**self.params, **extra})

    def test_dimensions_are_whitelisted(self):
        for dimension in ["product", "DROP TABLE orders", "channel;DELETE", None, 1]:
            with self.subTest(dimension=dimension):
                self.deny({**self.params, "dimension": dimension})

    def test_period_structure_and_real_dates_are_validated(self):
        for period in [[], ["2026-01-01"], ["2026-01-31", "2026-01-01"],
                       ["2026-02-30", "2026-03-01"], ["2026-01-01' OR 1=1--", "2026-01-31"],
                       "2026-01-01", ["2026-01-01", "2026-01-31", "2026-02-01"],
                       ["20260101", "20260131"], ["2026-W01-1", "2026-W02-1"]]:
            with self.subTest(period=period):
                self.deny({**self.params, "period": period})

    def test_channel_parameter_must_match_an_imported_channel(self):
        self.deny({**self.params, "channel": "organic' OR 1=1--"})


class CsvAcceptanceTests(unittest.TestCase):
    def draft(self, name):
        return orders_import.preview_csv((FIXTURES / name).read_text(encoding="utf-8"), name)

    def mapping(self, draft):
        return {key: value for key, value in MAPPING.items() if value in draft["columns"]}

    def check(self, draft, **options):
        return orders_import.check_import(draft, self.mapping(draft), {**OPTIONS, **options})

    def commit(self, draft, **options):
        return orders_import.commit_import(draft, self.mapping(draft), {**OPTIONS, **options})

    def test_template_is_downloadable_valid_single_order_example(self):
        source = ROOT / "templates" / "orders-template.csv"
        draft = orders_import.preview_csv(source.read_text(encoding="utf-8"), source.name)
        dataset = self.commit(draft)
        self.assertEqual(dataset["row_count"], 4)
        self.assertTrue(dataset["capabilities"]["refund_dates"])

    def test_preview_detects_fields_without_changing_source(self):
        draft = self.draft("hand-check-orders.csv")
        self.assertEqual(draft["row_count"], 9)
        self.assertEqual(draft["preview"][7]["gross_amount"], "0.10")
        self.assertEqual(draft["mapping"]["order_id"], "order_id")
        self.assertEqual(draft["mapping"]["gross_amount"], "gross_amount")

    def test_money_stays_exact_and_source_rows_are_preserved(self):
        dataset = self.commit(self.draft("hand-check-orders.csv"))
        lookup = {row["order_id"]: row for row in dataset["orders"]}
        self.assertEqual((lookup["A7"]["gross_cents"], lookup["A8"]["gross_cents"]), (10, 20))
        self.assertEqual(lookup["A0"]["source_row"], 2)
        self.assertEqual(lookup["A8"]["source_row"], 10)
        self.assertEqual(dataset["currency"], "CNY")
        self.assertEqual(dataset["date_start"], "2025-12-31")
        self.assertEqual(dataset["date_end"], "2026-03-01")

    def test_import_requires_explicit_date_unit_and_currency(self):
        draft = self.draft("hand-check-orders.csv")
        for omitted in ["date_format", "amount_unit", "currency"]:
            options = dict(OPTIONS)
            options.pop(omitted)
            with self.subTest(omitted=omitted):
                result = orders_import.check_import(draft, self.mapping(draft), options)
                self.assertFalse(result["can_import"])

    def test_mapping_is_user_reviewable_and_required(self):
        draft = self.draft("hand-check-orders.csv")
        for omitted in ["order_id", "order_date", "gross_amount"]:
            mapping = self.mapping(draft)
            mapping.pop(omitted)
            with self.subTest(omitted=omitted):
                self.assertFalse(orders_import.check_import(draft, mapping, OPTIONS)["can_import"])

    def test_unknown_mapping_column_is_rejected(self):
        draft = self.draft("hand-check-orders.csv")
        mapping = {**self.mapping(draft), "gross_amount": "not_a_column"}
        self.assertFalse(orders_import.check_import(draft, mapping, OPTIONS)["can_import"])

    def test_exact_duplicate_never_silently_dropped(self):
        draft = self.draft("duplicate-orders.csv")
        result = self.check(draft)
        self.assertFalse(result["can_import"])
        self.assertTrue(result["issues"])
        dataset = self.commit(draft, duplicate_policy="drop_exact")
        self.assertEqual(dataset["row_count"], 1)
        self.assertIn("3", str(dataset["decisions"]))

    def test_conflicting_order_ids_never_become_line_item_sums(self):
        draft = self.draft("conflicting-orders.csv")
        for options in [{}, {"duplicate_policy": "drop_exact", "invalid_rows": "exclude"}]:
            with self.subTest(options=options):
                self.assertFalse(self.check(draft, **options)["can_import"])
                with self.assertRaises(ValueError):
                    self.commit(draft, **options)

    def test_invalid_rows_require_explicit_exclusion_and_keep_audit(self):
        draft = self.draft("invalid-orders.csv")
        self.assertFalse(self.check(draft)["can_import"])
        result = self.check(draft, invalid_rows="exclude")
        self.assertTrue(result["can_import"], result)
        self.assertEqual(result["stats"]["excluded_rows"], [3, 4, 5])
        dataset = self.commit(draft, invalid_rows="exclude")
        self.assertEqual(dataset["row_count"], 1)
        self.assertEqual(dataset["orders"][0]["gross_cents"], 1000)
        for source_row in [3, 4, 5]:
            self.assertIn(str(source_row), str(dataset["decisions"]))

    def test_mixed_currency_blocks_instead_of_adding_unlike_amounts(self):
        draft = self.draft("mixed-currencies.csv")
        self.assertFalse(self.check(draft, invalid_rows="exclude")["can_import"])

    def test_ambiguous_dates_need_explicit_format(self):
        draft = self.draft("ambiguous-dates.csv")
        self.assertFalse(self.check(draft)["can_import"])
        dmy = self.commit(draft, date_format="dmy")
        mdy = self.commit(draft, date_format="mdy")
        self.assertEqual(dmy["orders"][0]["order_date"], "2026-02-01")
        self.assertEqual(mdy["orders"][0]["order_date"], "2026-01-02")

    def test_missing_refund_is_not_silently_zeroed(self):
        draft = self.draft("missing-refunds.csv")
        self.assertFalse(self.check(draft)["can_import"])
        dataset = self.commit(draft, missing_refund="zero")
        self.assertEqual(dataset["orders"][0]["refund_cents"], 0)
        self.assertIn("zero", str(dataset["decisions"]))

    def test_absent_refund_field_is_an_explicit_capability(self):
        draft = orders_import.preview_csv("order_id,order_date,gross_amount\nN1,2026-01-01,5.00\n")
        dataset = self.commit(draft)
        self.assertFalse(dataset["capabilities"]["refunds"])
        self.assertIsNone(dataset["orders"][0]["refund_cents"])
        assumed = self.commit(draft, assume_no_refunds=True)
        self.assertTrue(assumed["capabilities"]["refunds"])
        self.assertEqual(assumed["orders"][0]["refund_cents"], 0)

    def test_minor_units_need_integral_values(self):
        draft = orders_import.preview_csv("order_id,order_date,gross_amount,refund_amount\nU1,2026-01-01,10.5,0\n")
        self.assertFalse(self.check(draft, amount_unit="minor")["can_import"])

    def test_major_units_do_not_round_away_fractional_cents(self):
        draft = orders_import.preview_csv("order_id,order_date,gross_amount,refund_amount\nU1,2026-01-01,0.105,0\n")
        self.assertFalse(self.check(draft)["can_import"])

    def test_minor_unit_integer_is_not_multiplied_by_one_hundred(self):
        draft = orders_import.preview_csv("order_id,order_date,gross_amount,refund_amount\nU1,2026-01-01,105,5\n")
        dataset = self.commit(draft, amount_unit="minor")
        self.assertEqual(dataset["orders"][0]["gross_cents"], 105)
        self.assertEqual(dataset["orders"][0]["refund_cents"], 5)

    def test_jpy_major_is_integer_yen_and_report_preserves_currency_scale(self):
        draft = orders_import.preview_csv("order_id,order_date,gross_amount,refund_amount\nJ1,2026-01-01,105,5\n")
        dataset = self.commit(draft, currency="JPY")
        self.assertEqual(dataset["currency_scale"], 1)
        self.assertEqual(dataset["orders"][0]["gross_cents"], 105)
        run = analytics.run_analysis("2026年1月净收入", dataset=dataset, contract={**CONTRACT, "cancelled": "include"})
        self.assertEqual(run["report"]["totals"]["net_cents"], 100)
        self.assertIn("JPY 100", str(run["report"]["findings"]))

    def test_jpy_fractional_major_unit_is_rejected(self):
        draft = orders_import.preview_csv("order_id,order_date,gross_amount,refund_amount\nJ1,2026-01-01,105.50,0\n")
        self.assertFalse(self.check(draft, currency="JPY")["can_import"])

    def test_timestamp_and_spreadsheet_date_serial_are_not_guessed(self):
        for date in ["2026-01-01T12:00:00Z", "46023"]:
            with self.subTest(date=date):
                draft = orders_import.preview_csv(f"order_id,order_date,gross_amount,refund_amount\nT1,{date},10,0\n")
                self.assertFalse(self.check(draft)["can_import"])

    def test_import_limits_and_unsupported_delimiter_are_explained(self):
        for text in ["order_id;order_date;gross_amount\nA;2026-01-01;1\n",
                     "order_id,order_date,gross_amount\n" + "A,2026-01-01,1\n" * 10001,
                     "order_id,order_date,gross_amount\n" + "x" * (2 * 1024 * 1024)]:
            with self.subTest(length=len(text)):
                draft = orders_import.preview_csv(text)
                result = self.check(draft)
                self.assertFalse(result["can_import"])
                self.assertTrue(any(issue["severity"] == "error" for issue in result["issues"]))

    def test_negative_nonfinite_and_over_refunded_amounts_block(self):
        for gross, refund in [("-1", "0"), ("NaN", "0"), ("Infinity", "0"), ("10", "11"), ("10", "-1")]:
            with self.subTest(gross=gross, refund=refund):
                draft = orders_import.preview_csv(
                    f"order_id,order_date,gross_amount,refund_amount\nU1,2026-01-01,{gross},{refund}\n")
                self.assertFalse(self.check(draft)["can_import"])

    def test_csv_shape_errors_are_explained(self):
        for text in ["", "order_id,order_id,order_date,gross_amount\nA,A,2026-01-01,1\n",
                     "order_id,order_date,gross_amount\nA,2026-01-01,1,unexpected\n",
                     'order_id,order_date,gross_amount\n"unclosed,2026-01-01,1\n']:
            with self.subTest(text=text):
                try:
                    draft = orders_import.preview_csv(text)
                except ValueError as exc:
                    self.assertTrue(str(exc))
                else:
                    result = self.check(draft)
                    self.assertFalse(result["can_import"])
                    self.assertTrue(result["issues"])

    def test_import_and_independent_analytics_join_end_to_end(self):
        dataset = self.commit(self.draft("hand-check-orders.csv"))
        run = analytics.run_analysis("2026年1月净收入", dataset=dataset, contract=CONTRACT)
        self.assertEqual(run["status"], "completed", run)
        self.assertEqual(run["report"]["totals"]["net_cents"], 23000)


if __name__ == "__main__":
    unittest.main()

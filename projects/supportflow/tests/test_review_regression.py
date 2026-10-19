"""Customer-question regressions from the 2026-10-19 review; no external model."""
import copy
import json
import unittest
from unittest.mock import patch

import core


class ReviewRegressionTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = json.loads((core.ROOT / "data" / "knowledge.json").read_text(encoding="utf-8"))
        self.snapshot["snapshot_date"] = "2026-10-19"

    def generate(self, question, region="unknown"):
        return core.generate(question, region, knowledge=self.snapshot)

    def stopped(self, result):
        self.assertEqual(result["status"], "needs_context")
        self.assertEqual(result["claims"], [])
        self.assertFalse(result["can_approve"])

    def test_common_mainland_expressions_select_seven_day_policy(self):
        for expression in ("大陆工作区", "大陆用户", "国内用户", "中国内地"):
            with self.subTest(expression=expression):
                result = self.generate(expression + "标准订阅退款的申请期限是多少天？")
                self.assertEqual(result["status"], "ready")
                self.assertEqual(result["region"], "mainland")
                self.assertEqual({source["id"] for source in result["sources"]}, {"KB-003"})
                self.assertIn("7 个自然日", result["draft"])
                self.assertNotIn("14 个自然日", result["draft"])

    def test_alias_in_body_cannot_be_overridden_by_opposite_dropdown(self):
        for question in ("大陆工作区标准订阅退款的申请期限是多少天？", "大陆工作区和海外工作区退款条件分别是什么？"):
            with self.subTest(question=question):
                self.stopped(self.generate(question, "overseas"))

    def test_negated_region_does_not_establish_positive_scope(self):
        for question in ("不是海外的工作区退款申请期限是多少天？", "不在中国大陆的工作区退款申请期限是多少天？"):
            with self.subTest(question=question):
                result = self.generate(question)
                self.stopped(result)
                self.assertEqual(result["region"], "unknown")

    def test_refund_window_does_not_answer_arrival_or_review_time(self):
        for question in ("中国大陆标准订阅退款多久会到账？", "中国大陆标准订阅退款审核要几天？"):
            with self.subTest(question=question):
                self.stopped(self.generate(question, "mainland"))

    def test_export_retention_does_not_answer_generation_time(self):
        self.stopped(self.generate("导出任务多久能完成？"))
        control = self.generate("导出文件保留多久？")
        self.assertEqual(control["status"], "ready")
        self.assertIn("24 小时", control["draft"])

    def test_monthly_quota_is_not_inferred_from_per_minute_rate(self):
        self.stopped(self.generate("API 频率限制为每月多少次？"))
        control = self.generate("API 频率限制为每分钟多少次？")
        self.assertEqual(control["status"], "ready")
        self.assertIn("每分钟 60 次", control["draft"])

    def test_model_must_select_arrival_clause_not_merely_refund_window(self):
        invoice = next(doc for doc in self.snapshot["documents"] if doc["id"] == "KB-003")
        invoice["statements"].append("通过审核的退款通常在 5 个工作日内到账。")
        info = {"model":"stub", "usage":{}}
        for ids, expected in [(["KB-003:1"], "needs_context"), (["KB-003:4"], "ready")]:
            with self.subTest(ids=ids), patch.object(core, "model_select", return_value=(ids, info)):
                result = core.generate("中国大陆标准订阅退款多久会到账？", "mainland", "model", knowledge=self.snapshot)
                self.assertEqual(result["status"], expected)
                if expected == "needs_context":
                    self.stopped(result)
                else:
                    self.assertIn("5 个工作日内到账", result["draft"])

    def test_requested_duration_becomes_answerable_when_supported_fact_exists(self):
        samples = [
            ("KB-005", "导出任务通常在 2 小时内完成。", "导出任务多久能完成？", "unknown"),
            ("KB-003", "退款审核通常在 2 个工作日内完成。", "中国大陆标准订阅退款审核要几天？", "mainland"),
        ]
        for source_id, statement, question, region in samples:
            with self.subTest(question=question):
                snapshot = copy.deepcopy(self.snapshot)
                next(doc for doc in snapshot["documents"] if doc["id"] == source_id)["statements"].append(statement)
                result = core.generate(question, region, knowledge=snapshot)
                self.assertEqual(result["status"], "ready")
                self.assertIn(statement, result["draft"])


if __name__ == "__main__":
    unittest.main()

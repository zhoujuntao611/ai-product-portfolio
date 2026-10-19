"""Regression checks for unsupported attributes and oversized factual drafts.

All inputs and policies are synthetic. These tests call the core directly with a
fixed snapshot; they do not modify the local knowledge store or call a model.
"""
import json
import unittest
from unittest.mock import patch

import core


DAY = "2026-10-18"


class SupportGuardTests(unittest.TestCase):
    def setUp(self):
        self.knowledge = json.loads(
            (core.ROOT / "data" / "knowledge.json").read_text(encoding="utf-8")
        )
        self.knowledge["snapshot_date"] = DAY

    def generate(self, question, region="unknown"):
        return core.generate(question, region, knowledge=self.knowledge)

    def assert_unsupported_stops(self, question, expected_source):
        result = self.generate(question)
        self.assertEqual(result["status"], "needs_context", result["intent_coverage"])
        self.assertFalse(result["can_approve"])
        self.assertEqual(result["claims"], [])
        self.assertEqual({source["id"] for source in result["sources"]}, {expected_source})
        self.assertFalse(result["evidence_validation"]["passed"])
        self.assertTrue(any(item["status"] == "missing" for item in result["intent_coverage"]))
        self.assertNotIn("[" + expected_source + " §", result["draft"])
        for source in result["sources"]:
            for statement in source["statements"]:
                self.assertNotIn(statement, result["draft"])

    def test_existing_invoice_topic_does_not_imply_paper_delivery(self):
        self.assert_unsupported_stops("发票可以邮寄纸质版吗？", "KB-002")
        # Even if another candidate clause mentions delivery, the selected
        # timing clause cannot support that attribute by itself.
        document = next(doc for doc in self.knowledge["documents"] if doc["id"] == "KB-002")
        document["statements"].append("发票可以邮寄纸质版。")
        with patch("core.model_select",return_value=(["KB-002:2"],{"model":"stub","usage":{}})):
            result = core.generate("发票可以邮寄纸质版吗？",mode="model",knowledge=self.knowledge)
        self.assertFalse(result["can_approve"])
        self.assertEqual(result["claims"],[])

    def test_existing_export_topic_does_not_imply_deleted_records_are_included(self):
        self.assert_unsupported_stops("导出数据是否包含已删除记录？", "KB-005")

    def test_existing_export_topic_does_not_imply_deleted_data_recovery(self):
        self.assert_unsupported_stops("CSV导出如何恢复误删的数据？", "KB-005")

    def test_directly_supported_questions_in_the_same_topics_remain_answerable(self):
        samples = [
            ("发票在哪里申请？", "KB-002", "账单 → 已支付订单 → 申请发票"),
            ("开票申请通常多久处理？", "KB-002", "3 个工作日"),
            ("CSV 导出单次上限是多少行？", "KB-005", "50,000 行"),
            ("导出文件保留多久？", "KB-005", "24 小时"),
        ]
        for question, source, fact in samples:
            with self.subTest(question=question):
                result = self.generate(question)
                self.assertEqual(result["status"], "ready", result["intent_coverage"])
                self.assertTrue(result["can_approve"])
                self.assertTrue(result["evidence_validation"]["passed"])
                self.assertEqual({item["id"] for item in result["sources"]}, {source})
                self.assertIn(fact, result["draft"])

    def test_existing_synonym_acceptance_examples_remain_answerable(self):
        samples = [
            ("报销凭证在哪里开具？", "unknown", "KB-002"),
            ("中国大陆工作区的钱能退回来吗？", "mainland", "KB-003"),
            ("请求太密集被拦住了，应该怎么处理？", "unknown", "KB-007"),
            ("我登不进去账号，应该怎么找回口令？", "unknown", "KB-001"),
            ("如何关掉下个月扣款？", "unknown", "KB-008"),
            ("请问如何把表格拉出来？", "unknown", "KB-005"),
        ]
        for question, region, expected_source in samples:
            with self.subTest(question=question):
                result = self.generate(question, region)
                self.assertEqual(result["status"], "ready", result["intent_coverage"])
                self.assertTrue(result["can_approve"])
                self.assertTrue(result["evidence_validation"]["passed"])
                self.assertEqual({source["id"] for source in result["sources"]}, {expected_source})

    def test_valid_long_policy_returns_a_short_handoff_draft_that_can_be_saved(self):
        # Each statement fits the import limit, while quoting all four would
        # exceed the 12,000-character draft and review limit.
        statement = "管理员可在“设置 → 归档”提交申请。" + "归档资料由授权管理员核验。" * 230
        self.assertLessEqual(len(statement), 4000)
        self.assertGreater(len(statement) * 4, 12000)
        document = {
            "id":"LONG-POLICY", "title":"合成归档政策", "category":"archive",
            "source":"合成资料：超长条款回归测试", "version":"1.0", "region":"all",
            "active":True, "updated":"2026-10-01", "effective_from":"2026-10-01",
            "effective_to":None, "keywords":["归档"], "statements":[statement] * 4,
        }
        snapshot = {"product":"合成测试产品", "notice":"合成政策", "revision":1,
                    "snapshot_date":DAY, "documents":[document]}
        result = core.generate("请问归档如何申请？", knowledge=snapshot)
        self.assertEqual(result["status"], "escalate")
        self.assertFalse(result["can_approve"])
        self.assertEqual(result["claims"], [])
        self.assertGreater(len(result["draft"]), 0)
        self.assertLess(len(result["draft"]), 500)
        self.assertLessEqual(len(result["draft"]), 12000)
        self.assertIn("人工", result["draft"])
        self.assertNotIn(statement, result["draft"])
        self.assertTrue(all(item["status"] == "needs_context" for item in result["intent_coverage"]))


if __name__ == "__main__":
    unittest.main()

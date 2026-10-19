"""Independent task-boundary regressions using only synthetic policies.

These expectations describe user-visible correctness rather than mirroring the
retriever's scoring implementation. Model selection is stubbed: these tests do
not make or measure real model calls.
"""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import core
import knowledge


DAY = "2026-10-18"


def policy(ident, category, statements, *, region="all", keywords=None, **changes):
    result = {
        "id":ident, "title":"合成政策 " + ident, "category":category,
        "source":"合成资料：独立边界测试", "version":"1.0", "region":region,
        "active":True, "updated":"2026-10-01", "effective_from":"2026-10-01",
        "effective_to":None, "keywords":keywords or [category], "statements":statements,
    }
    result.update(changes)
    return result


def snapshot(*documents):
    return {"product":"合成测试产品", "notice":"仅使用合成政策", "revision":1,
            "snapshot_date":DAY, "documents":copy.deepcopy(list(documents))}


def seed_snapshot():
    result = json.loads((core.ROOT / "data" / "knowledge.json").read_text(encoding="utf-8"))
    result["snapshot_date"] = DAY
    return result


class RetrievalBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.seed = seed_snapshot()

    def generate(self, question, region="unknown", **kwargs):
        return core.generate(question, region, knowledge=self.seed, **kwargs)

    def model_result(self, question, ids, *, region="unknown", source=None):
        info = {"model":"stub-selection-only", "latency_ms":0, "usage":{}}
        with patch("core.model_select", return_value=(ids, info)) as select:
            result = core.generate(question, region, "model", knowledge=source or self.seed)
        select.assert_called_once()
        return result

    def assert_stopped(self, result):
        detail = {"status":result["status"], "claims":[claim["id"] for claim in result["claims"]], "coverage":result["intent_coverage"]}
        self.assertNotEqual(result["status"], "ready", json.dumps(detail, ensure_ascii=False))
        self.assertFalse(result["can_approve"])
        self.assertEqual(result["claims"], [])

    def test_synonyms_retrieve_the_correct_policy_without_literal_seed_keyword(self):
        samples = [
            ("我登不进去账号，应该怎么找回口令？", "KB-001"),
            ("报销凭证在哪里开具？", "KB-002"),
            ("接口被节流之后应该如何处理？", "KB-007"),
        ]
        for question, expected in samples:
            with self.subTest(question=question):
                result = self.generate(question)
                self.assertEqual(result["status"], "ready", result["intent_coverage"])
                self.assertEqual({doc["id"] for doc in result["sources"]}, {expected})
                self.assertTrue(result["evidence_validation"]["passed"])

    def test_five_topics_preserve_each_question_and_its_evidence(self):
        result = self.generate("发票申请在哪里？CSV 导出最多多少行？Webhook 失败会重试几次？API 频率限制是多少？登录密码如何重置？")
        expected = {"KB-001", "KB-002", "KB-005", "KB-006", "KB-007"}
        self.assertEqual(result["status"], "ready", result["intent_coverage"])
        self.assertEqual({doc["id"] for doc in result["sources"]}, expected)
        self.assertEqual({claim["source_id"] for claim in result["claims"]}, expected)
        self.assertEqual(len(result["intent_coverage"]), 5)
        self.assertTrue(all(q["status"] == "covered" for q in result["intent_coverage"]))

    def test_known_and_unknown_questions_stop_the_entire_draft(self):
        result = self.generate("发票在哪里申请？产品能否把录音变成动画？")
        self.assert_stopped(result)
        self.assertEqual(result["status"], "needs_context")
        self.assertTrue(any(q["status"] == "missing" for q in result["intent_coverage"]))

    def test_unknown_region_cannot_choose_a_local_policy(self):
        result = self.generate("标准订阅退款申请窗口是多少天？")
        self.assert_stopped(result)
        self.assertIn(result["status"], {"needs_context", "conflict"})

    def test_two_regions_in_body_cannot_be_overridden_by_region_dropdown(self):
        result = self.generate("中国大陆和海外工作区的退款条件分别是什么？", "mainland")
        self.assert_stopped(result)
        self.assertEqual(result["status"], "needs_context")

    def test_opposite_body_and_dropdown_region_need_clarification(self):
        result = self.generate("海外工作区的标准退款条件是什么？", "mainland")
        self.assert_stopped(result)
        self.assertEqual(result["status"], "needs_context")

    def test_custom_refund_clarification_does_not_invent_seed_policy_windows(self):
        doc = policy("OWN-REFUND", "refund", ["大陆地区基础套餐可在付款后 5 天内提交退款申请。"], region="mainland", keywords=["退款"])
        result = core.generate("退款的申请窗口是多少？", knowledge=snapshot(doc))
        self.assert_stopped(result)
        self.assertIn(result["status"], {"needs_context", "conflict"})
        for invented in ("7 天", "14 天", "7天", "14天"):
            self.assertNotIn(invented, result["draft"])

    def test_region_specific_policies_never_mix_in_explicit_scope(self):
        common = policy("COMMON", "delivery", ["管理员可在“设置 → 配送”查询配送信息。"], keywords=["配送"])
        local = policy("LOCAL", "delivery", ["大陆地区配送通常需要 3 天。"], region="mainland", keywords=["配送"])
        foreign = policy("FOREIGN", "delivery", ["海外地区配送通常需要 8 天。"], region="overseas", keywords=["配送"])
        result = core.generate("配送通常需要几天？", "mainland", knowledge=snapshot(common, local, foreign))
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual({doc["id"] for doc in result["sources"]}, {"COMMON", "LOCAL"})
        self.assertNotIn("8 天", result["draft"])
        self.assertEqual(core.policy_conflicts([local, foreign]), [])

    def test_same_scope_same_predicate_numeric_conflict_stops_reply(self):
        first = policy("EXPORT-A", "export", ["导出文件保留 24 小时。"], keywords=["导出"])
        second = policy("EXPORT-B", "export", ["导出文件保留 48 小时。"], keywords=["导出"])
        result = core.generate("导出文件保留多久？", knowledge=snapshot(first, second))
        self.assert_stopped(result)
        self.assertEqual(result["status"], "conflict")
        self.assertTrue(result["policy_conflicts"])

    def test_same_document_numeric_contradiction_stops_reply(self):
        doc = policy("INTERNAL", "export", ["导出文件保留 24 小时。", "导出文件保留 48 小时。"], keywords=["导出"])
        result = core.generate("导出文件保留多久？", knowledge=snapshot(doc))
        self.assert_stopped(result)
        self.assertEqual(result["status"], "conflict")
        self.assertEqual(result["policy_conflicts"], [["INTERNAL", "INTERNAL"]])

    def test_same_document_single_statement_contradiction_stops_reply(self):
        doc = policy("CLAUSES", "archive", ["备份文件保留七天；备份文件保留十四天。"], keywords=["备份"])
        result = core.generate("备份文件可以保留多久？", knowledge=snapshot(doc))
        self.assert_stopped(result)
        self.assertEqual(result["status"], "conflict")

    def test_same_document_permission_contradiction_is_not_approved(self):
        doc = policy("PERMISSIONS", "archive", ["允许普通成员下载归档文件。", "禁止普通成员下载归档文件。"], keywords=["归档"])
        result = core.generate("普通成员可以下载归档文件吗？", knowledge=snapshot(doc))
        self.assert_stopped(result)
        self.assertEqual(result["status"], "conflict")

    def test_same_document_different_facts_scopes_and_formats_do_not_conflict(self):
        docs = [
            policy("FACTS", "export", ["导出文件保留 24 小时。", "导出任务通常在 2 小时内生成。"], keywords=["导出"]),
            policy("FORMATS", "export", ["CSV 导出文件保留 24 小时。", "PDF 导出文件保留 48 小时。"], keywords=["导出"]),
            policy("SCOPES", "refund", ["大陆地区退款申请窗口为 7 天。", "海外地区退款申请窗口为 14 天。"], keywords=["退款"]),
        ]
        for doc in docs:
            with self.subTest(document=doc["id"]):
                self.assertEqual(core.policy_conflicts([doc]), [])

    def test_same_document_retry_intervals_are_a_schedule_not_a_conflict(self):
        examples = [
            ["失败后按 1、5、30 分钟间隔重试，最多重试 3 次。"],
            ["失败后 1 分钟重试；失败后 5 分钟重试；失败后 30 分钟重试。"],
            ["首次重试间隔为 1 分钟。", "第二次重试间隔为 5 分钟。", "第三次重试间隔为 30 分钟。"],
        ]
        for statements in examples:
            with self.subTest(statements=statements):
                doc = policy("SCHEDULE", "webhook", statements)
                self.assertEqual(core.policy_conflicts([doc]), [])

    def test_same_document_conflicting_retry_count_is_still_blocked(self):
        doc = policy("RETRY-COUNT", "webhook", ["Webhook 最多重试 3 次。", "Webhook 最多重试 5 次。"])
        self.assertTrue(core.policy_conflicts([doc]))

    def test_same_category_independent_numeric_facts_are_not_policy_conflicts(self):
        retention = policy("RETENTION", "export", ["导出文件保留 24 小时。"], keywords=["导出"])
        processing = policy("PROCESSING", "export", ["导出任务通常在 2 小时内生成。"], keywords=["导出"])
        self.assertEqual(core.policy_conflicts([retention, processing]), [])
        result = core.generate("导出文件保留多久？", knowledge=snapshot(retention, processing))
        self.assertEqual(result["status"], "ready", result)

    def test_seconds_conflict_is_not_missed(self):
        first = policy("HOOK-A", "webhook", ["Webhook 接收端应在 5 秒内返回 HTTP 2xx。"])
        second = policy("HOOK-B", "webhook", ["Webhook 接收端应在 10 秒内返回 HTTP 2xx。"])
        self.assertTrue(core.policy_conflicts([first, second]))
        result = core.generate("Webhook 接收端应在多少秒内返回响应？", knowledge=snapshot(first, second))
        self.assert_stopped(result)
        self.assertEqual(result["status"], "conflict")

    def test_chinese_number_conflict_is_not_missed(self):
        first = policy("CHINESE-A", "retention", ["备份文件保留七天。"], keywords=["备份"])
        second = policy("CHINESE-B", "retention", ["备份文件保留十四天。"], keywords=["备份"])
        self.assertTrue(core.policy_conflicts([first, second]))

    def test_opposite_permission_for_same_operation_is_a_conflict(self):
        first = policy("ALLOW", "archive", ["允许普通成员下载归档文件。"], keywords=["归档"])
        second = policy("DENY", "archive", ["禁止普通成员下载归档文件。"], keywords=["归档"])
        self.assertTrue(core.policy_conflicts([first, second]))

    def test_support_for_different_formats_is_not_a_polarity_conflict(self):
        csv = policy("CSV", "export", ["支持 CSV 格式导出。"], keywords=["导出"])
        pdf = policy("PDF", "export", ["不支持 PDF 格式导出。"], keywords=["导出"])
        self.assertEqual(core.policy_conflicts([csv, pdf]), [])

    def test_model_cannot_answer_invoice_turnaround_with_entry_only(self):
        result = self.model_result("发票多久能处理完成？", ["KB-002:1"])
        self.assert_stopped(result)

    def test_model_cannot_answer_turnaround_paraphrase_with_entry_only(self):
        result = self.model_result("申请发票后什么时候能拿到？", ["KB-002:1"])
        self.assert_stopped(result)

    def test_model_wrong_numeric_fact_cannot_answer_expiry(self):
        result = self.model_result("导出文件的下载链接多久过期？", ["KB-005:2"])
        self.assert_stopped(result)

    def test_model_cannot_answer_row_limit_with_link_retention(self):
        result = self.model_result("CSV 导出单次上限是多少行？", ["KB-005:3"])
        self.assert_stopped(result)

    def test_model_cannot_answer_signature_regeneration_with_ack_deadline(self):
        result = self.model_result("Webhook 签名密钥在哪里重新生成？", ["KB-006:1"])
        self.assert_stopped(result)

    def test_model_must_cover_each_question_across_topics(self):
        result = self.model_result("发票在哪里申请？CSV 导出上限是多少行？", ["KB-002:1"])
        self.assert_stopped(result)

    def test_model_must_cover_each_question_within_one_topic(self):
        result = self.model_result("CSV 导出上限是多少行？下载链接多久过期？", ["KB-005:3"])
        self.assert_stopped(result)

    def test_model_must_cover_two_dimensions_in_one_question(self):
        result = self.model_result("CSV 导出单次上限和下载链接有效期分别是多少？", ["KB-005:3"])
        self.assert_stopped(result)

    def test_model_must_cover_entry_and_turnaround_in_one_question(self):
        result = self.model_result("发票申请入口和处理时效是什么？", ["KB-002:2"])
        self.assert_stopped(result)

    def test_model_must_keep_relevant_role_condition(self):
        doc = policy("OWN-GUARD", "archive", ["管理员可在“设置 → 归档”申请归档。", "归档操作仅限工作区管理员，普通成员不具备该权限。"], keywords=["归档"])
        result = self.model_result("普通成员可以申请归档吗？", ["OWN-GUARD:1"], source=snapshot(doc))
        # The first sentence already carries the administrator restriction. A
        # draft may quote it, or request human confirmation, but must never
        # assert that ordinary members are authorized.
        self.assertNotIn("普通成员可以", result["draft"])
        if result["status"] == "ready":
            self.assertIn("管理员", result["draft"])

    def test_model_must_not_omit_separate_mandatory_limit(self):
        doc = policy("OWN-LIMIT", "archive", ["管理员可在“设置 → 归档”申请归档。", "超过 90 天的项目不得归档。"], keywords=["归档"])
        result = self.model_result("归档如何申请且有什么限制？", ["OWN-LIMIT:1"], source=snapshot(doc))
        self.assert_stopped(result)

    def test_imported_custom_keywords_and_category_are_retrievable(self):
        doc = policy("CUSTOM-ARCHIVE", "tape_archive", ["管理员可在“设置 → 磁带封存”提交申请。", "仅管理员可申请磁带封存。"], keywords=["磁带封存", "冷存申请"])
        self.assertNotIn(doc["category"], core.RETRIEVAL["aliases"])
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "knowledge.json"
            knowledge.import_documents({"documents":[doc]}, filename)
            source = knowledge.get_knowledge(filename, as_of=DAY)
        result = core.generate("磁带封存如何申请？", knowledge=source)
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual({item["id"] for item in result["sources"]}, {doc["id"]})
        self.assertIn("[CUSTOM-ARCHIVE §1]", result["draft"])


class EvidenceApplicabilityTests(unittest.TestCase):
    def setUp(self):
        self.doc = policy("EVIDENCE", "archive", ["管理员可申请归档。"], region="mainland", keywords=["归档"], effective_to="2026-10-20")
        self.claim = {"id":"EVIDENCE:1", "source_id":"EVIDENCE", "source_version":"1.0", "text":self.doc["statements"][0], "citation":"[EVIDENCE §1]"}

    def supported(self, *, claim=None, doc=None, region="mainland", day=DAY):
        checks = core.check_evidence([claim or self.claim], [doc or self.doc], region, day)
        self.assertEqual(len(checks), 1)
        return checks[0]["supported"]

    def test_exact_citation_and_current_applicable_source_are_supported(self):
        self.assertTrue(self.supported())

    def test_tampered_text_statement_number_citation_or_version_are_rejected(self):
        changes = [{"text":"普通成员也能归档。"}, {"id":"EVIDENCE:2"}, {"citation":"[EVIDENCE §2]"}, {"source_version":"0.9"}, {"source_id":"OTHER"}]
        for mutation in changes:
            with self.subTest(mutation=mutation):
                self.assertFalse(self.supported(claim={**self.claim, **mutation}))

    def test_source_version_is_required_for_auditable_support(self):
        claim = copy.deepcopy(self.claim)
        del claim["source_version"]
        self.assertFalse(self.supported(claim=claim))

    def test_changed_source_version_region_or_active_invalidates_saved_claim(self):
        for mutation in [{"version":"2.0"}, {"region":"overseas"}, {"active":False}, {"eligible":False}]:
            with self.subTest(mutation=mutation):
                self.assertFalse(self.supported(doc={**self.doc, **mutation}))

    def test_effective_dates_include_boundaries_but_exclude_outside_days(self):
        self.assertFalse(self.supported(day="2026-09-30"))
        self.assertTrue(self.supported(day="2026-10-01"))
        self.assertTrue(self.supported(day="2026-10-20"))
        self.assertFalse(self.supported(day="2026-10-21"))

    def test_future_dated_update_and_retired_policy_are_not_retrieved(self):
        for mutation in [{"updated":"2026-10-19"}, {"effective_from":"2026-10-19"}, {"effective_to":"2026-10-17"}, {"active":False}]:
            with self.subTest(mutation=mutation):
                source = snapshot({**self.doc, **mutation})
                result = core.generate("归档如何申请？", "mainland", knowledge=source)
                self.assertEqual(result["sources"], [])
                self.assertEqual(result["claims"], [])
                self.assertFalse(result["can_approve"])


if __name__ == "__main__":
    unittest.main()

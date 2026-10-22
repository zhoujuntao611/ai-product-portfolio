import unittest
from unittest.mock import patch
import core


class ContextFromLiveFailures(unittest.TestCase):
    def test_comma_continuation_keeps_subject(self):
        for question,source in [
            ("CSV 下载链接过期了，怎样重新取得数据？","KB-005"),
            ("Webhook 重复推送同一条事件，接收端应怎样去重？","KB-006"),
            ("调用 API 遇到 HTTP 429，按什么方式等待并重试？","KB-007"),
            ("服务故障打不开，向客服提交工单需要收集哪些信息？","KB-009"),
        ]:
            with self.subTest(question=question):
                result=core.generate(question,knowledge=core.KB)
                self.assertEqual(result["status"],"ready",result["intent_coverage"])
                self.assertIn(source,{c["source_id"] for c in result["claims"]})

    def test_payment_background_is_not_an_unanswered_question(self):
        result=core.generate("大陆标准订阅首次付款第六天，退款申请窗口是几个自然日？","mainland",knowledge=core.KB)
        self.assertEqual(result["status"],"ready")
        self.assertIn("7 个自然日",result["draft"])

    def test_invoice_correction_accepts_policy_reference_to_wrong_details(self):
        with patch.object(core,"model_select",return_value=(["KB-002:2"],{"model":"unit-test"})):
            result=core.generate("发票抬头填错了，要怎样更正后再次提交开票申请？",mode="model",knowledge=core.KB)
        self.assertEqual(result["status"],"ready",result["intent_coverage"])

    def test_context_inheritance_does_not_answer_unknown_feature(self):
        result=core.generate("CSV 导出后，怎样离线恢复已经删除的数据？",knowledge=core.KB)
        self.assertNotEqual(result["status"],"ready")
        self.assertEqual(result["claims"],[])

    def test_refund_arrival_is_not_the_application_deadline(self):
        result=core.generate("大陆标准订阅付款后，退款审批通过以后多久能到账？","mainland",knowledge=core.KB)
        self.assertNotEqual(result["status"],"ready")
        self.assertEqual(result["claims"],[])

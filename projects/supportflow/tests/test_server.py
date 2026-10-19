import json
import copy
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch
import server

class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (server.ROOT/"work").mkdir(exist_ok=True)
        cls.temp=tempfile.TemporaryDirectory(dir=server.ROOT/"work")
        cls.db_patch=patch.object(server,"DB_PATH",Path(cls.temp.name)/"test.sqlite3")
        cls.db_patch.start();server.init_db()
        cls.http=server.ThreadingHTTPServer(("127.0.0.1",0),server.Handler)
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
        cls.url=f"http://127.0.0.1:{cls.http.server_port}"
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();cls.thread.join();cls.db_patch.stop();cls.temp.cleanup()
    def setUp(self):
        # Every test has its own policy store; never write the running demo knowledge.
        store_patch=patch.object(server.knowledge,"STORE_PATH",Path(self.temp.name)/(self._testMethodName+".json"))
        store_patch.start();self.addCleanup(store_patch.stop)
    def request(self,path,body=None,headers=None):
        defaults={"Origin":self.url,"X-CSRF-Token":server.CSRF_TOKEN,"Content-Type":"application/json"}
        if headers is not None:defaults=headers
        request=urllib.request.Request(self.url+path,data=json.dumps(body).encode() if body is not None else None,headers=defaults)
        try:
            with urllib.request.urlopen(request,timeout=4) as response:return response.status,json.loads(response.read())
        except urllib.error.HTTPError as error:return error.code,json.loads(error.read())
    def create(self,content="请问在哪里申请发票？",region="unknown"):
        code,data=self.request("/api/tickets",{"title":"测试工单","content":content,"region":region,"mode":"demo"})
        self.assertEqual(code,200,data)
        return data
    def test_health(self):
        code,data=self.request("/api/health")
        self.assertEqual(code,200);self.assertEqual(data["app"],"SupportFlow")
    def test_same_second_tickets_list_newest_insertion_first(self):
        with patch.object(server,"now",return_value="2026-10-19T08:00:00+00:00"):
            created=[self.create() for _ in range(3)]
        code,data=self.request("/api/tickets")
        self.assertEqual(code,200,data)
        identifiers={ticket["id"] for ticket in created}
        listed=[ticket["id"] for ticket in data["tickets"] if ticket["id"] in identifiers]
        self.assertEqual(listed,[ticket["id"] for ticket in reversed(created)])
    def test_create_read_approve_and_persistence(self):
        ticket=self.create();ident=ticket["id"]
        code,saved=self.request(f"/api/tickets/{ident}/review",{"action":"approve","draft":ticket["result"]["draft"],"note":"审核通过"})
        self.assertEqual(code,200);self.assertEqual(saved["state"],"APPROVED_LOCAL")
        self.assertEqual(len(saved["audit"]),2)
        code,read=self.request(f"/api/tickets/{ident}")
        self.assertEqual(code,200);self.assertEqual(read["final_draft"],ticket["result"]["draft"])
        with server.connect() as con:self.assertEqual(con.execute("SELECT state FROM tickets WHERE id=?",(ident,)).fetchone()[0],"APPROVED_LOCAL")
    def test_sensitive_inputs_not_saved_raw(self):
        ticket=self.create("邮箱 me@example.com 手机 13812345678 登录失败，token=private123")
        raw=json.dumps(ticket,ensure_ascii=False)
        for value in ["me@example.com","13812345678","private123"]:self.assertNotIn(value,raw)
    def test_conflicting_policy_cannot_approve(self):
        ticket=self.create("标准订阅可以退款吗？")
        code,data=self.request(f'/api/tickets/{ticket["id"]}/review',{"action":"approve","draft":"强行批准"})
        self.assertEqual(code,400)
        self.assertEqual(server.get_ticket(ticket["id"])["state"],"DRAFT")
    def test_escalate_unknown(self):
        ticket=self.create("能不能自动剪辑我的视频？")
        code,data=self.request(f'/api/tickets/{ticket["id"]}/review',{"action":"escalate","draft":"","note":"待人工"})
        self.assertEqual(code,200);self.assertEqual(data["state"],"ESCALATED")
    def test_human_edit_recorded(self):
        ticket=self.create()
        code,data=self.request(f'/api/tickets/{ticket["id"]}/review',{"action":"approve","draft":"人工修改后的文案","note":"逐项检查"})
        self.assertEqual(code,200);self.assertTrue(data["audit"][-1]["details"]["human_edited"])
        self.assertFalse(data["audit"][-1]["details"]["automatically_validated"])
    def test_repeated_review_rejected(self):
        ticket=self.create();path=f'/api/tickets/{ticket["id"]}/review'
        self.request(path,{"action":"reject","draft":""})
        code,_=self.request(path,{"action":"approve","draft":ticket["result"]["draft"]})
        self.assertEqual(code,400)
    def test_missing_csrf_rejected(self):
        code,_=self.request("/api/tickets",{},headers={"Origin":self.url,"Content-Type":"application/json"})
        self.assertEqual(code,403)
    def test_non_ascii_csrf_rejected_without_disconnecting(self):
        code,data=self.request("/api/tickets",{},headers={"Origin":self.url,
            "Content-Type":"application/json","X-CSRF-Token":"é"})
        self.assertEqual(code,403,data)
        self.assertIn("会话校验失败",data["error"])
    def test_external_origin_rejected(self):
        code,_=self.request("/api/tickets",{},headers={"Origin":"https://evil.example","Content-Type":"application/json","X-CSRF-Token":server.CSRF_TOKEN})
        self.assertEqual(code,403)
    def test_dns_rebinding_host_rejected(self):
        code,_=self.request("/api/session",headers={"Host":"evil.example"})
        self.assertEqual(code,403)
    def test_body_limit(self):
        code,_=self.request("/api/tickets",{"content":"x"*33000})
        self.assertEqual(code,413)
    def test_json_non_object_rejected(self):
        code,_=self.request("/api/tickets",["invalid"])
        self.assertEqual(code,400)
    def test_static_allowlist(self):
        for path in ["/server.py","/work/supportflow.sqlite3","/../data/knowledge.json"]:
            code,_=self.request(path);self.assertEqual(code,404)
    def test_content_security_policy(self):
        with urllib.request.urlopen(self.url+"/") as response:
            self.assertIn("frame-ancestors 'none'",response.headers.get("Content-Security-Policy"))
            self.assertIn(b"SupportFlow",response.read())
    def test_save_edits_and_multiple_review_events_persist(self):
        ticket=self.create();ident=ticket["id"];path=f"/api/tickets/{ident}/review"
        code,saved=self.request(path,{"action":"save","draft":"第一次人工编辑","note":"核对入口","reasons":["incomplete_answer"]})
        self.assertEqual(code,200,saved);self.assertEqual(saved["state"],"DRAFT")
        self.assertEqual(saved["current_draft"],"第一次人工编辑")
        code,saved=self.request(path,{"action":"save","draft":"第二次人工编辑","note":"补上条件","reasons":["missing_condition","incomplete_answer"]})
        self.assertEqual(code,200,saved);self.assertEqual(len(saved["audit"]),3)
        self.assertEqual(saved["audit"][1]["details"]["draft"],"第一次人工编辑")
        self.assertEqual(saved["audit"][2]["details"]["draft"],"第二次人工编辑")
        code,saved=self.request(path,{"action":"escalate","draft":"","note":"由主管确认","reasons":["missing_condition"]})
        self.assertEqual(code,200,saved);self.assertEqual(saved["state"],"ESCALATED")
        self.assertEqual(saved["current_draft"],"第二次人工编辑")
        self.assertEqual(saved["audit"][-1]["details"]["draft"],"第二次人工编辑")
        self.assertEqual(saved["review_reasons"],["missing_condition"])
        with server.connect() as con:
            row=con.execute("SELECT current_draft,review_reasons_json FROM tickets WHERE id=?",(ident,)).fetchone()
            self.assertEqual(row["current_draft"],"第二次人工编辑")
            self.assertEqual(json.loads(row["review_reasons_json"]),["missing_condition"])
    def test_full_length_chinese_review_and_note_fit_json_request(self):
        ticket=self.create();path=f'/api/tickets/{ticket["id"]}/review'
        draft="汉"*12000;note="注"*1000
        # The request helper's default ensure_ascii=True matches valid escaped
        # JSON clients and is larger than the browser's UTF-8 serialization.
        code,data=self.request(path,{"action":"save","draft":draft,"note":note,"reasons":["other"]})
        self.assertEqual(code,200,data)
        self.assertEqual(data["current_draft"],draft)
        self.assertEqual(data["audit"][-1]["details"]["note"],note)
        code,data=self.request(path,{"action":"save","draft":"汉"*12001,"note":""})
        self.assertEqual(code,400,data)
        self.assertIn("12,000",data["error"])
        code,data=self.request(path,{"action":"save","draft":"x"*96000})
        self.assertEqual(code,413,data)
    def test_review_reason_validation_and_terminal_save_rejected(self):
        ticket=self.create();path=f'/api/tickets/{ticket["id"]}/review'
        for reasons in ["missing_condition",["unknown_reason"],[{}],["other"]*6]:
            code,data=self.request(path,{"action":"save","draft":"草稿内容","reasons":reasons})
            self.assertEqual(code,400,data)
        code,saved=self.request(path,{"action":"reject","draft":"保留拒绝前修改","reasons":["source_not_applicable","unsupported_claim"]})
        self.assertEqual(code,200,saved);self.assertEqual(saved["current_draft"],"保留拒绝前修改")
        code,_=self.request(path,{"action":"save","draft":"已完成后再次编辑"})
        self.assertEqual(code,400)
    def test_policy_import_validation_update_history_and_deactivation(self):
        code,snapshot=self.request("/api/knowledge")
        self.assertEqual(code,200,snapshot)
        doc={key:copy.deepcopy(value) for key,value in snapshot["documents"][0].items() if key in server.knowledge.DOCUMENT_FIELDS}
        doc.update(id="CUSTOM-001",title="专属演示额度",category="custom_quota",source="授权脱敏客服手册",version="1.0",region="all",active=True,
            effective_from="2026-01-01",effective_to=None,updated="2026-10-01",keywords=["专属演示额度"],
            statements=["专属演示额度为每月 20 次，仅适用于授权测试账户。"])
        bad=copy.deepcopy(doc);bad.pop("source")
        code,data=self.request("/api/knowledge/import",{"documents":[bad]})
        self.assertEqual(code,400,data);self.assertIn("source",data["error"])
        code,imported=self.request("/api/knowledge/import",{"documents":[doc]})
        self.assertEqual(code,200,imported);self.assertNotEqual(imported["revision"],snapshot["revision"])
        own_question=self.create("专属演示额度是多少？")
        self.assertEqual(own_question["result"]["status"],"ready")
        self.assertIn("20 次",own_question["result"]["draft"])
        self.assertEqual([source["id"] for source in own_question["result"]["sources"]],["CUSTOM-001"])
        changed=copy.deepcopy(doc);changed.update(version="2.0",statements=["专属演示额度为每月 25 次，仅适用于授权测试账户。"])
        code,updated=self.request("/api/knowledge/CUSTOM-001/versions",{"document":changed})
        self.assertEqual(code,200,updated)
        fresh_question=self.create("专属演示额度是多少？")
        self.assertIn("25 次",fresh_question["result"]["draft"])
        self.assertNotIn("20 次",fresh_question["result"]["draft"])
        self.assertEqual(fresh_question["result"]["sources"][0]["version"],"2.0")
        code,history=self.request("/api/knowledge/CUSTOM-001/history")
        self.assertEqual(code,200,history);self.assertEqual({d["version"] for d in history["versions"]},{"1.0","2.0"})
        code,disabled=self.request("/api/knowledge/CUSTOM-001/deactivate",{})
        self.assertEqual(code,200,disabled)
        current=next(d for d in disabled["documents"] if d["id"]=="CUSTOM-001")
        self.assertFalse(current["active"]);self.assertFalse(current["eligible"])
        self.assertEqual(server.knowledge.get_knowledge()["revision"],disabled["revision"])
        self.assertEqual(self.create("专属演示额度是多少？")["result"]["status"],"unknown")
    def test_changed_knowledge_revision_blocks_approval(self):
        ticket=self.create();snapshot=server.knowledge.get_knowledge()
        doc={key:copy.deepcopy(value) for key,value in next(d for d in snapshot["documents"] if d["id"]=="KB-002").items() if key in server.knowledge.DOCUMENT_FIELDS}
        doc["version"]="9.9"
        code,_=self.request("/api/knowledge/KB-002/versions",{"document":doc})
        self.assertEqual(code,200)
        code,data=self.request(f'/api/tickets/{ticket["id"]}/review',{"action":"approve","draft":ticket["result"]["draft"]})
        self.assertEqual(code,400,data);self.assertIn("重新生成",data["error"])
        self.assertEqual(server.get_ticket(ticket["id"])["state"],"DRAFT")
        fresh=self.create()
        code,data=self.request(f'/api/tickets/{fresh["id"]}/review',{"action":"approve","draft":fresh["result"]["draft"]})
        self.assertEqual(code,200,data)
    def test_same_revision_expired_source_blocks_approval(self):
        ticket=self.create();snapshot=server.knowledge.get_knowledge()
        expired=copy.deepcopy(snapshot)
        for doc in expired["documents"]:
            if doc["id"]=="KB-002":doc.update(eligible=False,current_status="expired")
        with patch.object(server.knowledge,"get_knowledge",return_value=expired):
            with self.assertRaisesRegex(ValueError,"生效期"):
                server.review_ticket(ticket["id"],"approve",ticket["result"]["draft"],"")
    def test_current_evidence_region_rechecked_at_approval(self):
        ticket=self.create(region="overseas");snapshot=server.knowledge.get_knowledge()
        altered=copy.deepcopy(snapshot)
        for doc in altered["documents"]:
            if doc["id"]=="KB-002":doc["region"]="mainland"
        with patch.object(server.knowledge,"get_knowledge",return_value=altered):
            with self.assertRaisesRegex(ValueError,"适用依据"):
                server.review_ticket(ticket["id"],"approve",ticket["result"]["draft"],"")
    def test_deactivated_policy_blocks_existing_draft(self):
        ticket=self.create()
        code,_=self.request("/api/knowledge/KB-002/deactivate",{})
        self.assertEqual(code,200)
        code,data=self.request(f'/api/tickets/{ticket["id"]}/review',{"action":"approve","draft":ticket["result"]["draft"]})
        self.assertEqual(code,400,data)
        fresh=self.create()
        self.assertFalse(fresh["result"]["can_approve"])
        self.assertNotIn("KB-002",[source["id"] for source in fresh["result"]["sources"]])
    def test_review_export_preserves_versions_and_redacts_text(self):
        ticket=self.create("邮箱 export@example.com 手机 13900001111 请问在哪里申请发票？")
        code,saved=self.request(f'/api/tickets/{ticket["id"]}/review',{"action":"save",
            "draft":"修改发给 reviewer@example.com token=private-export", "note":"联系 13822223333", "reasons":["missing_condition"]})
        self.assertEqual(code,200,saved)
        code,data=self.request("/api/review-examples")
        self.assertEqual(code,200,data)
        example=next(row for row in data["examples"] if row["id"]==ticket["id"])
        self.assertEqual(example["review_reasons"],["missing_condition"])
        self.assertEqual(example["generated_result"]["knowledge_revision"],ticket["result"]["knowledge_revision"])
        self.assertTrue(example["generated_result"]["sources"][0]["version"])
        self.assertEqual(example["original_draft"],ticket["result"]["draft"])
        self.assertNotEqual(example["original_draft"],example["current_draft"])
        raw=json.dumps(example,ensure_ascii=False)
        for value in ["export@example.com","reviewer@example.com","13900001111","13822223333","private-export"]:
            self.assertNotIn(value,raw)
    def test_knowledge_mutations_require_csrf_and_missing_ids_return_404(self):
        for path,body in [("/api/knowledge/import",{"documents":[]}),
            ("/api/knowledge/KB-002/deactivate",{}),("/api/knowledge/KB-002/versions",{})]:
            code,_=self.request(path,body,headers={"Origin":self.url,"Content-Type":"application/json"})
            self.assertEqual(code,403)
        code,_=self.request("/api/knowledge/MISSING/history")
        self.assertEqual(code,404)
        code,_=self.request("/api/knowledge/MISSING/deactivate",{})
        self.assertEqual(code,404)
    def test_legacy_database_migrates_without_losing_ticket(self):
        old_path=Path(self.temp.name)/"legacy.sqlite3"
        with patch.object(server,"DB_PATH",old_path):
            with server.connect() as con:
                con.execute("""CREATE TABLE tickets (id TEXT PRIMARY KEY,title TEXT NOT NULL,input_redacted TEXT NOT NULL,
                    result_json TEXT NOT NULL,state TEXT NOT NULL,final_draft TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)""")
                result={"draft":"旧版草稿"}
                con.execute("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?)",("0"*12,"旧工单","旧输入",json.dumps(result),"DRAFT",None,"2026-01-01","2026-01-01"))
            server.init_db();server.init_db()
            ticket=server.get_ticket("0"*12)
            self.assertEqual(ticket["current_draft"],"旧版草稿");self.assertEqual(ticket["review_reasons"],[])

if __name__=="__main__":unittest.main()

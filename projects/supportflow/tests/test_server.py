import json
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

if __name__=="__main__":unittest.main()

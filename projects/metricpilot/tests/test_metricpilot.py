"""Independent business expectations, adversarial SQL, and local model stubs."""
import contextlib
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request,urlopen

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import legacy as app  # Archived synthetic-v1 regression; v2 is tested separately.


class FixtureCase(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.db=Path(self.temp.name)/"fixture.sqlite3"
        con=sqlite3.connect(self.db)
        con.executescript("CREATE TABLE products(product_id TEXT PRIMARY KEY,name TEXT,unit_price_cents INTEGER); CREATE TABLE orders(order_id TEXT,order_date TEXT,product_id TEXT,channel TEXT,quantity INTEGER,unit_price_cents INTEGER,refund_cents INTEGER);")
        con.executemany("INSERT INTO products VALUES (?,?,?)",[("starter","Starter 基础版",10000),("team","Team 团队版",20000)])
        con.executemany("INSERT INTO orders VALUES (?,?,?,?,?,?,?)",[("A1","2026-09-01","starter","organic",2,10000,0),("A2","2026-09-02","team","paid",3,20000,10000),("A3","2026-09-03","starter","paid",1,10000,10000),("A4","2026-08-31","team","organic",1,20000,0)])
        con.commit();con.close()
    def tearDown(self): self.temp.cleanup()
    def run_q(self,q,filters=None,mode="demo"): return app.run_analysis(q,filters,mode,self.db)


class NumericTests(FixtureCase):
    def test_01_exact_net(self): self.assertEqual(self.run_q("2026年9月净收入")["report"]["totals"]["net_cents"],70000)
    def test_02_exact_gross(self): self.assertEqual(self.run_q("2026年9月毛收入")["report"]["totals"]["gross_cents"],90000)
    def test_03_exact_refunds(self): self.assertEqual(self.run_q("2026年9月退款金额")["report"]["totals"]["refund_cents"],20000)
    def test_04_order_count(self): self.assertEqual(self.run_q("2026年9月订单数")["report"]["totals"]["orders"],3)
    def test_05_units_count(self): self.assertEqual(self.run_q("2026年9月授权席位数")["report"]["totals"]["units"],6)
    def test_06_amount_rate_denominator(self): self.assertAlmostEqual(self.run_q("2026年9月退款金额占比")["report"]["totals"]["refund_amount_rate"],2/9)
    def test_07_order_rate_denominator(self): self.assertAlmostEqual(self.run_q("2026年9月退款订单率")["report"]["totals"]["refund_order_rate"],2/3)
    def test_08_product_group_exact(self):
        rows=self.run_q("2026年9月产品净收入对比")["report"]["rows"]
        self.assertEqual({x["label"]:x["net_cents"] for x in rows},{"Starter 基础版":20000,"Team 团队版":50000})
    def test_09_channel_group_exact(self):
        rows=self.run_q("2026年9月渠道净收入对比")["report"]["rows"]
        self.assertEqual({x["label"]:x["net_cents"] for x in rows},{"自然流量":20000,"付费投放":50000})
    def test_10_groups_equal_total(self):
        r=self.run_q("2026年9月渠道净收入对比")["report"]
        for field in ["orders","units","net_cents","gross_cents","refund_cents"]: self.assertEqual(sum(x[field] for x in r["rows"]),r["totals"][field])
    def test_11_quarter_boundary(self): self.assertEqual(self.run_q("2026年第三季度净收入")["report"]["totals"]["net_cents"],90000)
    def test_12_comparison_exact(self):
        r=self.run_q("2026年9月对比2026年8月净收入")["report"]
        self.assertEqual([x["net_cents"] for x in r["rows"]],[70000,20000]);self.assertIn("+250.00%",r["findings"][0]["text"])
    def test_13_product_filter_exact(self): self.assertEqual(self.run_q("2026年9月净收入",{"product":"team"})["report"]["totals"]["net_cents"],50000)
    def test_14_channel_filter_exact(self): self.assertEqual(self.run_q("2026年9月净收入",{"channel":"organic"})["report"]["totals"]["net_cents"],20000)
    def test_15_date_range_inclusive(self): self.assertEqual(self.run_q("2026-09-01 至 2026-09-02 净收入")["report"]["totals"]["net_cents"],70000)
    def test_16_zero_denominator(self):
        r=self.run_q("2026年7月退款金额占比")["report"]
        self.assertIsNone(r["totals"]["refund_amount_rate"]);self.assertEqual(r["totals"]["orders"],0);self.assertEqual(r["totals"]["units"],0)
    def test_17_empty_group_result(self):
        r=self.run_q("2026年7月产品净收入对比")["report"]
        self.assertEqual(r["rows"],[]);self.assertEqual(r["totals"]["net_cents"],0)
    def test_18_evidence_exists(self):
        run=self.run_q("2026年9月渠道净收入对比");ids={q["id"] for q in run["queries"]}
        for f in run["report"]["findings"]: self.assertTrue(set(f["evidence"])<=ids)
        self.assertTrue(all(r["evidence"] in ids for r in run["report"]["rows"]))
    def test_19_source_tables_bound(self):
        run=self.run_q("2026年9月产品净收入")
        self.assertTrue(all(set(q["source_tables"])=={"orders","products"} for q in run["queries"]))
    def test_20_seed_expected_total(self):
        seed=Path(self.temp.name)/"seed.sqlite3";app.seed_database(seed)
        result=app.read_sql("SELECT COUNT(*) n, MIN(order_date) first_date, MAX(order_date) last_date FROM orders",path=seed)["rows"][0]
        self.assertEqual(result,{"n":2457,"first_date":"2026-01-01","last_date":"2026-09-30"})
    def test_21_seed_month_literal(self):
        seed=Path(self.temp.name)/"seed.sqlite3";app.seed_database(seed)
        total=app.run_analysis("2026年9月净收入",path=seed)["report"]["totals"]
        self.assertEqual((total["orders"],total["net_cents"]),(270,42000850))
    def test_71_count_comparison_not_currency(self):
        text=self.run_q("2026年9月对比2026年8月订单数")["report"]["findings"][0]["text"]
        self.assertIn("增加 2",text);self.assertNotIn("¥",text)
    def test_72_rate_comparison_percentage_points(self):
        text=self.run_q("2026年9月对比2026年8月退款金额占比")["report"]["findings"][0]["text"]
        self.assertIn("+22.22 个百分点",text);self.assertNotIn("相对变化",text)


class ClarificationTests(FixtureCase):
    def clarify(self,q,kind,filters=None):
        r=self.run_q(q,filters);self.assertEqual(r["status"],"needs_clarification");self.assertEqual(r["plan"]["kind"],kind);self.assertEqual(r["queries"],[])
    def test_22_recent_date(self): self.clarify("最近渠道净收入","date")
    def test_23_month_without_year(self): self.clarify("9月渠道净收入","date")
    def test_24_ambiguous_revenue(self): self.clarify("2026年9月收入","metric")
    def test_25_ambiguous_refund_rate(self): self.clarify("2026年9月退款率","metric")
    def test_26_omitted_year_comparison(self): self.clarify("2026年9月与8月净收入对比","date")
    def test_27_implicit_previous_month(self): self.clarify("2026年9月净收入环比","date")
    def test_28_outside_dataset(self): self.clarify("2026年10月净收入","date")
    def test_29_reverse_dates(self): self.clarify("2026-09-30 至 2026-09-01 净收入","date")
    def test_30_invalid_date(self): self.clarify("2026-09-31 至 2026-09-31 净收入","date")
    def test_31_multiple_main_metrics(self): self.clarify("2026年9月毛收入与净收入对比","metric")
    def test_32_explicit_filter_dates(self): self.assertEqual(self.run_q("渠道净收入",{"start":"2026-09-01","end":"2026-09-30"})["status"],"completed")
    def test_33_filter_denominator_resolution(self): self.assertEqual(self.run_q("2026年9月退款率",{"metric":"refund_amount_rate"})["report"]["metric"],"refund_amount_rate")
    def test_34_empty_question(self):
        with self.assertRaises(ValueError): self.run_q("")
    def test_35_invalid_channel(self):
        with self.assertRaises(ValueError): self.run_q("2026年9月净收入",{"channel":"madeup"})


class SecurityTests(FixtureCase):
    def deny(self,sql):
        with self.assertRaises(app.QueryError): app.read_sql(sql,path=self.db)
        self.assertEqual(app.read_sql("SELECT COUNT(*) n FROM orders",path=self.db)["rows"][0]["n"],4)
    def test_36_update(self): self.deny("UPDATE orders SET refund_cents=0")
    def test_37_delete(self): self.deny("DELETE FROM orders")
    def test_38_insert(self): self.deny("INSERT INTO orders VALUES ('X','2026-09-01','team','paid',1,1,0)")
    def test_39_drop(self): self.deny("DROP TABLE orders")
    def test_40_with_write(self): self.deny("WITH x AS (SELECT 1) UPDATE orders SET quantity=10")
    def test_41_attach(self): self.deny("ATTACH DATABASE ':memory:' AS secret")
    def test_42_pragma(self): self.deny("PRAGMA writable_schema=ON")
    def test_43_multi_statement(self): self.deny("SELECT * FROM orders; DELETE FROM orders")
    def test_44_system_schema(self): self.deny("SELECT * FROM sqlite_master")
    def test_45_readfile(self): self.deny("SELECT readfile('C:/Windows/win.ini')")
    def test_46_load_extension(self): self.deny("SELECT load_extension('x')")
    def test_47_recursion(self): self.deny("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n) SELECT MAX(x) FROM n")
    def test_48_blob_resource(self): self.deny("SELECT hex(zeroblob(100000000))")
    def test_49_row_limit(self):
        with self.assertRaises(app.QueryError): app.read_sql("SELECT * FROM orders",path=self.db,max_rows=2)
    def test_50_parameterized_quote(self):
        rows=app.read_sql("SELECT * FROM orders WHERE channel=?",["paid' OR 1=1 --"],path=self.db)["rows"]
        self.assertEqual(rows,[])
    def test_51_sql_timeout(self):
        with self.assertRaises(app.QueryError): app.read_sql("SELECT SUM(a.quantity*b.quantity*c.quantity*d.quantity*e.quantity*f.quantity*g.quantity*h.quantity) FROM orders a,orders b,orders c,orders d,orders e,orders f,orders g,orders h",path=self.db,timeout=0.000001)


@contextlib.contextmanager
def stub_model(responses):
    class Stub(BaseHTTPRequestHandler):
        calls=[]
        def log_message(self,*args): pass
        def do_POST(self):
            data=json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            self.calls.append(data)
            answer=responses[min(len(self.calls)-1,len(responses)-1)]
            body=json.dumps({"choices":[{"message":answer}]}).encode()
            self.send_response(200);self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(body)));self.end_headers();self.wfile.write(body)
    server=ThreadingHTTPServer(("127.0.0.1",0),Stub);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    with patch.dict(os.environ,{"METRICPILOT_API_KEY":"local-test-placeholder","METRICPILOT_BASE_URL":f"http://127.0.0.1:{server.server_port}/v1","METRICPILOT_MODEL":"local-stub"}):
        try: yield Stub
        finally: server.shutdown();server.server_close();thread.join()


def tool_response(*args):
    return {"role":"assistant","content":None,"tool_calls":[{"id":f"call{i}","type":"function","function":{"name":"query_sales","arguments":json.dumps(a)}} for i,a in enumerate(args)]}


class ModelAdapterTests(FixtureCase):
    def test_52_model_tool_call(self):
        with stub_model([tool_response({"period_index":0,"dimension":"channel"},{"period_index":0,"dimension":"summary"})]) as model:
            run=self.run_q("2026年9月渠道净收入",mode="llm")
            self.assertEqual(run["report"]["totals"]["net_cents"],70000);self.assertEqual(len(run["queries"]),2);self.assertIn("tools",model.calls[0])
    def test_53_model_reverse_order(self):
        with stub_model([tool_response({"period_index":0,"dimension":"summary"},{"period_index":0,"dimension":"channel"})]):
            run=self.run_q("2026年9月渠道净收入",mode="llm")
            self.assertEqual(len(run["report"]["rows"]),2);self.assertEqual(run["report"]["totals"]["net_cents"],70000)
    def test_54_model_tool_results_roundtrip(self):
        responses=[tool_response({"period_index":0,"dimension":"channel"}),tool_response({"period_index":0,"dimension":"summary"})]
        with stub_model(responses) as model:
            self.run_q("2026年9月渠道净收入",mode="llm")
            result=json.loads(next(x for x in model.calls[1]["messages"] if x["role"]=="tool")["content"])
            self.assertEqual(sum(x["net_cents"] for x in result["rows"]),70000)
    def test_55_model_unexecuted_claim_rejected(self):
        with stub_model([{"role":"assistant","content":"收入是100亿元","tool_calls":[]}]) as model:
            with self.assertRaises(ValueError): self.run_q("2026年9月渠道净收入",mode="llm")
            self.assertEqual(len(model.calls),6)
    def test_56_repeated_tool_bounded(self):
        with stub_model([tool_response({"period_index":0,"dimension":"channel"})]) as model:
            with self.assertRaises(ValueError): self.run_q("2026年9月渠道净收入",mode="llm")
            self.assertEqual(len(model.calls),6)
    def test_57_invalid_tool_scope(self):
        with stub_model([tool_response({"period_index":99,"dimension":"channel"})]):
            with self.assertRaises(ValueError): self.run_q("2026年9月渠道净收入",mode="llm")
    def test_58_malformed_arguments(self):
        bad={"role":"assistant","content":None,"tool_calls":[{"id":"x","type":"function","function":{"name":"query_sales","arguments":"not JSON"}}]}
        with stub_model([bad]):
            with self.assertRaises(ValueError): self.run_q("2026年9月渠道净收入",mode="llm")
    def test_59_timeout_no_report(self):
        with patch.dict(os.environ,{"METRICPILOT_API_KEY":"placeholder","METRICPILOT_BASE_URL":"https://example.invalid/v1","METRICPILOT_MODEL":"stub"}),patch.object(app,"urlopen",side_effect=TimeoutError):
            with self.assertRaises(ValueError): self.run_q("2026年9月渠道净收入",mode="llm")
    def test_60_http_remote_refused(self):
        with patch.dict(os.environ,{"METRICPILOT_API_KEY":"placeholder","METRICPILOT_BASE_URL":"http://example.invalid/v1","METRICPILOT_MODEL":"stub"}):
            with self.assertRaises(ValueError): self.run_q("2026年9月渠道净收入",mode="llm")
    def test_61_missing_config(self):
        with patch.dict(os.environ,{"METRICPILOT_API_KEY":"","METRICPILOT_BASE_URL":"","METRICPILOT_MODEL":""}):
            with self.assertRaises(ValueError): self.run_q("2026年9月渠道净收入",mode="llm")
    def test_62_redirect_not_followed(self):
        class Redirect(BaseHTTPRequestHandler):
            requests=0
            def log_message(self,*args): pass
            def do_POST(self):
                type(self).requests+=1
                self.rfile.read(int(self.headers.get("Content-Length",0)))
                self.send_response(302);self.send_header("Location",f"http://127.0.0.1:{self.server.server_port}/secret");self.end_headers()
            def do_GET(self):
                type(self).requests+=1
                self.send_response(200);self.end_headers()
        server=ThreadingHTTPServer(("127.0.0.1",0),Redirect);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with patch.dict(os.environ,{"METRICPILOT_API_KEY":"test-only","METRICPILOT_BASE_URL":f"http://127.0.0.1:{server.server_port}/v1","METRICPILOT_MODEL":"stub"}):
                with self.assertRaises(ValueError): self.run_q("2026年9月渠道净收入",mode="llm")
            self.assertEqual(Redirect.requests,1)
        finally: server.shutdown();server.server_close();thread.join()


class HttpBoundaryTests(unittest.TestCase):
    def setUp(self):
        app.seed_database()
        self.temp=tempfile.TemporaryDirectory()
        self.session_patch=patch.object(app,"SESSION_PATH",Path(self.temp.name)/"sessions.json");self.session_patch.start()
        self.server=ThreadingHTTPServer(("127.0.0.1",0),app.Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base=f"http://127.0.0.1:{self.server.server_port}"
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.session_patch.stop();self.temp.cleanup()
    def request(self,path="/api/health",body=None,headers=None):
        request=Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers or {})
        try:
            with urlopen(request,timeout=2) as resp:return resp.status,json.loads(resp.read())
        except HTTPError as exc:return exc.code,json.loads(exc.read())
    def safe_headers(self):return {"Content-Type":"application/json","Origin":self.base,"X-CSRF-Token":app.CSRF_TOKEN}
    def test_63_health_identity(self): self.assertEqual(self.request()[1],{"app":"MetricPilot","status":"ok"})
    def test_64_host_rebinding(self):self.assertEqual(self.request(headers={"Host":"attacker.invalid"})[0],403)
    def test_65_missing_origin(self):
        headers=self.safe_headers();headers.pop("Origin")
        self.assertEqual(self.request("/api/run",{"question":"2026年9月净收入"},headers)[0],403)
    def test_66_foreign_origin(self):
        headers=self.safe_headers();headers["Origin"]="http://127.0.0.1:1"
        self.assertEqual(self.request("/api/run",{"question":"2026年9月净收入"},headers)[0],403)
    def test_67_csrf_missing(self):
        headers=self.safe_headers();headers.pop("X-CSRF-Token")
        self.assertEqual(self.request("/api/run",{"question":"2026年9月净收入"},headers)[0],403)
    def test_68_http_run_and_session(self):
        status,run=self.request("/api/run",{"question":"2026年9月净收入"},self.safe_headers())
        self.assertEqual(status,200);self.assertEqual(run["report"]["totals"]["net_cents"],42000850)
        self.assertEqual(self.request("/api/session/"+run["id"])[1]["id"],run["id"])
        self.assertEqual(len(self.request("/api/sessions")[1]),1)
    def test_69_content_type_required(self):
        headers=self.safe_headers();headers["Content-Type"]="text/plain"
        self.assertEqual(self.request("/api/run",{"question":"2026年9月净收入"},headers)[0],415)
    def test_70_http_sql_write_guard(self):
        status,_=self.request("/api/sql",{"sql":"WITH x AS (SELECT 1) DELETE FROM orders"},self.safe_headers())
        self.assertEqual(status,400)


if __name__=="__main__": unittest.main(verbosity=2)

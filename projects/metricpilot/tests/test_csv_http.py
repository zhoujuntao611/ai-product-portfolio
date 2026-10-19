"""HTTP acceptance tests for import -> confirm -> evidence-backed report."""
import json
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app


CSV_TEXT = (ROOT / "tests" / "fixtures" / "hand-check-orders.csv").read_text(encoding="utf-8")
OPTIONS = {"date_format": "iso", "amount_unit": "major", "currency": "CNY"}
CONTRACT = {"confirmed": True, "refund_basis": "order_date", "cancelled": "exclude",
            "cancelled_values": ["cancelled"]}


class CsvHttpAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.storage = Path(self.temp.name)
        self.data_patch = patch.object(app, "DATA", self.storage)
        self.drafts_patch = patch.dict(app.DRAFTS, {}, clear=True)
        self.data_patch.start()
        self.drafts_patch.start()

    def tearDown(self):
        self.drafts_patch.stop()
        self.data_patch.stop()
        self.temp.cleanup()

    def safe_headers(self):
        return {"Content-Type": "application/json", "Origin": self.base, "X-CSRF-Token": app.CSRF_TOKEN}

    def request(self, path, body=None, headers=None, raw=None):
        data = raw if raw is not None else json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        if headers is None:
            headers = self.safe_headers() if data is not None else {}
        req = Request(self.base + path, data=data, headers=headers)
        try:
            response = urlopen(req, timeout=3)
        except HTTPError as exc:
            response = exc
        with response:
            status, content_type, payload = response.code, response.headers.get("Content-Type", ""), response.read()
            decoded = json.loads(payload) if "application/json" in content_type else payload.decode("utf-8")
            return status, decoded, response.headers

    def preview(self):
        status, draft, _ = self.request("/api/import/preview", {"csv": CSV_TEXT, "filename": "my-orders.csv"})
        self.assertEqual(status, 200, draft)
        return draft

    def imported(self):
        draft = self.preview()
        body = {"draft_id": draft["id"], "mapping": draft["mapping"], "options": OPTIONS}
        status, check, _ = self.request("/api/import/check", body)
        self.assertEqual(status, 200, check)
        self.assertTrue(check["can_import"], check)
        status, dataset, _ = self.request("/api/import/commit", body)
        self.assertEqual(status, 200, dataset)
        return dataset

    def run_q(self, dataset, question="2026年1月渠道净收入对比", **extra):
        return self.request("/api/run", {"dataset_id": dataset["id"], "question": question,
                                         "contract": CONTRACT, **extra})

    def test_health_and_initial_workspace_have_no_seeded_orders(self):
        self.assertEqual(self.request("/api/health")[:2], (200, {"app": "MetricPilot", "status": "ok"}))
        status, meta, _ = self.request("/api/meta")
        self.assertEqual(status, 200)
        self.assertEqual(meta["version"], "2.0")
        self.assertFalse(meta["llm_configured"])
        self.assertEqual(self.request("/api/sessions")[:2], (200, []))
        self.assertEqual(list(self.storage.rglob("*")), [])

    def test_template_download_contains_valid_csv_and_attachment_name(self):
        status, text, headers = self.request("/api/template")
        self.assertEqual(status, 200)
        self.assertIn("text/csv", headers["Content-Type"])
        self.assertIn("attachment", headers["Content-Disposition"])
        self.assertIn("orders-template.csv", headers["Content-Disposition"])
        self.assertTrue(text.startswith("order_id,order_date,gross_amount,"))
        self.assertIn("DEMO-001", text)

    def test_preview_and_check_never_write_an_import(self):
        draft = self.preview()
        self.assertEqual(draft["row_count"], 9)
        self.assertEqual(draft["preview"][0]["order_id"], "A0")
        self.assertFalse(any(key.startswith("_") for key in draft))
        status, result, _ = self.request("/api/import/check", {"draft_id": draft["id"],
                                         "mapping": draft["mapping"], "options": OPTIONS})
        self.assertEqual(status, 200)
        self.assertTrue(result["can_import"])
        self.assertEqual(list(self.storage.rglob("*.json")), [])

    def test_unconfirmed_import_blocks_without_partial_dataset(self):
        draft = self.preview()
        body = {"draft_id": draft["id"], "mapping": draft["mapping"], "options": {}}
        self.assertFalse(self.request("/api/import/check", body)[1]["can_import"])
        status, error, _ = self.request("/api/import/commit", body)
        self.assertEqual(status, 400)
        self.assertTrue(error["error"])
        self.assertEqual(list(self.storage.rglob("*.json")), [])

    def test_commit_persists_only_confirmed_import_and_metadata_hides_orders(self):
        dataset = self.imported()
        self.assertNotIn("orders", dataset)
        self.assertEqual(dataset["name"], "my-orders.csv")
        self.assertEqual(dataset["row_count"], 9)
        path = self.storage / "imports" / (dataset["id"] + ".json")
        saved = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(len(saved["orders"]), 9)
        status, retrieved, _ = self.request("/api/dataset/" + dataset["id"])
        self.assertEqual(status, 200)
        self.assertEqual(retrieved["source_hash"], dataset["source_hash"])
        self.assertNotIn("orders", retrieved)

    def test_analysis_source_and_saved_session_share_identical_provenance(self):
        dataset = self.imported()
        status, run, _ = self.run_q(dataset)
        self.assertEqual(status, 200, run)
        self.assertEqual(run["status"], "completed")
        self.assertEqual(run["report"]["totals"]["net_cents"], 23000)
        self.assertEqual(run["contract"], CONTRACT)
        status, source, _ = self.request("/api/source?dataset_id=" + dataset["id"])
        self.assertEqual(status, 200)
        self.assertEqual(source["total_rows"], 9)
        self.assertEqual(source["rows"][0]["source_row"], 2)
        self.assertEqual(source["source_hash"], dataset["source_hash"])
        self.assertTrue(all(query["source_hash"] == source["source_hash"] for query in run["queries"]))
        status, saved, _ = self.request("/api/session/" + run["id"])
        self.assertEqual(status, 200)
        self.assertEqual(saved, run)
        self.assertEqual(self.request("/api/sessions")[1][0]["id"], run["id"])

    def test_ambiguous_question_returns_clarification_without_queries(self):
        dataset = self.imported()
        status, run, _ = self.run_q(dataset, "退款率")
        self.assertEqual(status, 200)
        self.assertEqual(run["status"], "needs_clarification")
        self.assertEqual(run["queries"], [])
        self.assertNotIn("report", run)

    def test_run_requires_a_dataset_and_an_explicit_contract(self):
        status, error, _ = self.request("/api/run", {"question": "2026年1月净收入"})
        self.assertEqual(status, 400)
        self.assertIn("error", error)
        dataset = self.imported()
        status, run, _ = self.run_q(dataset, contract={})
        self.assertEqual(status, 200)
        self.assertEqual(run["status"], "needs_clarification")
        self.assertEqual(run["queries"], [])

    def test_unknown_drafts_and_datasets_are_explained(self):
        for endpoint in ["/api/import/check", "/api/import/commit"]:
            with self.subTest(endpoint=endpoint):
                self.assertEqual(self.request(endpoint, {"draft_id": "missing", "mapping": {}, "options": OPTIONS})[0], 400)
        for endpoint in ["/api/dataset/missing", "/api/source?dataset_id=missing", "/api/source"]:
            with self.subTest(endpoint=endpoint):
                status, error, _ = self.request(endpoint)
                self.assertEqual(status, 400)
                self.assertTrue(error["error"])
        self.assertEqual(self.request("/api/session/missing")[0], 404)

    def test_dataset_path_traversal_is_rejected(self):
        for dataset_id in ["../secrets", "..%2Fsecrets", "C:\\private", "", None, {"path": "elsewhere"}]:
            with self.subTest(dataset_id=dataset_id):
                status, _, _ = self.request("/api/run", {"dataset_id": dataset_id, "question": "2026年1月毛收入"})
                self.assertEqual(status, 400)

    def test_arbitrary_sql_endpoint_is_absent(self):
        self.assertEqual(self.request("/api/sql")[0], 404)
        self.assertEqual(self.request("/api/sql", {"sql": "SELECT * FROM orders"})[0], 404)
        self.assertEqual(self.request("/api/sql", {"sql": "DELETE FROM orders"})[0], 404)

    def test_external_model_mode_does_not_fall_back_to_fabricated_report(self):
        dataset = self.imported()
        status, error, _ = self.run_q(dataset, mode="llm")
        self.assertEqual(status, 400)
        self.assertIn("error", error)
        self.assertEqual(self.request("/api/sessions")[1], [])

    def test_origin_csrf_host_and_content_type_guards(self):
        cases = [({"Origin": None}, 403), ({"Origin": "https://attacker.invalid"}, 403),
                 ({"X-CSRF-Token": None}, 403), ({"X-CSRF-Token": "wrong"}, 403),
                 ({"Host": "attacker.invalid"}, 403), ({"Content-Type": "text/plain"}, 415)]
        for changes, expected in cases:
            with self.subTest(changes=changes):
                headers = self.safe_headers()
                for key, value in changes.items():
                    if value is None:
                        headers.pop(key, None)
                    else:
                        headers[key] = value
                self.assertEqual(self.request("/api/import/preview", {"csv": CSV_TEXT}, headers=headers)[0], expected)
        self.assertEqual(app.DRAFTS, {})
        self.assertEqual(list(self.storage.rglob("*")), [])

    def test_get_rejects_foreign_host(self):
        self.assertEqual(self.request("/api/meta", headers={"Host": "attacker.invalid"})[0], 403)

    def test_non_ascii_csrf_header_is_rejected_without_resetting_connection(self):
        headers = {**self.safe_headers(), "X-CSRF-Token": "invalid-\u00e9"}
        status, error, _ = self.request("/api/import/preview", {"csv": CSV_TEXT}, headers=headers)
        self.assertEqual(status, 403)
        self.assertTrue(error["error"])

    def test_malformed_or_nonobject_json_has_explained_error(self):
        for payload in [b"{broken", b"[]", b"null", b'"string"', b"\xff"]:
            with self.subTest(payload=payload):
                status, error, _ = self.request("/api/import/preview", raw=payload)
                self.assertEqual(status, 400)
                self.assertTrue(error["error"])

    def test_static_assets_are_served_with_local_content_security_policy(self):
        for endpoint, mime in [("/", "text/html"), ("/app.js", "text/javascript"), ("/style.css", "text/css")]:
            with self.subTest(endpoint=endpoint):
                status, text, headers = self.request(endpoint)
                self.assertEqual(status, 200)
                self.assertIn(mime, headers["Content-Type"])
                self.assertTrue(text)
                self.assertIn("script-src 'self'", headers["Content-Security-Policy"])


if __name__ == "__main__":
    unittest.main()

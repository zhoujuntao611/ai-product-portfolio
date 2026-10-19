"""MetricPilot CSV workspace. Python 3.10+; standard library only."""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from analytics import METRICS, dataset_info, run_analysis
from orders_import import preview_csv, check_import, commit_import

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("METRICPILOT_DATA_DIR", str(ROOT / "data")))
CSRF_TOKEN = secrets.token_urlsafe(32)
LOCK = threading.RLock()
DRAFTS = {}


def metadata():
    return {"name": "MetricPilot", "version": "2.0", "csrf_token": CSRF_TOKEN, "metrics": METRICS,
            "llm_configured": False, "source": "导入一份自己的订单 CSV，完成收入、渠道与退款分析。",
            "limits": {"bytes": 2*1024*1024, "rows": 10000, "columns": 50},
            "schema": {"orders": {"order_id": "订单唯一标识", "order_date": "订单日期",
                       "gross_amount": "订单总金额（退款前）", "refund_amount": "该订单累计退款金额",
                       "refund_date": "退款归属日期", "channel": "订单渠道", "status": "订单状态", "currency": "币种"}}}


def _write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def saved_sessions():
    with LOCK:
        path = DATA / "csv-sessions.json"
        if not path.exists():
            return []
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raise ValueError("分析记录无法读取，请检查本机数据目录。") from None


def save_session(run):
    with LOCK:
        _write_json(DATA / "csv-sessions.json", [run] + saved_sessions()[:39])


def _dataset_path(dataset_id):
    if not isinstance(dataset_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", dataset_id):
        raise ValueError("数据集标识无效。")
    return DATA / "imports" / (dataset_id + ".json")


def load_dataset(dataset_id):
    path = _dataset_path(dataset_id)
    with LOCK:
        if not path.exists():
            raise ValueError("数据集不存在，请先导入订单 CSV。")
        return json.loads(path.read_text(encoding="utf-8"))


def get_draft(draft_id):
    if not isinstance(draft_id, str):
        raise ValueError("导入预览标识无效。")
    with LOCK:
        draft = DRAFTS.get(draft_id)
        if draft is None:
            raise ValueError("导入预览已失效，请重新选择 CSV 文件。")
        return copy.deepcopy(draft)


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def valid_host(self):
        return self.headers.get("Host", "") in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

    def log_message(self, *args):
        pass

    def send_bytes(self, status, body, mime="application/json; charset=utf-8", attachment=None):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'")
        if attachment:
            self.send_header("Content-Disposition", f'attachment; filename="{attachment}"')
        self.end_headers()
        self.wfile.write(body)

    def respond(self, status, payload):
        self.send_bytes(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def do_GET(self):
        if not self.valid_host():
            return self.respond(403, {"error": "Host 必须为本机服务地址。"})
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/health":
                return self.respond(200, {"app": "MetricPilot", "status": "ok"})
            if path == "/api/meta":
                return self.respond(200, metadata())
            if path == "/api/template":
                return self.send_bytes(200, (ROOT / "templates" / "orders-template.csv").read_bytes(), "text/csv; charset=utf-8", "metricpilot-orders-template.csv")
            if path == "/api/sessions":
                return self.respond(200, [{k: r.get(k) for k in ["id", "question", "status", "created_at", "mode", "elapsed_ms", "dataset"]} for r in saved_sessions()])
            if path.startswith("/api/session/"):
                run = next((r for r in saved_sessions() if r["id"] == path.rsplit("/", 1)[1]), None)
                return self.respond(200, run) if run else self.respond(404, {"error": "分析记录不存在。"})
            if path.startswith("/api/dataset/"):
                return self.respond(200, dataset_info(load_dataset(path.rsplit("/", 1)[1])))
            if path == "/api/source":
                dataset = load_dataset(parse_qs(parsed.query).get("dataset_id", [""])[0])
                rows = dataset["orders"][:30]
                return self.respond(200, {"columns": list(rows[0]) if rows else [], "rows": rows, "total_rows": dataset["row_count"], "source_hash": dataset["source_hash"]})
            static = {"/": "index.html", "/app.js": "app.js", "/style.css": "style.css"}.get(path)
            if static:
                mime = {"html": "text/html", "js": "text/javascript", "css": "text/css"}[static.rsplit(".", 1)[1]]
                return self.send_bytes(200, (ROOT / "static" / static).read_bytes(), mime + "; charset=utf-8")
            return self.respond(404, {"error": "页面或接口不存在。"})
        except (ValueError, TypeError) as exc:
            return self.respond(400, {"error": str(exc)})
        except Exception:
            return self.respond(500, {"error": "读取失败，请检查本机文件或重新导入。"})

    def do_POST(self):
        if self.headers.get("Transfer-Encoding"):
            self.close_connection = True
            return self.respond(400, {"error": "不接受分块请求。"})
        try:
            if len(self.headers.get_all("Content-Length", [])) != 1:
                raise ValueError()
            length = int(self.headers["Content-Length"])
            if not 0 < length <= 12*1024*1024:
                self.close_connection = True
                return self.respond(413, {"error": "请求过大；CSV 最多 2 MB、10,000 行。"})
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError()
        except (ValueError, TimeoutError):
            self.close_connection = True
            return self.respond(400, {"error": "请求长度无效、内容不完整或读取超时。"})
        if not self.valid_host():
            return self.respond(403, {"error": "Host 必须为本机服务地址。"})
        if self.headers.get("Origin") not in {f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"}:
            return self.respond(403, {"error": "必须提供匹配本机服务的 Origin。"})
        supplied_token = self.headers.get("X-CSRF-Token", "")
        if not supplied_token.isascii() or not secrets.compare_digest(supplied_token, CSRF_TOKEN):
            return self.respond(403, {"error": "CSRF 校验失败。"})
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
            return self.respond(415, {"error": "仅接受 JSON。"})
        try:
            body = json.loads(raw.decode("utf-8"))
            if not isinstance(body, dict):
                raise ValueError("请求必须为 JSON 对象。")
            path = urlparse(self.path).path
            if path == "/api/import/preview":
                draft = preview_csv(body.get("csv"), body.get("filename", "orders.csv"))
                with LOCK:
                    if len(DRAFTS) >= 8:
                        DRAFTS.pop(next(iter(DRAFTS)))
                    DRAFTS[draft["id"]] = draft
                return self.respond(200, {k: v for k, v in draft.items() if not k.startswith("_")})
            if path in {"/api/import/check", "/api/import/commit"}:
                draft = get_draft(body.get("draft_id"))
                mapping, options = body.get("mapping", {}), body.get("options", {})
                if path.endswith("/check"):
                    return self.respond(200, check_import(draft, mapping, options))
                dataset = commit_import(draft, mapping, options)
                with LOCK:
                    _write_json(_dataset_path(dataset["id"]), dataset)
                return self.respond(200, dataset_info(dataset))
            if path == "/api/run":
                dataset = load_dataset(body.get("dataset_id"))
                run = run_analysis(body.get("question"), body.get("filters"), dataset, body.get("contract"), body.get("mode", "demo"))
                save_session(run)
                return self.respond(200, run)
            return self.respond(404, {"error": "接口不存在；仅支持受约束的订单统计工具。"})
        except (ValueError, TypeError, AttributeError, KeyError) as exc:
            return self.respond(400, {"error": str(exc)})
        except Exception:
            return self.respond(500, {"error": "操作失败，没有生成分析结论，请检查本机数据目录。"})


def main():
    parser = argparse.ArgumentParser(description="MetricPilot — 导入订单，分析收入、渠道与退款")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"MetricPilot 已启动：http://127.0.0.1:{args.port}（导入自己的订单 CSV；Ctrl+C 退出）", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

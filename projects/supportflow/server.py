"""Dependency-free localhost server. Bind to loopback only."""
from __future__ import annotations
import argparse
import hashlib
import json
import mimetypes
import secrets
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from core import ROOT, KB, generate, llm_configured, mask_sensitive

CSRF_TOKEN = secrets.token_urlsafe(32)
DB_PATH = ROOT / "work" / "supportflow.sqlite3"
WRITE_LOCK = threading.Lock()
ALLOWED_FILES = {"/":"index.html", "/index.html":"index.html", "/app.js":"app.js", "/style.css":"style.css"}
STATES = {"approve":"APPROVED_LOCAL", "escalate":"ESCALATED", "reject":"REJECTED"}

def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

@contextmanager
def connect():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    try:
        with con:
            yield con
    finally:
        con.close()

def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        con.executescript("""
          CREATE TABLE IF NOT EXISTS tickets (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, input_redacted TEXT NOT NULL,
            result_json TEXT NOT NULL, state TEXT NOT NULL, final_draft TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS audit (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id TEXT NOT NULL,
            event TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL);
        """)

def create_ticket(title, content, region, mode):
    if not isinstance(title,str) or len(title.strip()) > 100:
        raise ValueError("标题最多 100 字。")
    result = generate(content, region, mode)
    ident, stamp = uuid.uuid4().hex[:12], now()
    title = mask_sensitive(title.strip() or "未命名工单")
    with WRITE_LOCK, connect() as con:
        con.execute("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?)", (ident,title,result["input_redacted"],json.dumps(result,ensure_ascii=False),"DRAFT",None,stamp,stamp))
        con.execute("INSERT INTO audit(ticket_id,event,details_json,created_at) VALUES (?,?,?,?)", (ident,"DRAFT_CREATED",json.dumps({"engine":result["engine"],"status":result["status"],"source_ids":[s["id"] for s in result["sources"]],"content_hash":result["content_hash"]},ensure_ascii=False),stamp))
    return get_ticket(ident)

def get_ticket(ident):
    with connect() as con:
        row = con.execute("SELECT * FROM tickets WHERE id=?",(ident,)).fetchone()
        if not row:
            raise LookupError("工单不存在。")
        data = dict(row)
        data["result"] = json.loads(data.pop("result_json"))
        data["audit"] = [dict(r) for r in con.execute("SELECT * FROM audit WHERE ticket_id=? ORDER BY seq",(ident,))]
        for entry in data["audit"]:
            entry["details"] = json.loads(entry.pop("details_json"))
        return data

def review_ticket(ident, action, draft, note):
    if action not in STATES or not isinstance(note,str) or len(note)>1000:
        raise ValueError("审核操作或备注无效。")
    if not isinstance(draft,str) or len(draft)>12000:
        raise ValueError("审核草稿最多 12,000 字。")
    with WRITE_LOCK, connect() as con:
        row = con.execute("SELECT * FROM tickets WHERE id=?",(ident,)).fetchone()
        if not row:
            raise LookupError("工单不存在。")
        if row["state"] != "DRAFT":
            raise ValueError("该工单已完成审核；可创建新工单重新生成。")
        result = json.loads(row["result_json"])
        if action=="approve" and (not result["can_approve"] or not draft.strip()):
            raise ValueError("缺少证据或需要人工核验的工单不可直接批准。请转人工。")
        stamp, redacted_draft = now(), mask_sensitive(draft)
        edited = redacted_draft != result["draft"]
        details = {"note":mask_sensitive(note),"human_edited":edited,"automatically_validated":not edited,
            "content_hash":hashlib.sha256(redacted_draft.encode()).hexdigest(),"external_send":False}
        con.execute("UPDATE tickets SET state=?,final_draft=?,updated_at=? WHERE id=?", (STATES[action],redacted_draft if action=="approve" else None,stamp,ident))
        con.execute("INSERT INTO audit(ticket_id,event,details_json,created_at) VALUES (?,?,?,?)",(ident,STATES[action],json.dumps(details,ensure_ascii=False),stamp))
    return get_ticket(ident)

class Handler(BaseHTTPRequestHandler):
    server_version = "SupportFlow/1.0"
    def log_message(self, fmt, *args):
        # Request bodies, credentials and ticket text are never logged.
        print(f"{self.command} {urlsplit(self.path).path} {args[1] if len(args)>1 else ''}")

    def host_ok(self):
        return self.headers.get("Host") in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

    def send(self, code, payload, content_type="application/json; charset=utf-8"):
        data = json.dumps(payload, ensure_ascii=False).encode() if isinstance(payload,(dict,list)) else payload
        self.send_response(code)
        self.send_header("Content-Type",content_type)
        self.send_header("Content-Length",str(len(data)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.host_ok():
            return self.send(403,{"error":"主机名无效。请从 localhost 打开。"})
        path = urlsplit(self.path).path
        if path in ALLOWED_FILES:
            filename = ROOT / "web" / ALLOWED_FILES[path]
            mime = {".html":"text/html", ".js":"application/javascript", ".css":"text/css"}[filename.suffix]
            return self.send(200,filename.read_bytes(),mime+"; charset=utf-8")
        if path=="/api/session":
            return self.send(200,{"csrf_token":CSRF_TOKEN,"model_configured":llm_configured(),"knowledge_date":KB["snapshot_date"],"product":KB["product"],"notice":KB["notice"]})
        if path=="/api/health":
            return self.send(200,{"app":"SupportFlow","status":"ok","local_only":True})
        if path=="/api/knowledge":
            return self.send(200,KB)
        if path=="/api/tickets":
            with connect() as con:
                rows = [dict(r) for r in con.execute("SELECT id,title,state,created_at,updated_at FROM tickets ORDER BY created_at DESC LIMIT 100")]
                total = con.execute("SELECT COUNT(*) FROM tickets").fetchone()[0]
                approved = con.execute("SELECT COUNT(*) FROM tickets WHERE state='APPROVED_LOCAL'").fetchone()[0]
            return self.send(200,{"tickets":rows,"total":total,"approved":approved})
        if path.startswith("/api/tickets/"):
            ident = path.removeprefix("/api/tickets/")
            if len(ident)!=12 or any(c not in "0123456789abcdef" for c in ident):
                return self.send(404,{"error":"工单不存在。"})
            try:
                return self.send(200,get_ticket(ident))
            except LookupError as ex:
                return self.send(404,{"error":str(ex)})
        return self.send(404,{"error":"页面不存在。"})

    def do_POST(self):
        origins = {f"http://localhost:{self.server.server_port}",f"http://127.0.0.1:{self.server.server_port}"}
        if not self.host_ok() or self.headers.get("Origin") not in origins or not secrets.compare_digest(self.headers.get("X-CSRF-Token",""),CSRF_TOKEN):
            return self.send(403,{"error":"请求来源或会话校验失败。请刷新当前页面。"})
        if self.headers.get("Content-Type","").split(";")[0] != "application/json":
            return self.send(415,{"error":"仅接受 JSON 请求。"})
        if self.headers.get("Transfer-Encoding"):
            return self.send(400,{"error":"不支持分块请求。"})
        try:
            length = int(self.headers.get("Content-Length","0"))
            if not 1<=length<=32_000:
                return self.send(413,{"error":"请求大小超出限制。"})
            self.connection.settimeout(10)
            data = json.loads(self.rfile.read(length))
            if not isinstance(data,dict):
                raise ValueError("请求必须是 JSON 对象。")
            path = urlsplit(self.path).path
            if path=="/api/tickets":
                result = create_ticket(data.get("title",""),data.get("content",""),data.get("region","unknown"),data.get("mode","demo"))
            elif path.startswith("/api/tickets/") and path.endswith("/review"):
                ident = path.split("/")[3]
                result = review_ticket(ident,data.get("action"),data.get("draft",""),data.get("note",""))
            else:
                return self.send(404,{"error":"接口不存在。"})
            return self.send(200,result)
        except LookupError as ex:
            return self.send(404,{"error":str(ex)})
        except (ValueError,TypeError) as ex:
            return self.send(400,{"error":str(ex) if isinstance(ex,ValueError) else "请求字段类型无效。"})
        except Exception:
            return self.send(500,{"error":"本地服务发生异常，请检查终端或重启。数据未发送给外部客服系统。"})

def main():
    parser = argparse.ArgumentParser(description="SupportFlow local portfolio MVP")
    parser.add_argument("--port",type=int,default=8765)
    args = parser.parse_args()
    if not 1024<=args.port<=65535:
        parser.error("port must be 1024–65535")
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1",args.port),Handler)
    print(f"SupportFlow: http://127.0.0.1:{args.port}")
    print("Synthetic demo knowledge. Offline rule engine by default. Local drafts only.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__=="__main__":
    main()

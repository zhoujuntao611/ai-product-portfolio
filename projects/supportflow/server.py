"""Dependency-free localhost server. Bind to loopback only."""
from __future__ import annotations
import argparse
import hashlib
import json
import secrets
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from core import ROOT, check_evidence, generate, llm_configured, mask_sensitive
import knowledge

CSRF_TOKEN = secrets.token_urlsafe(32)
DB_PATH = ROOT / "work" / "supportflow.sqlite3"
WRITE_LOCK = threading.Lock()
ALLOWED_FILES = {"/":"index.html", "/index.html":"index.html", "/app.js":"app.js", "/style.css":"style.css", "/workspace.css":"workspace.css"}
STATES = {"approve":"APPROVED_LOCAL", "escalate":"ESCALATED", "reject":"REJECTED"}
REVIEW_REASONS = {
    "source_not_applicable":"来源不适用", "missing_condition":"遗漏条件",
    "incomplete_answer":"回答不完整", "unsupported_claim":"依据不支持回复", "other":"其他",
}

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
        # Additive migration preserves tickets and review history from v1.
        columns = {row["name"] for row in con.execute("PRAGMA table_info(tickets)")}
        if "current_draft" not in columns:
            con.execute("ALTER TABLE tickets ADD COLUMN current_draft TEXT")
        if "review_reasons_json" not in columns:
            con.execute("ALTER TABLE tickets ADD COLUMN review_reasons_json TEXT NOT NULL DEFAULT '[]'")

def create_ticket(title, content, region, mode):
    if not isinstance(title,str) or len(title.strip()) > 100:
        raise ValueError("标题最多 100 字。")
    result = generate(content, region, mode, knowledge=knowledge.get_knowledge())
    ident, stamp = uuid.uuid4().hex[:12], now()
    title = mask_sensitive(title.strip() or "未命名工单")
    with WRITE_LOCK, connect() as con:
        con.execute("""INSERT INTO tickets
            (id,title,input_redacted,result_json,state,final_draft,created_at,updated_at,current_draft,review_reasons_json)
            VALUES (?,?,?,?,?,?,?,?,?,?)""", (ident,title,result["input_redacted"],json.dumps(result,ensure_ascii=False),"DRAFT",None,stamp,stamp,result["draft"],"[]"))
        details = {"engine":result["engine"], "engine_version":result.get("engine_version"),
            "knowledge_revision":result.get("knowledge_revision"), "status":result["status"],
            "source_versions":[{"id":s["id"],"version":s["version"]} for s in result["sources"]],
            "source_ids":[s["id"] for s in result["sources"]],"content_hash":result["content_hash"]}
        con.execute("INSERT INTO audit(ticket_id,event,details_json,created_at) VALUES (?,?,?,?)", (ident,"DRAFT_CREATED",json.dumps(details,ensure_ascii=False),stamp))
    return get_ticket(ident)

def get_ticket(ident):
    with connect() as con:
        row = con.execute("SELECT * FROM tickets WHERE id=?",(ident,)).fetchone()
        if not row:
            raise LookupError("工单不存在。")
        data = dict(row)
        data["result"] = json.loads(data.pop("result_json"))
        data["current_draft"] = data["current_draft"] if data["current_draft"] is not None else (data["final_draft"] or data["result"]["draft"])
        data["review_reasons"] = json.loads(data.pop("review_reasons_json"))
        data["audit"] = [dict(r) for r in con.execute("SELECT * FROM audit WHERE ticket_id=? ORDER BY seq",(ident,))]
        for entry in data["audit"]:
            entry["details"] = json.loads(entry.pop("details_json"))
        return data

def _ensure_current_evidence(result, snapshot):
    if not result.get("knowledge_revision") or result["knowledge_revision"] != snapshot["revision"]:
        raise ValueError("知识资料已更新，请重新生成草稿后审核。已保存的编辑仍可查看。")
    current = {doc["id"]:doc for doc in snapshot["documents"]}
    cited_ids = {claim["source_id"] for claim in result.get("claims", [])}
    cited_sources = [source for source in result["sources"] if source["id"] in cited_ids]
    if not cited_sources:
        raise ValueError("草稿缺少可审核的具体依据，请重新生成或转人工。")
    for source in cited_sources:
        latest = current.get(source["id"])
        if (not latest or not latest.get("eligible") or latest["version"] != source["version"]
                or latest["statements"] != source["statements"]):
            raise ValueError("引用资料已更新、停用或不在生效期内，请重新生成草稿后审核。")
    checks = check_evidence(result["claims"], list(current.values()), result["region"], snapshot["snapshot_date"])
    if not checks or not all(check["supported"] for check in checks):
        raise ValueError("原草稿的引用与当前适用依据不一致，请重新生成或转人工核验。")


def review_ticket(ident, action, draft, note, reasons=None):
    if not isinstance(action,str) or action not in {*STATES, "save"} or not isinstance(note,str) or len(note)>1000:
        raise ValueError("审核操作或备注无效。")
    if not isinstance(draft,str) or len(draft)>12000:
        raise ValueError("审核草稿最多 12,000 字。")
    if reasons is None:
        reasons = []
    if (not isinstance(reasons,list) or len(reasons)>len(REVIEW_REASONS)
            or any(not isinstance(reason,str) or reason not in REVIEW_REASONS for reason in reasons)):
        raise ValueError("审核原因无效，请选择来源不适用、遗漏条件、回答不完整、依据不支持回复或其他。")
    reasons = list(dict.fromkeys(reasons))
    with WRITE_LOCK, connect() as con:
        row = con.execute("SELECT * FROM tickets WHERE id=?",(ident,)).fetchone()
        if not row:
            raise LookupError("工单不存在。")
        if row["state"] != "DRAFT":
            raise ValueError("该工单已完成审核；可创建新工单重新生成。")
        result = json.loads(row["result_json"])
        if action=="approve" and (not result["can_approve"] or not draft.strip()):
            raise ValueError("缺少证据或需要人工核验的工单不可直接批准。请转人工。")
        if action=="approve":
            _ensure_current_evidence(result, knowledge.get_knowledge())
        if action in {"escalate", "reject"} and not draft.strip():
            draft = row["current_draft"] if row["current_draft"] is not None else result["draft"]
        stamp, redacted_draft = now(), mask_sensitive(draft)
        edited = redacted_draft != result["draft"]
        details = {"note":mask_sensitive(note),"human_edited":edited,"automatically_validated":not edited and result["can_approve"],
            "draft":redacted_draft,"reasons":reasons,"action":action,
            "knowledge_revision":result.get("knowledge_revision"),"engine_version":result.get("engine_version"),
            "content_hash":hashlib.sha256(redacted_draft.encode()).hexdigest(),"external_send":False}
        state = "DRAFT" if action=="save" else STATES[action]
        con.execute("UPDATE tickets SET state=?,final_draft=?,current_draft=?,review_reasons_json=?,updated_at=? WHERE id=?",
            (state,redacted_draft if action=="approve" else None,redacted_draft,json.dumps(reasons),stamp,ident))
        con.execute("INSERT INTO audit(ticket_id,event,details_json,created_at) VALUES (?,?,?,?)",(ident,"DRAFT_EDITED" if action=="save" else state,json.dumps(details,ensure_ascii=False),stamp))
    return get_ticket(ident)


def _redact_tree(value):
    if isinstance(value,str):
        return mask_sensitive(value)
    if isinstance(value,list):
        return [_redact_tree(item) for item in value]
    if isinstance(value,dict):
        return {key:_redact_tree(item) for key,item in value.items()}
    return value


def export_review_examples():
    with connect() as con:
        ids = [row["id"] for row in con.execute("""SELECT DISTINCT t.id FROM tickets t JOIN audit a
            ON a.ticket_id=t.id WHERE a.event!='DRAFT_CREATED' ORDER BY t.created_at,t.id""")]
    examples = []
    for ident in ids:
        ticket = get_ticket(ident)
        result = ticket["result"]
        examples.append({"id":ident,"title":ticket["title"],"input_redacted":ticket["input_redacted"],
            "region":result["region"],"state":ticket["state"],"generated_result":result,
            "original_draft":result["draft"],"current_draft":ticket["current_draft"],
            "final_draft":ticket["final_draft"],"review_reasons":ticket["review_reasons"],
            "review_history":[entry for entry in ticket["audit"] if entry["event"]!="DRAFT_CREATED"],
            "created_at":ticket["created_at"],"updated_at":ticket["updated_at"]})
    return _redact_tree({"schema_version":"supportflow.review-examples.v1", "exported_at":now(),
        "purpose":"供人工整理为下一轮固定评测问题集；审核操作不自动等同于正确答案。",
        "redaction":"邮箱、手机号和显式标识的密钥字段已隐藏。",
        "case_count":len(examples),"review_reason_labels":REVIEW_REASONS,"examples":examples})

class Handler(BaseHTTPRequestHandler):
    server_version = "SupportFlow/2.1"
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

    def reject_post(self, code, message):
        # HTTP/1.0 closes after responding. Drain a bounded body first so Windows
        # does not reset the socket while the client is still uploading JSON.
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not self.headers.get("Transfer-Encoding") and 0 < length <= 1_000_000:
                self.connection.settimeout(1)
                self.rfile.read(length)
        except (ValueError, OSError):
            pass
        return self.send(code, {"error":message})

    def do_GET(self):
        if not self.host_ok():
            return self.send(403,{"error":"主机名无效。请从 localhost 打开。"})
        path = urlsplit(self.path).path
        if path in ALLOWED_FILES:
            filename = ROOT / "web" / ALLOWED_FILES[path]
            mime = {".html":"text/html", ".js":"application/javascript", ".css":"text/css"}[filename.suffix]
            return self.send(200,filename.read_bytes(),mime+"; charset=utf-8")
        if path=="/api/session":
            snapshot = knowledge.get_knowledge()
            return self.send(200,{"csrf_token":CSRF_TOKEN,"model_configured":llm_configured(),"knowledge_date":snapshot["snapshot_date"],"knowledge_revision":snapshot["revision"],"product":snapshot["product"],"notice":snapshot["notice"],"review_reason_labels":REVIEW_REASONS})
        if path=="/api/health":
            return self.send(200,{"app":"SupportFlow","status":"ok","local_only":True})
        if path=="/api/knowledge":
            return self.send(200,knowledge.get_knowledge())
        parts = path.split("/")
        if len(parts)==5 and parts[1:3]==["api","knowledge"] and parts[4]=="history":
            try:
                return self.send(200,{"id":parts[3],"versions":knowledge.get_history(parts[3])})
            except LookupError as ex:
                return self.send(404,{"error":str(ex)})
        if path in {"/api/review-examples", "/api/tickets/export"}:
            return self.send(200,export_review_examples())
        if path=="/api/tickets":
            with connect() as con:
                # Timestamps have second precision. Keep insertion order stable
                # when a fast sequence of tickets shares the same timestamp.
                rows = [dict(r) for r in con.execute("SELECT id,title,state,created_at,updated_at FROM tickets ORDER BY created_at DESC, rowid DESC LIMIT 100")]
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
        csrf = self.headers.get("X-CSRF-Token", "")
        if not self.host_ok() or self.headers.get("Origin") not in origins or not csrf.isascii() or not secrets.compare_digest(csrf,CSRF_TOKEN):
            return self.reject_post(403,"请求来源或会话校验失败。请刷新当前页面。")
        if self.headers.get("Content-Type","").split(";")[0] != "application/json":
            return self.reject_post(415,"仅接受 JSON 请求。")
        if self.headers.get("Transfer-Encoding"):
            return self.send(400,{"error":"不支持分块请求。"})
        try:
            path = urlsplit(self.path).path
            parts = path.split("/")
            length = int(self.headers.get("Content-Length","0"))
            review_path = len(parts)==5 and parts[1:3]==["api","tickets"] and parts[4]=="review"
            limit = 256_000 if path.startswith("/api/knowledge/") else 96_000 if review_path else 32_000
            if not 1<=length<=limit:
                return self.reject_post(413,"请求大小超出限制。")
            self.connection.settimeout(10)
            data = json.loads(self.rfile.read(length))
            if not isinstance(data,dict):
                raise ValueError("请求必须是 JSON 对象。")
            if path=="/api/tickets":
                result = create_ticket(data.get("title",""),data.get("content",""),data.get("region","unknown"),data.get("mode","demo"))
            elif len(parts)==5 and parts[1:3]==["api","tickets"] and parts[4]=="review":
                result = review_ticket(parts[3],data.get("action"),data.get("draft",""),data.get("note",""),data.get("reasons"))
            elif path=="/api/knowledge/import":
                with WRITE_LOCK:
                    result = knowledge.import_documents(data)
            elif len(parts)==5 and parts[1:3]==["api","knowledge"] and parts[4]=="versions":
                with WRITE_LOCK:
                    result = knowledge.update_document(parts[3],data.get("document",data))
            elif len(parts)==5 and parts[1:3]==["api","knowledge"] and parts[4]=="deactivate":
                with WRITE_LOCK:
                    result = knowledge.deactivate_document(parts[3])
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

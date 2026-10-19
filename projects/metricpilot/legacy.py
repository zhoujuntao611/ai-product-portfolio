"""MetricPilot: evidence-first sales analysis. Python standard library only."""
from __future__ import annotations

import calendar
import datetime as dt
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        return None

urlopen=build_opener(NoRedirect()).open

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DB_PATH = DATA / "sales.sqlite3"
SESSION_PATH = DATA / "sessions.json"
DATE_START, DATE_END = "2026-01-01", "2026-09-30"
PRODUCTS = [("starter", "Starter 基础版", 19900), ("team", "Team 团队版", 49900), ("enterprise", "Enterprise 企业版", 99900)]
CHANNELS = {"organic": "自然流量", "paid": "付费投放", "partner": "合作伙伴"}
LOCK = threading.RLock()
CSRF_TOKEN = secrets.token_urlsafe(32)
METRICS = {"net_cents": "净收入", "gross_cents": "毛收入", "refund_cents": "退款金额", "orders": "订单数", "units": "授权席位数", "refund_amount_rate": "退款金额 / 毛收入", "refund_order_rate": "退款订单数 / 订单数"}


def seed_database(path=DB_PATH):
    """Deterministic synthetic facts; never label these as real business outcomes."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE products(product_id TEXT PRIMARY KEY, name TEXT NOT NULL, unit_price_cents INTEGER NOT NULL);
        CREATE TABLE orders(order_id TEXT PRIMARY KEY, order_date TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products,
          channel TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), unit_price_cents INTEGER NOT NULL,
          refund_cents INTEGER NOT NULL CHECK(refund_cents>=0));
        CREATE INDEX orders_date ON orders(order_date);
    """)
    con.executemany("INSERT INTO products VALUES (?,?,?)", PRODUCTS)
    first, last = dt.date.fromisoformat(DATE_START), dt.date.fromisoformat(DATE_END)
    records = []
    for day in range((last-first).days+1):
        date = (first+dt.timedelta(days=day)).isoformat()
        for p, (product, _, price) in enumerate(PRODUCTS):
            for c, channel in enumerate(CHANNELS):
                n = day*9+p*3+c
                qty = 1+(day+p*2+c)%5
                gross = qty*price
                refund = gross if n%13 == 0 else (gross//2 if n%29 == 0 else 0)
                records.append((f"SYN-{n+1:05d}", date, product, channel, qty, price, refund))
    con.executemany("INSERT INTO orders VALUES (?,?,?,?,?,?,?)", records)
    con.commit()
    con.close()


class QueryError(ValueError):
    pass


def read_sql(sql, params=None, path=DB_PATH, max_rows=200, timeout=1.0):
    """SQLite authorizer is the authority; the prefix check is only early feedback."""
    if not isinstance(sql, str) or len(sql)>12000 or not re.match(r"^\s*(SELECT|WITH)\b", sql, re.I):
        raise QueryError("仅允许 SELECT / WITH 只读查询。")
    if not isinstance(params or [], (list, tuple)):
        raise QueryError("查询参数必须是数组。")
    allowed_functions = {"sum", "count", "avg", "min", "max", "round", "coalesce", "nullif", "strftime", "date", "lower", "upper", "abs"}
    con = sqlite3.connect(Path(path).resolve().as_uri()+"?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    reads = []
    def authorize(action, arg1, arg2, db, trigger):
        if action == sqlite3.SQLITE_SELECT:
            return sqlite3.SQLITE_OK
        if action == sqlite3.SQLITE_READ and arg1 in {"orders", "products"} and (db == "main" or (db is None and arg2=="")):
            reads.append((arg1, arg2))
            return sqlite3.SQLITE_OK
        if action == sqlite3.SQLITE_FUNCTION and (arg2 or "").lower() in allowed_functions:
            return sqlite3.SQLITE_OK
        return sqlite3.SQLITE_DENY
    started = time.perf_counter()
    ticks = 0
    def stop_expensive():
        nonlocal ticks
        ticks += 1
        return 1 if ticks>250 or time.perf_counter()-started>timeout else 0
    con.set_authorizer(authorize)
    con.set_progress_handler(stop_expensive, 1000)
    try:
        cur = con.execute(sql, params or [])
        rows = cur.fetchmany(max_rows+1)
        if len(rows)>max_rows:
            raise QueryError(f"结果超过 {max_rows} 行，请缩小查询范围。")
        return {"rows": [dict(x) for x in rows], "columns": [x[0] for x in cur.description], "elapsed_ms": round((time.perf_counter()-started)*1000, 2), "source_tables": sorted(set(t for t, _ in reads))}
    except sqlite3.Error as exc:
        raise QueryError("查询被只读或资源限制拦截："+str(exc)) from exc
    finally:
        con.close()


def month_range(year, month):
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{calendar.monthrange(year,month)[1]}"


def parse_question(question, filters=None):
    f = filters or {}
    q = question.strip()
    if not q or len(q)>1000:
        raise ValueError("请输入 1–1,000 字的问题。")
    periods = []
    dates = re.findall(r"\b(20\d{2}-\d{2}-\d{2})\b", q)
    months = re.findall(r"(20\d{2})\s*[年/-]\s*(1[0-2]|0?[1-9])(?:月|(?=\s|$|[^\d-]))", q)
    quarter = re.search(r"(20\d{2})\s*年?\s*(?:第([一二三四1234])季度|[Qq]([1-4]))", q)
    if dates:
        if len(dates)!=2:
            return {"clarification": "请给出完整的起止日期，例如 2026-09-01 至 2026-09-30。", "kind": "date"}
        periods = [(dates[0], dates[1])]
    elif quarter:
        y = int(quarter.group(1)); k = quarter.group(2) or quarter.group(3)
        n = "一二三四".index(k)+1 if k in "一二三四" else int(k)
        periods = [(month_range(y, (n-1)*3+1)[0], month_range(y, n*3)[1])]
    elif months:
        periods = [month_range(int(y), int(m)) for y,m in months]
        if len(re.findall(r"(?<!\d)(?:1[0-2]|0?[1-9])月",q))>len(months) and any(w in q for w in ["对比","比较","环比","与","和"]):
            return {"clarification":"每个比较期间都需要明确年份，例如“2026年9月对比2026年8月”。", "kind":"date"}
        if len(periods)>2:
            return {"clarification": "一次支持一个期间，或两个期间的对比；请缩小时间范围。", "kind": "date"}
    elif f.get("start") and f.get("end"):
        periods = [(f["start"], f["end"])]
    else:
        return {"clarification": "请明确年份和期间；例如“2026年9月渠道净收入对比”。“最近”或“9月”不会被静默解释。", "kind": "date"}
    try:
        for start,end in periods:
            a,b = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
            if a>b: raise ValueError("起始日期晚于结束日期")
            if start<DATE_START or end>DATE_END:
                return {"clarification": f"演示数据仅覆盖 {DATE_START} 至 {DATE_END}，请选择该范围内的期间。", "kind": "date"}
    except (ValueError, TypeError) as exc:
        return {"clarification": "日期不合法，请检查起止日期。", "kind": "date"}
    if any(w in q for w in ["环比","同比"]) and len(periods)==1:
        return {"clarification": "期间变化需要两个明确期间；例如“2026年9月对比2026年8月净收入”。同比基期若超出演示数据范围则无法查询。", "kind": "date"}
    if re.search(r"(?:毛收入.*[与和、].*净收入|净收入.*[与和、].*毛收入)",q):
        return {"clarification":"一次分析请选择一个主指标：毛收入或净收入。结果表仍会展示毛收入和退款供核对。", "kind":"metric"}
    if "退款" in q and any(w in q for w in ["比例", "占比", "率"]):
        if "金额" in q or "毛收入" in q: metric = "refund_amount_rate"
        elif "订单" in q: metric = "refund_order_rate"
        elif f.get("metric") in {"refund_amount_rate","refund_order_rate"}: metric=f["metric"]
        else: return {"clarification": "退款率按什么分母计算？请选择“退款金额 / 毛收入”或“退款订单数 / 订单数”。", "kind": "metric"}
    elif "退款" in q: metric = "refund_cents"
    elif "净" in q: metric = "net_cents"
    elif "毛" in q or "流水" in q: metric = "gross_cents"
    elif "订单" in q: metric = "orders"
    elif "席位" in q or "数量" in q: metric = "units"
    elif f.get("metric") in METRICS: metric = f["metric"]
    else: return {"clarification": "请选择分析指标：净收入、毛收入、订单数、退款金额或明确分母的退款比例。", "kind": "metric"}
    dimension = "product" if any(w in q for w in ["产品", "套餐", "版本"]) else "channel" if "渠道" in q else "summary"
    if len(periods)==2: dimension = "period"
    product, channel = f.get("product") or None, f.get("channel") or None
    for pid,name,_ in PRODUCTS:
        if pid.lower() in q.lower() or name.split(" ")[1] in q: product=pid
    for cid,name in CHANNELS.items():
        if name in q: channel=cid
    if product and product not in {p[0] for p in PRODUCTS}: raise ValueError("产品筛选值无效。")
    if channel and channel not in CHANNELS: raise ValueError("渠道筛选值无效。")
    return {"periods": periods, "metric": metric, "dimension": dimension, "product": product, "channel": channel}


AGG = """COUNT(*) AS orders, COALESCE(SUM(o.quantity),0) AS units,
 COALESCE(SUM(o.quantity*o.unit_price_cents),0) AS gross_cents,
 COALESCE(SUM(o.refund_cents),0) AS refund_cents,
 COALESCE(SUM(o.quantity*o.unit_price_cents-o.refund_cents),0) AS net_cents,
 SUM(CASE WHEN o.refund_cents>0 THEN 1 ELSE 0 END) AS refund_orders"""


def query_for(plan, period, dimension):
    expr = {"product": "p.name", "channel": "o.channel", "summary": "'全部'", "period": "'期间'"}[dimension]
    where = ["o.order_date BETWEEN ? AND ?"]
    params = list(period)
    for field in ["product", "channel"]:
        if plan.get(field):
            where.append("o."+("product_id" if field=="product" else "channel")+" = ?")
            params.append(plan[field])
    grouped = " GROUP BY "+expr if dimension in {"channel", "product"} else ""
    return f"SELECT {expr} AS label, {AGG} FROM orders o JOIN products p ON p.product_id=o.product_id WHERE {' AND '.join(where)}{grouped} ORDER BY label", params


def decorate_rows(rows, period=None):
    for row in rows:
        row["label"] = period or CHANNELS.get(row["label"], row["label"])
        row["refund_orders"] = row["refund_orders"] or 0
        row["refund_amount_rate"] = row["refund_cents"]/row["gross_cents"] if row["gross_cents"] else None
        row["refund_order_rate"] = row["refund_orders"]/row["orders"] if row["orders"] else None
    return rows


def amount(cents):
    return f"¥{cents/100:,.2f}"


def metric_text(value, metric):
    if value is None: return "无可用分母"
    if metric.endswith("_cents"): return amount(value)
    if metric.endswith("_rate"): return f"{value*100:.2f}%"
    return f"{value:,}"


def trace_append(run, stage, detail, **extra):
    run["trace"].append({"stage": stage, "detail": detail, "at_ms": round((time.perf_counter()-run["_started"])*1000,2), **extra})


def run_analysis(question, filters=None, mode="demo", path=DB_PATH):
    started=time.perf_counter()
    run={"id": "run_"+uuid.uuid4().hex[:12], "question": question, "created_at": dt.datetime.now(dt.timezone.utc).isoformat(), "mode": mode, "engine": "演示规则引擎" if mode=="demo" else "真实模型工具调用", "status":"running", "trace":[], "queries":[], "_started":started, "data_note":"固定合成数据；不是企业经营数据或真实用户验证。"}
    trace_append(run,"intent","识别指标、期间和比较维度；所有金额以整数分保存。")
    plan=parse_question(question,filters)
    run["plan"]=plan
    if plan.get("clarification"):
        run.update(status="needs_clarification", clarification=plan["clarification"])
        trace_append(run,"clarification",plan["clarification"])
    else:
        trace_append(run,"plan",f"指标：{METRICS[plan['metric']]}；维度：{plan['dimension']}；期间：{plan['periods']}")
        if mode=="llm":
            execute_llm(run,plan,path)
        elif mode=="demo":
            execute_demo(run,plan,path)
        else: raise ValueError("未知引擎模式。")
        build_report(run,plan)
        run["status"]="completed"
        trace_append(run,"complete","结果只根据已执行查询构建；未推断业务原因。")
    run["elapsed_ms"]=round((time.perf_counter()-started)*1000,2)
    run.pop("_started",None)
    return run


def execute_query(run,sql,params,path,label,period=None):
    qid=f"Q{len(run['queries'])+1}"
    trace_append(run,"sql",f"执行只读查询 {qid}：{label}",query_id=qid)
    result=read_sql(sql,params,path)
    result.update(id=qid,sql=sql,params=params,label=label)
    result["rows"]=decorate_rows(result["rows"],period)
    run["queries"].append(result)
    trace_append(run,"evidence",f"{qid} 返回 {len(result['rows'])} 行，来源：{', '.join(result['source_tables'])}",query_id=qid)
    return result


def execute_demo(run,plan,path):
    for period in plan["periods"]:
        sql,params=query_for(plan,period,plan["dimension"])
        execute_query(run,sql,params,path,"分组指标", " 至 ".join(period) if plan["dimension"]=="period" else None)
    # Independent total allows the interface and tests to verify group additivity.
    sql,params=query_for(plan,plan["periods"][0],"summary")
    execute_query(run,sql,params,path,"当前期间总览")


def llm_config():
    key=os.environ.get("METRICPILOT_API_KEY","")
    base=os.environ.get("METRICPILOT_BASE_URL","").rstrip("/")
    model=os.environ.get("METRICPILOT_MODEL","")
    return key,base,model


def execute_llm(run,plan,path):
    key,base,model=llm_config()
    if not all([key,base,model]): raise ValueError("真实模型模式尚未配置。设置 METRICPILOT_API_KEY、METRICPILOT_BASE_URL 和 METRICPILOT_MODEL 后重启。")
    u=urlparse(base)
    if u.scheme!="https" and not (u.scheme=="http" and u.hostname in {"127.0.0.1","localhost","::1"}):
        raise ValueError("模型接口必须使用 HTTPS，或本机 HTTP 服务。")
    if u.username or u.password or u.query or u.fragment: raise ValueError("模型接口地址格式不合法。")
    # The model selects the order of required queries. SQL is produced by our typed
    # analytics tool, preserving metric semantics and scope even if the model errs.
    wanted=[{"period_index":i,"dimension":plan["dimension"]} for i in range(len(plan["periods"]))]
    wanted.append({"period_index":0,"dimension":"summary"})
    # De-duplicate summary requests when already requested.
    wanted=list({(x["period_index"],x["dimension"]):x for x in wanted}.values())
    messages=[{"role":"system","content":"你是只读业务分析 Agent。必须调用 query_sales 完成所有 required_queries 后结束。禁止凭空输出数字、修改日期或指标；工具输出是唯一证据。最终内容由应用按证据生成。"}, {"role":"user","content":json.dumps({"question":run["question"],"confirmed_plan":plan,"required_queries":wanted},ensure_ascii=False)}]
    spec={"type":"function","function":{"name":"query_sales","description":"读取已确认日期和指标的精确销售聚合；只能使用 required_queries。","parameters":{"type":"object","properties":{"period_index":{"type":"integer","minimum":0,"maximum":1},"dimension":{"type":"string","enum":["summary","product","channel","period"]}},"required":["period_index","dimension"],"additionalProperties":False}}}
    done=set()
    for step in range(6):
        trace_append(run,"model",f"真实模型调用 {step+1}/6；下一步仅允许只读统计工具。")
        payload={"model":model,"messages":messages,"tools":[spec],"tool_choice":"auto","temperature":0,"max_tokens":2048}
        req=Request(base+"/chat/completions",data=json.dumps(payload).encode(),headers={"Content-Type":"application/json","Authorization":"Bearer "+key},method="POST")
        try:
            with urlopen(req,timeout=25) as resp:
                raw=resp.read(1_000_001)
                if len(raw)>1_000_000: raise ValueError("模型响应超出长度限制。")
                msg=json.loads(raw)["choices"][0]["message"]
        except HTTPError as exc: raise ValueError(f"模型接口返回 HTTP {exc.code}；请检查配置或额度。") from exc
        except (URLError,TimeoutError,KeyError,IndexError,TypeError,json.JSONDecodeError) as exc: raise ValueError("模型请求失败或格式不兼容；没有生成分析结论。") from exc
        if not isinstance(msg,dict) or not isinstance(msg.get("tool_calls",[]),list): raise ValueError("模型消息或工具调用格式不兼容。")
        messages.append({"role":"assistant","content":msg.get("content"),"tool_calls":msg.get("tool_calls",[])})
        calls=msg.get("tool_calls") or []
        if not calls:
            if len(done)==len(wanted): return
            messages.append({"role":"user","content":"仍有 required_queries 未执行，请继续调用工具。"})
            continue
        if len(calls)>6: raise ValueError("模型单步工具调用过多，已终止。")
        for call in calls:
            if not isinstance(call,dict) or not isinstance(call.get("function"),dict): raise ValueError("模型工具调用格式不兼容。")
            try:
                if call["function"]["name"]!="query_sales": raise ValueError("工具不在允许列表")
                args=json.loads(call["function"]["arguments"])
                k=(args["period_index"],args["dimension"])
                if args not in wanted or len(args)!=2: raise ValueError("工具参数超出已确认范围")
                if k in done: result={"error":"已执行，请勿重复"}
                else:
                    period=plan["periods"][k[0]]; sql,params=query_for(plan,period,k[1])
                    result=execute_query(run,sql,params,path,"真实模型选择统计工具"," 至 ".join(period) if k[1]=="period" else None)
                    done.add(k)
            except (ValueError,KeyError,TypeError) as exc: result={"error":str(exc)}
            messages.append({"role":"tool","tool_call_id":call.get("id",""),"content":json.dumps(result,ensure_ascii=False)})
        if len(done)==len(wanted): return
    raise ValueError("模型在 6 步内未完成所需查询；本次不生成结论。")


def build_report(run,plan):
    dimension=plan["dimension"]
    # Locate totals by query scope rather than relying on model call order.
    grouped=[]
    for q in run["queries"]:
        if dimension=="period":
            if q["rows"] and " 至 " in str(q["rows"][0]["label"]): grouped.extend([{**r,"evidence":q["id"]} for r in q["rows"]])
        elif " GROUP BY " in q["sql"] or (dimension=="summary" and not grouped):
            grouped.extend([{**r,"evidence":q["id"]} for r in q["rows"]])
    if dimension=="period":
        labels=[" 至 ".join(p) for p in plan["periods"]]
        grouped.sort(key=lambda r:labels.index(r["label"]))
    totals=next((q for q in run["queries"] if " GROUP BY " not in q["sql"] and q["params"][:2]==list(plan["periods"][0]) and q["rows"][0]["label"]=="全部"),None)
    if totals is None:
        # Period aggregate has exactly the same total when no separate summary was issued.
        totals=next(q for q in run["queries"] if q["params"][:2]==list(plan["periods"][0]) and len(q["rows"])==1)
    total=totals["rows"][0]
    metric=plan["metric"]
    findings=[]
    if len(grouped)>1 and dimension!="period":
        valid=[r for r in grouped if r[metric] is not None]
        if valid:
            winner=max(valid,key=lambda r:r[metric])
            findings.append({"text":f"{winner['label']} 的{METRICS[metric]}最高，为 {metric_text(winner[metric],metric)}。","evidence":[winner["evidence"]]})
    elif dimension=="period" and len(grouped)==2:
        a,b=grouped; delta=a[metric]-b[metric] if a[metric] is not None and b[metric] is not None else None
        if delta is not None:
            change=f"{delta*100:+.2f} 个百分点" if metric.endswith("_rate") else (("增加 " if delta>=0 else "减少 ")+metric_text(abs(delta),metric))
            pct=(f"；相对变化 {delta/abs(b[metric])*100:+.2f}%" if b[metric] and not metric.endswith("_rate") else "")
            findings.append({"text":f"第一个期间对比第二个期间：{METRICS[metric]}变化 {change}{pct}。","evidence":[a["evidence"],b["evidence"]]})
    findings.append({"text":f"当前期间共 {total['orders']:,} 笔订单；毛收入 {amount(total['gross_cents'])}，退款 {amount(total['refund_cents'])}，净收入 {amount(total['net_cents'])}。","evidence":[totals["id"]]})
    run["report"]={"title":METRICS[metric]+"分析", "metric":metric,"metric_label":METRICS[metric],"period":" 至 ".join(plan["periods"][0]),"rows":grouped,"totals":{**total,"evidence":totals["id"]},"findings":findings,"limitations":["固定合成数据；结果只验证分析链路，不代表真实商业效果。","按订单发生日归属退款；净收入 = 毛收入 − 关联退款，不含税费、折扣、获客成本和现金到账时差。","退款金额占比以毛收入为分母；退款订单占比以订单数为分母；不能据此判断变化原因。"]}


def saved_sessions():
    with LOCK:
        if not SESSION_PATH.exists(): return []
        try: return json.loads(SESSION_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError,OSError): return []


def save_session(run):
    with LOCK:
        sessions=saved_sessions(); sessions.insert(0,run)
        tmp=SESSION_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(sessions[:40],ensure_ascii=False,indent=2),encoding="utf-8")
        tmp.replace(SESSION_PATH)


def metadata():
    return {"name":"MetricPilot", "csrf_token":CSRF_TOKEN, "date_start":DATE_START,"date_end":DATE_END,"products":[{"id":p[0],"name":p[1]} for p in PRODUCTS],"channels":[{"id":k,"name":v} for k,v in CHANNELS.items()],"metrics":METRICS,"llm_configured":all(llm_config()),"source":"固定合成 SaaS 订单；版本 synthetic-v1；273 天 × 3 个产品 × 3 个渠道 = 2,457 笔订单。","schema":{"orders":{"order_id":"合成订单 ID","order_date":"订单日期 YYYY-MM-DD","product_id":"产品 ID","channel":"渠道 ID","quantity":"授权席位数","unit_price_cents":"单价（分）","refund_cents":"关联退款（分）"},"products":{"product_id":"产品 ID","name":"套餐名称","unit_price_cents":"固定单价（分）"}}}


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)
    def valid_host(self):
        return self.headers.get("Host","") in {f"127.0.0.1:{self.server.server_port}",f"localhost:{self.server.server_port}"}
    def log_message(self,*args): pass
    def respond(self,status,payload):
        body=json.dumps(payload,ensure_ascii=False).encode()
        self.send_response(status); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Cache-Control","no-store"); self.send_header("X-Content-Type-Options","nosniff"); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if not self.valid_host(): return self.respond(403,{"error":"Host 必须为本机服务地址"})
        path=urlparse(self.path).path
        try:
            if path=="/api/health": return self.respond(200,{"app":"MetricPilot","status":"ok"})
            if path=="/api/meta": return self.respond(200,metadata())
            if path=="/api/sessions": return self.respond(200,[{k:r.get(k) for k in ["id","question","status","created_at","mode","elapsed_ms"]} for r in saved_sessions()])
            if path.startswith("/api/session/"):
                run=next((r for r in saved_sessions() if r["id"]==path.rsplit("/",1)[1]),None)
                return self.respond(200,run) if run else self.respond(404,{"error":"会话不存在"})
            if path=="/api/source":
                return self.respond(200,read_sql("SELECT * FROM orders ORDER BY order_date DESC, order_id LIMIT 30"))
            filename={"/":"index.html","/app.js":"app.js","/style.css":"style.css"}.get(path)
            if not filename: return self.respond(404,{"error":"页面不存在"})
            body=(ROOT/"static"/filename).read_bytes()
            self.send_response(200); self.send_header("Content-Type",{"html":"text/html; charset=utf-8","js":"text/javascript; charset=utf-8","css":"text/css; charset=utf-8"}[filename.rsplit(".",1)[1]])
            self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'")
            self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
        except Exception as exc: self.respond(500,{"error":"读取失败："+str(exc)})
    def do_POST(self):
        # Consume bounded request bodies before sending a rejection. Closing a
        # Windows TCP socket with unread request bytes can otherwise reset the
        # connection and hide the intended 4xx response from the client.
        if self.headers.get("Transfer-Encoding"): return self.respond(400,{"error":"不接受分块请求"})
        try:
            if len(self.headers.get_all("Content-Length",[]))!=1: return self.respond(400,{"error":"必须提供单一 Content-Length"})
            length=int(self.headers.get("Content-Length","0"))
            if not 0<length<=16000: return self.respond(413,{"error":"请求长度不合法"})
            raw_body=self.rfile.read(length)
            if len(raw_body)!=length: return self.respond(400,{"error":"请求内容不完整"})
        except (ValueError,TimeoutError): return self.respond(400,{"error":"请求长度不合法或读取超时"})
        if not self.valid_host(): return self.respond(403,{"error":"Host 必须为本机服务地址"})
        origin=self.headers.get("Origin")
        if origin not in {f"http://127.0.0.1:{self.server.server_port}",f"http://localhost:{self.server.server_port}"}: return self.respond(403,{"error":"必须提供匹配本机服务的 Origin"})
        if not secrets.compare_digest(self.headers.get("X-CSRF-Token",""),CSRF_TOKEN): return self.respond(403,{"error":"CSRF 校验失败"})
        if "application/json" not in self.headers.get("Content-Type",""): return self.respond(415,{"error":"仅接受 JSON"})
        try:
            body=json.loads(raw_body)
            if urlparse(self.path).path=="/api/run":
                run=run_analysis(body.get("question",""),body.get("filters",{}),body.get("mode","demo"))
                save_session(run); return self.respond(200,run)
            if urlparse(self.path).path=="/api/sql": return self.respond(200,read_sql(body.get("sql",""),body.get("params",[])))
            return self.respond(404,{"error":"接口不存在"})
        except (ValueError,TypeError,AttributeError) as exc: self.respond(400,{"error":str(exc)})
        except Exception: self.respond(500,{"error":"分析执行失败；没有生成结论，请查看服务端控制台。"})


def main():
    import argparse
    parser=argparse.ArgumentParser(description="MetricPilot local portfolio demo")
    parser.add_argument("--port",type=int,default=8766)
    args=parser.parse_args()
    seed_database()
    server=ThreadingHTTPServer(("127.0.0.1",args.port),Handler)
    print(f"MetricPilot 已启动：http://127.0.0.1:{args.port}（固定合成数据；Ctrl+C 退出）",flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__=="__main__": main()

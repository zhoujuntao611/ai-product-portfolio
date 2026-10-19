"""Single-order-table analytics: typed, read-only tools and evidence-bound reports."""
from __future__ import annotations

import calendar
import datetime as dt
import json
import re
import sqlite3
import time
import uuid

METRICS = {"gross_cents": "毛收入", "net_cents": "净收入", "refund_cents": "退款金额",
           "orders": "订单数", "refund_amount_rate": "退款金额 / 毛收入",
           "refund_order_rate": "退款订单数 / 订单数"}


def clarify(message, kind):
    return {"clarification": message, "kind": kind}


def month_range(year, month):
    return [f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]}"]


def parse_question(question, filters=None, dataset=None):
    if not isinstance(question, str) or not 1 <= len(question.strip()) <= 1000:
        raise ValueError("请输入 1–1,000 字的问题。")
    f, dataset, q = filters or {}, dataset or {}, question.strip()
    if not isinstance(f, dict) or set(f) - {"start", "end", "metric", "channel"}:
        raise ValueError("筛选仅支持 start、end、metric、channel。")
    if any(not isinstance(v, str) for v in f.values()):
        raise ValueError("筛选值必须为文本。")
    if re.search(r"原因|为什么|为何|效率|ROI|ROAS|获客|转化|用户|复购|留存|利润|预测|归因|客单价|产品|套餐|地区|商品|税|折扣", q, re.I):
        return clarify("当前订单表只支持收入概览、渠道金额比较和退款分析。原因、渠道效率或用户行为需要成本、流量、用户等相关字段；请改为明确指标的描述性统计。", "scope")
    if re.search(r"按日|按天|每日|每天|每周|按月|每月|大于|小于|高于|低于|超过|少于|排除|剔除|TOP\s*\d|前\s*\d|换汇|兑换", q, re.I):
        return clarify("首版支持整段期间汇总和渠道比较。金额条件、时间序列和换汇暂不支持；取消订单请用口径选项确认。", "scope")
    if re.search(r"不含|不包含|未退款|无退款|已完成|已支付|未支付|待支付|取消订单|状态|(?:completed|refunded|cancelled|canceled|pending|paid)\s*订单", q, re.I):
        return clarify("首版暂不支持问题中的订单状态或退款条件筛选；取消订单使用口径选项确认，其他条件请先在源表整理。", "scope")
    if re.search(r"最近|上个?月|本月|今天|昨日|昨天|去年|今年|近\d", q):
        return clarify("请明确年份和起止期间，例如 2026-01-01 至 2026-01-31；相对时间需要先换成明确日期。", "date")
    without_slash_dates = re.sub(r"\d{4}/\d{1,2}(?:/\d{1,2})?", "", q)
    ratio = any(w in q for w in ["占比", "比例", "率", "除以", "÷"]) or "/" in without_slash_dates
    if ratio and "退款" in q:
        # Explicit denominators must match the supported metric contract. Do
        # not turn an unknown business term into gross revenue by keyword.
        explicit_ratios = re.findall(r"(退款金额|退款订单数?)\s*(?:占(?!比)|/|÷|除以)\s*([\s\S]+)", q)
        for numerator, denominator in explicit_ratios:
            expected = "毛收入" if numerator == "退款金额" else "订单数"
            # Match the entire remaining expression, including text after
            # whitespace/punctuation. A valid prefix is not a valid formula.
            denominator = re.sub(r"\s+", "", denominator).strip("，,。；;?？!！")
            ending = r"(?:的?(?:比例|占比|比率|率))?(?:的?(?:变化|比较|对比))?(?:(?:是|为|有)?(?:多少|几|百分之多少))?(?:呢|呀|啊|吗)?"
            if not re.fullmatch(re.escape(expected) + ending, denominator):
                return clarify("首版只支持退款金额 / 毛收入，或退款订单数 / 订单数；分母中的运算、附加条件或其他定义尚未支持，请确认。", "metric")
        if "退款金额" in q and "退款订单" in q:
            return clarify("两种退款占比的分母不同，请一次选择退款金额 / 毛收入，或退款订单数 / 订单数。", "metric")
        if (re.search(r"退款金额.*(?:占|/|除以).*订单", q)
                or re.search(r"退款订单.*(?:占|/|除以).*收入", q)
                or re.search(r"退款.*(?:占|/|除以).*净收入", q)):
            return clarify("首版只支持退款金额 / 毛收入，或退款订单数 / 订单数；请确认所需分母。", "metric")
    elif ratio and any(w in q for w in ["占比", "比例", "除以"]):
        return clarify("收入占比的分母尚未支持；请选择收入金额，或明确的两种退款占比。", "metric")
    if not ratio and len([term for term in ["毛收入", "净收入", "退款金额", "订单数"] if term in q]) > 1:
        return clarify("请选择一个主指标；报告总览会同时列出收入、退款和订单数供核对。", "metric")
    if not ratio and "退款订单" in q:
        return clarify("请选择退款订单占比或退款金额；退款订单数会在原始结果中列出供复核。", "metric")
    dates = re.findall(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)", q)
    months = re.findall(r"(\d{4})\s*[年/-]\s*(\d{1,2})(?:月|(?=\s|$|[^\d-]))", q)
    quarter = re.search(r"(\d{4})\s*年?\s*(?:第?([一二三四1234])季度|[Qq]([1-4]))", q)
    if (dates and (months or quarter)) or (months and quarter):
        return clarify("检测到混合的日期、月份或季度条件；请统一为两个带年份的月份比较，或一组完整起止日期，避免遗漏期间。", "date")
    if len(re.findall(r"第?[一二三四1234]季度|[Qq][1-4]", q)) > 1:
        return clarify("季度比较请先换成两个带年份的明确月份，或分别查询完整起止日期，避免遗漏比较期间。", "date")
    try:
        if dates:
            if len(dates) != 2:
                return clarify("请提供一组完整起止日期，例如 2026-01-01 至 2026-01-31。", "date")
            periods = [dates]
        elif quarter:
            k = quarter.group(2) or quarter.group(3)
            n = "一二三四".index(k) + 1 if k in "一二三四" else int(k)
            year = int(quarter.group(1))
            periods = [[month_range(year, n*3-2)[0], month_range(year, n*3)[1]]]
        elif months:
            if len(months) > 1 and not any(w in q for w in ["对比", "比较", "与", "和", "环比", "同比"]):
                return clarify("月份区间请转换成完整起止日期；两个期间比较请明确写出“对比”。", "date")
            periods = [month_range(int(y), int(m)) for y, m in months]
            mentions = re.findall(r"(?<!\d)(?:1[0-2]|0?[1-9])月", q)
            if len(mentions) > len(months):
                return clarify("每个期间都需要年份，例如 2026年2月对比2026年1月。", "date")
        elif f.get("start") and f.get("end"):
            periods = [[f["start"], f["end"]]]
        else:
            return clarify("请明确年份和期间，或选择起止日期；不会自动使用整份表的日期范围。", "date")
        if len(periods) > 2:
            return clarify("一次支持一个期间或两个明确期间的比较。", "date")
        for start, end in periods:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end):
                raise ValueError()
            if dt.date.fromisoformat(start) > dt.date.fromisoformat(end):
                raise ValueError()
        if dates or months or quarter:
            if f.get("start") or f.get("end"):
                if [f.get("start"), f.get("end")] != periods[0]:
                    return clarify("问题中的期间与日期筛选不同，请统一后重新分析。", "date")
    except (ValueError, TypeError, OverflowError):
        return clarify("日期不合法或起始日期晚于结束日期，请检查年月日。", "date")
    if any(w in q for w in ["环比", "同比", "变化", "增长"]) and len(periods) != 2:
        return clarify("变化比较需要两个明确期间，例如 2026年2月对比2026年1月净收入。", "date")
    if "毛收入" in q and "净收入" in q:
        return clarify("请选择一个主指标：毛收入或净收入；总览会同时列出收入和退款供复核。", "metric")
    if "退款" in q and ratio:
        if "金额" in q or "毛收入" in q:
            metric = "refund_amount_rate"
        elif "订单" in q:
            metric = "refund_order_rate"
        elif f.get("metric") in {"refund_amount_rate", "refund_order_rate"}:
            metric = f["metric"]
        else:
            return clarify("退款率的分母是什么？请选择退款金额 / 毛收入，或退款订单数 / 订单数。", "metric")
    elif "退款" in q:
        metric = "refund_cents"
    elif "净收入" in q:
        metric = "net_cents"
    elif "毛收入" in q or "流水" in q:
        metric = "gross_cents"
    elif "订单数" in q or "多少订单" in q:
        metric = "orders"
    elif f.get("metric") in METRICS:
        metric = f["metric"]
    else:
        return clarify("请选择毛收入、净收入、退款金额、订单数或明确分母的退款占比。", "metric")
    if f.get("metric") and f["metric"] != metric:
        return clarify("问题中的指标与指标筛选不同，请统一后重新分析。", "metric")
    if metric not in {"gross_cents", "orders"} and not dataset.get("capabilities", {}).get("refunds"):
        return clarify("这份表没有已确认的退款金额，无法计算净收入或退款指标。请映射退款列，或在导入时明确确认无退款。", "field")
    dimension = "channel" if "渠道" in q else "summary"
    if len(periods) == 2:
        if dimension == "channel":
            return clarify("首版请分别进行渠道比较或两个期间比较，一次只选一种分组。", "scope")
        dimension = "period"
    channel = f.get("channel") or None
    named_channels = [c for c in dataset.get("channels", []) if c and re.search(r"(?<![A-Za-z0-9_])" + re.escape(c) + r"(?![A-Za-z0-9_])", q)]
    if len(named_channels) > 1:
        return clarify("检测到多个指定渠道；首版请比较全部渠道，或在渠道筛选中选择一个。", "channel")
    if named_channels:
        if channel and channel != named_channels[0]:
            return clarify("问题中指定的渠道与渠道筛选不同，请统一后分析。", "channel")
        channel = named_channels[0]
    elif dimension == "channel":
        without_dates = re.sub(r"\d{4}-\d{2}-\d{2}|\d{4}\s*[年/-]\s*\d{1,2}月?", "", q)
        prefix = re.search(r"([A-Za-z0-9_\u4e00-\u9fff]+)渠道", without_dates)
        if prefix and not re.fullmatch(r"(?:比较|对比|按|分)?(?:哪个|哪些|各|各个|所有|不同)?", prefix.group(1)):
            return clarify("渠道名称未能明确匹配，请在渠道筛选中选择，或改问各渠道的指标比较。", "channel")
    if channel and channel not in dataset.get("channels", []):
        raise ValueError("渠道筛选值不在当前数据中。")
    if (dimension == "channel" or channel) and not dataset.get("capabilities", {}).get("channel"):
        return clarify("未映射渠道字段，不能进行渠道比较。请重新导入并映射渠道列。", "field")
    return {"periods": periods, "metric": metric, "dimension": dimension, "channel": channel}


def validate_contract(contract, dataset):
    if not isinstance(contract, dict) or contract.get("confirmed") is not True:
        return clarify("分析前请确认退款日期归属、取消订单处理和金额单位。", "contract")
    if set(contract) - {"confirmed", "refund_basis", "cancelled", "cancelled_values"}:
        raise ValueError("口径包含未知参数。")
    if contract.get("refund_basis") not in {"order_date", "refund_date"}:
        return clarify("请选择退款按原订单日还是退款发生日归属。", "contract")
    if contract.get("cancelled") not in {"exclude", "include"}:
        return clarify("请选择排除还是保留取消订单。", "contract")
    values = contract.get("cancelled_values", [])
    if not isinstance(values, list) or len(values) > 30 or any(not isinstance(x, str) or not x or len(x) > 100 for x in values):
        raise ValueError("取消状态值应为不超过 30 项的非空文本数组。")
    if dataset.get("capabilities", {}).get("status") and contract["cancelled"] == "exclude" and not values:
        return clarify("请指定状态列中哪些值表示取消；不会自动猜测。", "contract")
    if contract["refund_basis"] == "refund_date" and not dataset.get("capabilities", {}).get("refund_dates"):
        return clarify("按退款发生日统计需要有效退款日期字段，请映射退款日期，或确认按原订单日归属。", "field")
    return None


def validate_question_contract(question, contract):
    """Reject a stated refund attribution that conflicts with the confirmed UI."""
    asks_refund_date = bool(re.search(r"按退款(?:发生)?(?:日期|日)|退款(?:按|归属(?:到)?|计入)(?:发生日|退款(?:发生)?(?:日期|日))", question))
    asks_order_date = bool(re.search(r"按(?:原)?订单(?:日期|日)|按下单(?:日期|日)|退款(?:按|归属(?:到)?|计入)(?:原)?订单(?:日期|日)", question))
    if asks_refund_date and asks_order_date:
        return clarify("一个问题只能选择一种退款日期归属；请统一问题和口径选项后重新分析。", "contract")
    requested = "refund_date" if asks_refund_date else "order_date" if asks_order_date else None
    if requested and requested != contract["refund_basis"]:
        return clarify("问题中的退款日期归属与已确认口径不同；请统一为原订单日或退款发生日后重新分析。", "contract")
    return None


def dataset_info(dataset):
    return {k: v for k, v in dataset.items() if k != "orders" and not k.startswith("_")}


def execute_tool(dataset, contract, params):
    """No SQL input accepted. Only two dimensions and explicit date/channel parameters."""
    problem = validate_contract(contract, dataset)
    if problem:
        raise ValueError(problem["clarification"])
    if not isinstance(params, dict) or set(params) - {"period", "dimension", "channel"}:
        raise ValueError("工具仅接受 period、dimension、channel 参数，不接受 SQL。")
    period, dimension = params.get("period"), params.get("dimension")
    if not isinstance(period, (list, tuple)) or len(period) != 2 or dimension not in {"summary", "channel"}:
        raise ValueError("工具期间或分组参数无效。")
    try:
        if any(not isinstance(s, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s) for s in period):
            raise ValueError()
        start, end = [dt.date.fromisoformat(s).isoformat() for s in period]
        if start > end:
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError("工具起止日期无效。") from None
    channel = params.get("channel")
    if channel is not None and (not isinstance(channel, str) or channel not in dataset["channels"]):
        raise ValueError("工具渠道不在当前数据中。")
    if (dimension == "channel" or channel is not None) and not dataset["capabilities"].get("channel"):
        raise ValueError("渠道字段未映射。")
    started = time.perf_counter()
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    try:
        con.execute("CREATE TABLE orders(order_id TEXT,order_date TEXT,gross_cents INTEGER,refund_cents INTEGER,refund_date TEXT,channel TEXT,status TEXT,source_row INTEGER)")
        fields = ["order_id", "order_date", "gross_cents", "refund_cents", "refund_date", "channel", "status", "source_row"]
        con.executemany("INSERT INTO orders VALUES(?,?,?,?,?,?,?,?)", [[o.get(k) for k in fields] for o in dataset["orders"]])
        con.commit()
        con.execute("PRAGMA query_only=ON")
        def authorize(action, a, b, db, source):
            if action == sqlite3.SQLITE_SELECT or (action == sqlite3.SQLITE_READ and a == "orders"):
                return sqlite3.SQLITE_OK
            if action == sqlite3.SQLITE_FUNCTION and (b or "").lower() in {"sum", "coalesce"}:
                return sqlite3.SQLITE_OK
            return sqlite3.SQLITE_DENY
        con.set_authorizer(authorize)
        con.set_progress_handler(lambda: int(time.perf_counter() - started > 2), 1000)
        refund_date = "order_date" if contract["refund_basis"] == "order_date" else "refund_date"
        # Date expressions and identifiers come exclusively from enums. User values bind as parameters.
        gross = "COALESCE(SUM(CASE WHEN order_date BETWEEN ? AND ? THEN gross_cents ELSE 0 END),0)"
        refunds = f"COALESCE(SUM(CASE WHEN {refund_date} BETWEEN ? AND ? THEN refund_cents ELSE 0 END),0)"
        orders = "COALESCE(SUM(CASE WHEN order_date BETWEEN ? AND ? THEN 1 ELSE 0 END),0)"
        refund_orders = f"COALESCE(SUM(CASE WHEN {refund_date} BETWEEN ? AND ? AND refund_cents>0 THEN 1 ELSE 0 END),0)"
        if not dataset["capabilities"].get("refunds"):
            refunds, refund_orders = "NULL", "NULL"
        where = f"(order_date BETWEEN ? AND ? OR ({refund_date} BETWEEN ? AND ? AND refund_cents>0))"
        where_params = [start, end, start, end]
        if contract["cancelled"] == "exclude" and contract.get("cancelled_values"):
            where += " AND COALESCE(status,'') NOT IN (" + ",".join("?" for _ in contract["cancelled_values"]) + ")"
            where_params += contract["cancelled_values"]
        if channel is not None:
            where += " AND channel=?"
            where_params.append(channel)
        label = "channel" if dimension == "channel" else "'全部'"
        sql = f"SELECT {label} AS label,{gross} AS gross_cents,{refunds} AS refund_cents,{orders} AS orders,{refund_orders} AS refund_orders FROM orders WHERE {where}"
        if dimension == "channel":
            sql += " GROUP BY channel ORDER BY channel"
        sql_params = [start, end] * (4 if dataset["capabilities"].get("refunds") else 2) + where_params
        rows = [dict(r) for r in con.execute(sql, sql_params)]
        if len(rows) > 200:
            raise ValueError("渠道分组超过 200 个，请用渠道筛选缩小范围。")
        raw_rows = json.loads(json.dumps(rows))
        for r in rows:
            if not dataset["capabilities"].get("refunds"):
                r.update(refund_cents=None, refund_orders=None)
            r["net_cents"] = r["gross_cents"] - r["refund_cents"] if r["refund_cents"] is not None else None
            r["refund_amount_rate"] = r["refund_cents"] / r["gross_cents"] if r["gross_cents"] and r["refund_cents"] is not None else None
            r["refund_order_rate"] = r["refund_orders"] / r["orders"] if r["orders"] and r["refund_orders"] is not None else None
        source_rows = [r[0] for r in con.execute("SELECT source_row FROM orders WHERE " + where + " ORDER BY source_row", where_params)]
        return {"tool": "query_orders", "params": {"period": [start, end], "dimension": dimension, "channel": channel},
                "sql": sql, "sql_params": sql_params, "rows": rows, "raw_rows": raw_rows,
                "columns": list(rows[0]) if rows else [], "source_tables": ["orders"],
                "source_rows": source_rows, "source_hash": dataset["source_hash"], "dataset_id": dataset["id"],
                "filters": {"period": [start, end], "channel": channel, "refund_basis": contract["refund_basis"],
                            "cancelled": contract["cancelled"], "cancelled_values": contract.get("cancelled_values", [])},
                "elapsed_ms": round((time.perf_counter() - started)*1000, 2)}
    except sqlite3.Error as exc:
        raise ValueError("受约束统计工具执行失败：" + str(exc)) from exc
    finally:
        con.close()


def definitions(dataset, contract):
    scale = dataset.get("currency_scale", 1 if dataset["currency"] == "JPY" else 100)
    basis = contract["refund_basis"]
    return [
        f"币种 {dataset['currency']}；输入单位 {dataset.get('amount_unit', 'major')}；内部整数最小单位，1 主单位 = {scale} 最小单位。金额为表内订单总额，不自动叠加税费或扣除折扣。",
        "毛收入 = 期间内订单金额之和；净收入 = 毛收入 − 按所选日期归属的退款金额。",
        "退款金额占比 = 退款金额 / 毛收入；退款订单占比 = 有正退款金额的订单数 / 订单数。零分母为不可计算。",
        ("退款按原订单日期归属：期间订单队列中已记录的全部退款，不区分实际退款日；结果是当前表快照的队列口径。" if basis == "order_date" else
         "退款按退款发生日期归属：毛收入/订单数按订单日，退款金额/退款订单数按退款日。分子可能来自更早订单，两种占比可能超过 100%，不等同订单队列退款率。"),
        f"日期按日粒度、起止日均包含；退款为单笔订单累计退款，只支持一行一单和一个退款归属日。取消订单：{'排除' if contract['cancelled'] == 'exclude' else '保留'}；取消状态值：{json.dumps(contract.get('cancelled_values', []), ensure_ascii=False)}（精确匹配）。",
    ]


def format_value(value, metric, dataset):
    if value is None:
        return "不可计算"
    if metric.endswith("_rate"):
        return f"{value*100:.2f}%"
    if metric.endswith("_cents"):
        scale = dataset.get("currency_scale", 1 if dataset["currency"] == "JPY" else 100)
        whole, fraction = divmod(abs(value), scale)
        exact = f"{whole:,}" + (f".{fraction:02d}" if scale == 100 else "")
        return f"{dataset['currency']} {'-' if value < 0 else ''}{exact}"
    return f"{value:,}"


def run_analysis(question, filters=None, dataset=None, contract=None, mode="demo"):
    if not dataset or not dataset.get("orders"):
        raise ValueError("请先导入并确认一份订单 CSV。")
    if mode != "demo":
        raise ValueError("CSV 首版使用本机受约束统计引擎；当前未启用外部模型。")
    started = time.perf_counter()
    run = {"id": "run_" + uuid.uuid4().hex[:12], "question": question,
           "created_at": dt.datetime.now(dt.timezone.utc).isoformat(), "mode": "demo", "engine": "订单分析引擎",
           "dataset": dataset_info(dataset), "contract": contract, "status": "running", "queries": [], "trace": [],
           "data_note": "用户导入订单 CSV；源文件 SHA-256：" + dataset["source_hash"]}
    def trace(stage, detail):
        run["trace"].append({"stage": stage, "detail": detail, "at_ms": round((time.perf_counter() - started)*1000, 2)})
    trace("intent", "识别期间、主指标与分组，复核已确认口径。")
    plan = parse_question(question, filters, dataset)
    if not plan.get("clarification"):
        problem = validate_contract(contract, dataset) or validate_question_contract(question, contract)
        if problem:
            plan = problem
    run["plan"] = plan
    if plan.get("clarification"):
        run.update(status="needs_clarification", clarification=plan["clarification"])
        trace("clarification", plan["clarification"])
    else:
        trace("plan", json.dumps(plan, ensure_ascii=False))
        grouped, totals_query = [], None
        for i, period in enumerate(plan["periods"]):
            dimension = "channel" if plan["dimension"] == "channel" else "summary"
            result = execute_tool(dataset, contract, {"period": period, "dimension": dimension, "channel": plan["channel"]})
            result.update(id=f"Q{len(run['queries']) + 1}", label="渠道比较" if dimension == "channel" else "期间总览")
            run["queries"].append(result)
            trace("evidence", f"{result['id']}：query_orders 返回 {len(result['rows'])} 行，已绑定筛选、源行与文件指纹。")
            grouped += [{**r, "label": " 至 ".join(period) if plan["dimension"] == "period" else r["label"], "evidence": result["id"]} for r in result["rows"]]
            if i == 0 and dimension == "summary":
                totals_query = result
        if totals_query is None:
            totals_query = execute_tool(dataset, contract, {"period": plan["periods"][0], "dimension": "summary", "channel": plan["channel"]})
            totals_query.update(id=f"Q{len(run['queries']) + 1}", label="当前期间总览")
            run["queries"].append(totals_query)
        total = {**totals_query["rows"][0], "evidence": totals_query["id"]}
        metric, findings = plan["metric"], []
        if plan["dimension"] == "channel" and grouped:
            valid = [r for r in grouped if r[metric] is not None]
            if valid:
                peak = max(r[metric] for r in valid)
                winners = [r["label"] for r in valid if r[metric] == peak]
                findings.append({"text": f"{'、'.join(winners)} 的{METRICS[metric]}{'并列' if len(winners)>1 else ''}最高，为 {format_value(peak, metric, dataset)}。", "evidence": [valid[0]["evidence"]]})
        if plan["dimension"] == "period" and len(grouped) == 2:
            a, b = grouped
            if a[metric] is not None and b[metric] is not None:
                delta = a[metric] - b[metric]
                change = f"{delta*100:+.2f} 个百分点" if metric.endswith("_rate") else (("增加 " if delta >= 0 else "减少 ") + format_value(abs(delta), metric, dataset))
                findings.append({"text": f"第一个期间对比第二个期间，{METRICS[metric]}{change}。", "evidence": [a["evidence"], b["evidence"]]})
        findings.append({"text": f"当前期间 {total['orders']} 笔订单，毛收入 {format_value(total['gross_cents'], 'gross_cents', dataset)}，退款 {format_value(total['refund_cents'], 'refund_cents', dataset)}，净收入 {format_value(total['net_cents'], 'net_cents', dataset)}。", "evidence": [total["evidence"]]})
        if metric.endswith("_rate"):
            numerator = total["refund_cents"] if metric == "refund_amount_rate" else total["refund_orders"]
            denominator = total["gross_cents"] if metric == "refund_amount_rate" else total["orders"]
            findings.append({"text": f"{METRICS[metric]}为 {format_value(total[metric], metric, dataset)}；原始分子 {numerator}，原始分母 {denominator}（金额使用整数最小单位）。", "evidence": [total["evidence"]]})
        notes = ["数据覆盖范围仅代表导入文件，不能据此证明期间订单完整或退款已全部发生。", "当前字段支持描述性统计；没有成本、流量和用户行为字段，无法判断渠道效率或收入变化原因。"]
        if not dataset["capabilities"].get("status"):
            notes.append("未映射状态列，无法识别取消订单；全部表内订单按当前已确认范围计算。")
        if not dataset["capabilities"].get("refunds"):
            notes.append("未提供退款金额；退款、净收入及退款占比保留为未知。")
        run["report"] = {"title": METRICS[metric] + "分析", "metric": metric, "metric_label": METRICS[metric],
                         "period": " 至 ".join(plan["periods"][0]), "rows": grouped, "totals": total,
                         "findings": findings, "definitions": definitions(dataset, contract), "limitations": notes}
        run["status"] = "completed"
        trace("complete", "结论由本次查询结果生成；口径、筛选与原始结果可随报告导出。")
    run["elapsed_ms"] = round((time.perf_counter() - started)*1000, 2)
    return run

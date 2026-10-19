"""Inspectable, bounded CSV import for one row per order (standard library only).

The preview is a draft, never a dataset. Every commit repeats validation with
the user's explicit units, date format, currency and data-cleaning choices.
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import re
import uuid


MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 10_000
MAX_COLUMNS = 50
MAX_SAFE_CENTS = 9_007_199_254_740_991
TEMPLATE_HELP = "请使用可下载的单张订单 CSV 示例模板；每笔订单一行，退款金额与订单放在同一行。"
REQUIRED_FIELDS = ("order_id", "order_date", "gross_amount")
OPTIONAL_FIELDS = ("refund_amount", "refund_date", "channel", "status", "currency")
FIELDS = REQUIRED_FIELDS + OPTIONAL_FIELDS
CURRENCIES = {"CNY", "USD", "EUR", "GBP", "JPY"}
ALIASES = {
    "order_id": {"orderid", "ordernumber", "orderno", "订单号", "订单编号", "订单id"},
    "order_date": {"orderdate", "createdat", "createddate", "date", "订单日期", "下单日期", "下单时间", "日期"},
    "gross_amount": {"grossamount", "gross", "grosscents", "amount", "total", "totalamount", "orderamount", "订单金额", "金额", "毛收入", "实付金额"},
    "refund_amount": {"refundamount", "refund", "refundcents", "退款金额", "退款"},
    "refund_date": {"refunddate", "refundedat", "退款日期", "退款时间"},
    "channel": {"channel", "source", "渠道", "订单渠道", "来源渠道"},
    "status": {"status", "orderstatus", "订单状态", "状态"},
    "currency": {"currency", "currencycode", "币种", "货币"},
}


def _issue(code, severity, message, rows=None, options=None):
    result = {"code": code, "severity": severity, "message": message}
    if rows:
        result["rows"] = sorted(set(rows))
    if options:
        result["options"] = options
    return result


def _header_key(value):
    return re.sub(r"[\s_\-]+", "", value).lower()


def preview_csv(csv_text, filename="orders.csv"):
    """Parse UTF-8 CSV text without discarding or changing source records.

    Keys beginning with '_' contain server-side draft state and must not be
    returned to a browser. source_row is the starting physical CSV line number.
    """
    if not isinstance(csv_text, str):
        raise ValueError("CSV 必须是 UTF-8 文本。" + TEMPLATE_HELP)
    if not isinstance(filename, str) or not filename or len(filename) > 255:
        raise ValueError("CSV 文件名必须为 1–255 个字符。")
    draft = {
        "id": "draft_" + uuid.uuid4().hex[:12], "filename": filename,
        "columns": [], "preview": [], "row_count": 0, "mapping": {},
        "issues": [], "_rows": [], "_source_hash": "", "_structural_blockers": [],
    }

    def block(code, message, rows=None):
        entry = _issue(code, "error", message + " " + TEMPLATE_HELP, rows)
        draft["issues"].append(entry)
        draft["_structural_blockers"].append(entry)

    try:
        raw = csv_text.encode("utf-8")
    except UnicodeEncodeError:
        block("invalid_encoding", "文本含有不合法的 Unicode 字符，请重新导出 UTF-8 CSV。")
        return draft
    draft["_source_hash"] = hashlib.sha256(raw).hexdigest()
    if len(raw) > MAX_BYTES:
        block("file_too_large", "CSV 超过 2 MB；请按期间拆分后导入。")
        return draft
    if "\x00" in csv_text:
        block("invalid_encoding", "发现空字符；不接受 Excel 二进制文件或 UTF-16 文本，请导出 UTF-8 CSV。")
        return draft
    if csv_text.startswith("\ufeff"):
        csv_text = csv_text[1:]
        draft["issues"].append(_issue("utf8_bom", "info", "已识别 UTF-8 BOM；仅移除文件开头的编码标记。"))
    reader = csv.reader(io.StringIO(csv_text, newline=""), strict=True)
    try:
        headers = next(reader, None)
        if headers is None:
            block("empty_csv", "CSV 为空，至少需要标题行和一笔订单。")
            return draft
        draft["columns"] = headers
        if not headers or any(not h.strip() for h in headers):
            block("blank_header", "标题行存在空字段名；请为每列设置唯一名称。", [1])
        keys = [_header_key(h) for h in headers]
        if len(set(keys)) != len(keys):
            block("duplicate_header", "标题名重复（忽略大小写、空格及下划线）；无法确定字段映射。", [1])
        if len(headers) > MAX_COLUMNS:
            block("too_many_columns", "列数超过 50 列；首版仅接受单张订单表。", [1])
            return draft
        if len(headers) == 1 and (";" in headers[0] or "\t" in headers[0]):
            block("unsupported_delimiter", "当前文件使用分号或制表符分隔；请导出以逗号分隔的 CSV。", [1])
        for field, aliases in ALIASES.items():
            candidates = [h for h in headers if _header_key(h) in aliases]
            if len(candidates) == 1:
                draft["mapping"][field] = candidates[0]
            elif len(candidates) > 1:
                draft["issues"].append(_issue("ambiguous_mapping", "warning", f"{field} 找到多个候选列，请手动选择：" + "、".join(candidates)))
        malformed = []
        blank_rows = []
        while True:
            row_start = reader.line_num + 1
            values = next(reader, None)
            if values is None:
                break
            draft["row_count"] += 1
            if draft["row_count"] > MAX_ROWS:
                block("too_many_rows", "订单行数超过 10,000；请按期间拆分后导入。")
                return draft
            if not values:
                blank_rows.append(row_start)
            elif len(values) != len(headers):
                malformed.append(row_start)
            draft["_rows"].append({"source_row": row_start, "values": values})
            if len(draft["preview"]) < 12:
                # Extra cells have their own key so the preview does not hide them.
                item = {h: values[i] if i < len(values) else None for i, h in enumerate(headers)}
                if len(values) > len(headers):
                    item["_extra_cells"] = values[len(headers):]
                item["_source_row"] = row_start
                draft["preview"].append(item)
        if malformed:
            block("non_rectangular_csv", "部分记录的列数与标题不一致；无法安全解释字段。请检查引号、分隔符或多行结构。", malformed)
        if blank_rows:
            draft["issues"].append(_issue("blank_rows", "warning", "发现空白记录；请选择排除异常行，或删除源文件中的空行后重新上传。", blank_rows, ["reject", "exclude"]))
        if not draft["row_count"]:
            block("no_orders", "CSV 只有标题行，没有订单。")
    except csv.Error as exc:
        block("malformed_csv", f"CSV 引号或记录格式不合法：{exc}。", [reader.line_num])
    return draft


def _parse_date(value, format_name):
    patterns = {
        "iso": (r"\d{4}-\d{2}-\d{2}", "%Y-%m-%d"),
        "ymd_slash": (r"\d{4}/\d{2}/\d{2}", "%Y/%m/%d"),
        "dmy": (r"\d{2}/\d{2}/\d{4}", "%d/%m/%Y"),
        "mdy": (r"\d{2}/\d{2}/\d{4}", "%m/%d/%Y"),
    }
    pattern, strptime_format = patterns[format_name]
    if not re.fullmatch(pattern, value):
        raise ValueError("日期须与已选格式完全一致，只支持日期，不支持时间戳。")
    try:
        return dt.datetime.strptime(value, strptime_format).date().isoformat()
    except ValueError as exc:
        raise ValueError("日期不存在或超出支持范围。") from exc


def _parse_amount(value, amount_unit, currency="CNY"):
    if not re.fullmatch(r"(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)", value):
        raise ValueError("金额须为非负普通数字；不接受负数、千分位、货币符号、科学计数或非有限数。")
    parts = value.split(".")
    if (amount_unit == "minor" or currency == "JPY") and len(parts) != 1:
        raise ValueError("JPY 不接受小数金额。" if currency == "JPY" else "已选最小金额单位，金额必须是整数。")
    if amount_unit == "major" and len(parts) == 2 and len(parts[1]) > 2:
        raise ValueError("主金额单位最多两位小数；请先明确舍入规则并在源表处理。")
    whole = parts[0].lstrip("0") or "0"
    if len(whole) > 16:
        raise OverflowError("金额超过可安全计算的整数范围。")
    cents = int(whole)
    if amount_unit == "major" and currency != "JPY":
        cents = cents * 100 + int((parts[1] if len(parts) == 2 else "").ljust(2, "0"))
    if cents > MAX_SAFE_CENTS:
        raise OverflowError("金额超过可安全计算的整数范围。")
    return cents


def _validate(draft, mapping, options):
    if not isinstance(draft, dict) or not isinstance(draft.get("_rows"), list):
        raise ValueError("导入草稿无效，请重新上传 CSV。")
    if not isinstance(mapping, dict) or not isinstance(options, dict):
        raise ValueError("字段映射和处理选项必须是对象。")
    mapping = {k: v for k, v in mapping.items() if v not in (None, "")}
    issues = list(draft.get("issues", []))
    # Preview notices are retained, but structural errors cannot be bypassed.
    structural = bool(draft.get("_structural_blockers"))
    config_bad = False
    for field in REQUIRED_FIELDS:
        if not mapping.get(field):
            issues.append(_issue("missing_mapping", "error", f"请映射必需字段 {field}。"))
            config_bad = True
    selected = []
    for field, column in mapping.items():
        if field not in FIELDS or not isinstance(column, str) or column not in draft.get("columns", []):
            issues.append(_issue("invalid_mapping", "error", f"字段映射无效：{field}。"))
            config_bad = True
        else:
            selected.append(column)
    if len(selected) != len(set(selected)):
        issues.append(_issue("reused_mapping", "error", "同一 CSV 列不能同时映射到多个指标字段。"))
        config_bad = True
    option_values = {
        "date_format": {"iso", "ymd_slash", "dmy", "mdy"},
        "amount_unit": {"major", "minor"}, "currency": CURRENCIES,
        "duplicate_policy": {"reject", "drop_exact"},
        "missing_refund": {"reject", "zero"}, "missing_channel": {"reject", "unknown"},
        "invalid_rows": {"reject", "exclude"},
    }
    effective = {"duplicate_policy": "reject", "missing_refund": "reject", "missing_channel": "reject", "invalid_rows": "reject", "assume_no_refunds": False, **options}
    for name, values in option_values.items():
        if not isinstance(effective.get(name), str) or effective.get(name) not in values:
            issues.append(_issue("confirmation_required" if name in {"date_format", "amount_unit", "currency"} else "invalid_option", "error", f"请明确选择有效的 {name}。", options=sorted(values)))
            config_bad = True
    if not isinstance(effective.get("assume_no_refunds"), bool):
        issues.append(_issue("invalid_option", "error", "assume_no_refunds 必须为布尔值。"))
        config_bad = True
    if mapping.get("refund_amount") and effective.get("assume_no_refunds"):
        issues.append(_issue("conflicting_refund_option", "error", "已映射退款金额列，请使用该列；不能同时把所有订单声明为无退款。"))
        config_bad = True
    stats = {"input_rows": draft.get("row_count", 0), "accepted_rows": 0, "excluded_rows": [], "duplicate_rows": [], "currency": effective.get("currency"), "currency_scale": 1 if effective.get("currency") == "JPY" else 100, "amount_unit": effective.get("amount_unit"), "date_start": None, "date_end": None}
    if config_bad or structural:
        return {"can_import": False, "issues": issues, "stats": stats, "preview": []}, [], effective
    columns = draft["columns"]
    indexes = {field: columns.index(column) for field, column in mapping.items()}
    seen_raw, seen_ids = {}, {}
    duplicate_rows, conflicting_ids = [], []
    candidate_rows = []
    currency_rows = {}
    missing_currency = []
    for raw_row in draft["_rows"]:
        number, values = raw_row["source_row"], raw_row["values"]
        if len(values) != len(columns):
            # Blank records can be explicitly excluded. Other widths were blocked.
            candidate_rows.append(raw_row)
            continue
        signature = tuple(values)
        if signature in seen_raw:
            duplicate_rows.append(number)
        else:
            seen_raw[signature] = number
        order_id = values[indexes["order_id"]]
        if order_id.strip():
            if order_id in seen_ids and seen_ids[order_id][1] != signature:
                conflicting_ids.extend([seen_ids[order_id][0], number])
            else:
                seen_ids.setdefault(order_id, (number, signature))
        if "currency" in indexes:
            code = values[indexes["currency"]].strip()
            if code:
                currency_rows.setdefault(code, []).append(number)
            else:
                missing_currency.append(number)
        if signature not in seen_raw or seen_raw[signature] == number:
            candidate_rows.append(raw_row)
    if conflicting_ids:
        issues.append(_issue("conflicting_order_ids", "error", "同一订单标识对应多行不同记录；首版不支持商品明细行、分次退款或订单事件流水。请先汇总为一订单一行。" + TEMPLATE_HELP, conflicting_ids))
        structural = True
    if currency_rows and (len(currency_rows) > 1 or set(currency_rows) != {effective["currency"]}):
        affected = [r for rows in currency_rows.values() for r in rows]
        issues.append(_issue("mixed_currency", "error", "币种列包含多币种、未支持币种，或与确认币种不一致（" + "、".join(sorted(currency_rows)) + "）；不自动换汇，也不能通过排除异常行绕过。请拆分币种或修正选择。", affected))
        structural = True
    if duplicate_rows:
        drop = effective["duplicate_policy"] == "drop_exact"
        issues.append(_issue("exact_duplicates", "warning" if drop else "error", f"发现 {len(duplicate_rows)} 行完全重复记录；" + ("按明确选择保留第一行，并记录移除行号。" if drop else "请选择仅移除完全重复行，或修正源文件。"), duplicate_rows, ["reject", "drop_exact"]))
        stats["duplicate_rows"] = duplicate_rows if drop else []
        if not drop:
            structural = True
    refunds_available = bool(mapping.get("refund_amount") or effective["assume_no_refunds"])
    if not refunds_available:
        issues.append(_issue("refunds_unavailable", "warning", "未映射退款金额，退款与净收入指标不可用；如源表确认所有订单无退款，可明确勾选“所有订单无退款”。"))
    elif effective["assume_no_refunds"]:
        issues.append(_issue("assumed_no_refunds", "info", "已明确确认所有订单无退款；将退款金额记为 0，并在报告保留该假设。"))
    if not mapping.get("channel"):
        issues.append(_issue("channel_unavailable", "info", "未映射渠道列，导入后不提供渠道比较。"))
    if not mapping.get("currency"):
        issues.append(_issue("declared_currency", "info", "源表无币种列；所有金额采用您明确选择的 " + effective["currency"] + "，不执行换汇。"))
    issues.append(_issue("amount_interpretation", "info", "金额按已确认单位解析为币种最小单位整数；CNY/USD/EUR/GBP 的 major 输入乘 100，JPY 的 major 输入直接保存且必须为整数，minor 输入直接保存。不执行四舍五入或汇率转换。"))
    row_problems = {}
    whitespace_rows, zero_refund_rows, unknown_channel_rows = [], [], []
    normalized = []
    unsafe = []

    def row_issue(code, message, number):
        key = (code, message)
        row_problems.setdefault(key, []).append(number)

    for raw_row in candidate_rows:
        number, values = raw_row["source_row"], raw_row["values"]
        if len(values) != len(columns):
            row_issue("blank_row", "空白记录没有订单字段。", number)
            continue

        def cell(field):
            return values[indexes[field]] if field in indexes else ""

        order_id, channel, status = cell("order_id"), cell("channel"), cell("status")
        invalid = False
        if not order_id.strip():
            row_issue("missing_order_id", "订单标识不能为空。", number)
            invalid = True
        parsed_values = {}
        for field in ("order_date", "gross_amount", "refund_amount", "refund_date", "currency"):
            raw_value = cell(field)
            parsed_values[field] = raw_value.strip()
            if raw_value != raw_value.strip():
                whitespace_rows.append(number)
        order_date = None
        try:
            order_date = _parse_date(parsed_values["order_date"], effective["date_format"])
        except ValueError as exc:
            row_issue("invalid_date", "订单" + str(exc), number)
            invalid = True
        gross, refund = None, None
        try:
            gross = _parse_amount(parsed_values["gross_amount"], effective["amount_unit"], effective["currency"])
        except OverflowError:
            unsafe.append(number)
            invalid = True
        except ValueError as exc:
            row_issue("invalid_amount", "订单" + str(exc), number)
            invalid = True
        if "refund_amount" in mapping:
            raw_refund = parsed_values["refund_amount"]
            if not raw_refund and effective["missing_refund"] == "zero":
                refund = 0
                zero_refund_rows.append(number)
            elif not raw_refund:
                row_issue("missing_refund", "退款金额缺失；请选择将缺失退款视为 0，或排除异常行。", number)
                invalid = True
            else:
                try:
                    refund = _parse_amount(raw_refund, effective["amount_unit"], effective["currency"])
                except OverflowError:
                    unsafe.append(number)
                    invalid = True
                except ValueError as exc:
                    row_issue("invalid_refund", "退款" + str(exc), number)
                    invalid = True
        elif effective["assume_no_refunds"]:
            refund = 0
        if gross is not None and refund is not None and refund > gross:
            row_issue("refund_exceeds_gross", "退款金额超过该订单毛收入；当前不支持跨订单退款或补偿款。", number)
            invalid = True
        refund_date = None
        if "refund_date" in mapping:
            if parsed_values["refund_date"]:
                try:
                    refund_date = _parse_date(parsed_values["refund_date"], effective["date_format"])
                except ValueError as exc:
                    row_issue("invalid_refund_date", "退款" + str(exc), number)
                    invalid = True
            elif refund is not None and refund > 0:
                row_issue("missing_refund_date", "存在退款金额但退款日期为空；不能按退款日期分析。请补齐日期或取消退款日期映射。", number)
                invalid = True
            if refund is not None and refund > 0 and refund_date and order_date and refund_date < order_date:
                row_issue("refund_before_order", "退款日期早于订单日期；请检查日期格式和源表。", number)
                invalid = True
        if "channel" in mapping and not channel.strip():
            if effective["missing_channel"] == "unknown":
                channel = "未标注"
                unknown_channel_rows.append(number)
            else:
                row_issue("missing_channel", "渠道为空；请选择标为“未标注”，或排除异常行。", number)
                invalid = True
        if number in missing_currency:
            row_issue("missing_currency", "已映射币种列但此行币种缺失；请补齐或排除异常行。", number)
            invalid = True
        if not invalid:
            normalized.append({"order_id": order_id, "order_date": order_date, "gross_cents": gross, "refund_cents": refund, "refund_date": refund_date, "channel": channel if "channel" in mapping else None, "status": status, "source_row": number})
    excluded = sorted({number for rows in row_problems.values() for number in rows})
    for (code, message), rows in row_problems.items():
        excluding = effective["invalid_rows"] == "exclude"
        issues.append(_issue(code, "warning" if excluding else "error", message + (" 按明确选择排除此行。" if excluding else " 请修正源表或明确选择排除异常行。"), rows, ["reject", "exclude"]))
    if whitespace_rows:
        issues.append(_issue("parsing_whitespace", "info", "解析日期、金额及币种时移除单元格首尾空白；订单标识、渠道和状态保留原文。", whitespace_rows))
    if zero_refund_rows:
        issues.append(_issue("missing_refund_zero", "warning", "按明确选择将缺失退款金额记为 0。", zero_refund_rows))
    if unknown_channel_rows:
        issues.append(_issue("missing_channel_unknown", "warning", "按明确选择将空渠道标为“未标注”。", unknown_channel_rows))
    if unsafe:
        issues.append(_issue("amount_out_of_range", "error", f"单笔金额超过 {MAX_SAFE_CENTS:,} 内部整数单位；不能通过排除异常行绕过。请拆分源文件或核对金额单位。", unsafe))
    if sum(row["gross_cents"] for row in normalized) > MAX_SAFE_CENTS or sum(row["refund_cents"] or 0 for row in normalized) > MAX_SAFE_CENTS:
        issues.append(_issue("amount_out_of_range", "error", f"金额汇总超过 {MAX_SAFE_CENTS:,} 内部整数单位；请缩小文件范围，避免金额精度损失。"))
    if not normalized:
        issues.append(_issue("no_valid_orders", "error", "处理后没有可导入订单。" + TEMPLATE_HELP))
    stats.update(accepted_rows=len(normalized), excluded_rows=excluded if effective["invalid_rows"] == "exclude" else [], date_start=min((r["order_date"] for r in normalized), default=None), date_end=max((r["order_date"] for r in normalized), default=None))
    result = {"can_import": not structural and not any(i["severity"] == "error" for i in issues), "issues": issues, "stats": stats, "preview": normalized[:12]}
    return result, normalized, effective


def check_import(draft, mapping, options):
    """Return issues and the impact of explicit choices without saving anything."""
    return _validate(draft, mapping, options)[0]


def commit_import(draft, mapping, options):
    """Create a normalized in-memory dataset, or fail without partial import."""
    validation, orders, effective = _validate(draft, mapping, options)
    if not validation["can_import"]:
        messages = [issue["message"] for issue in validation["issues"] if issue["severity"] == "error"]
        raise ValueError("导入未通过检查：" + "；".join(messages))
    mapping = {k: v for k, v in mapping.items() if v not in (None, "")}
    refunds = bool(mapping.get("refund_amount") or effective["assume_no_refunds"])
    return {
        "id": "dataset_" + uuid.uuid4().hex[:12], "name": draft["filename"],
        "orders": orders, "row_count": len(orders),
        "date_start": validation["stats"]["date_start"], "date_end": validation["stats"]["date_end"],
        "channels": sorted({r["channel"] for r in orders if r["channel"] is not None}),
        "currency": effective["currency"], "currency_scale": validation["stats"]["currency_scale"], "amount_unit": effective["amount_unit"],
        "mapping": dict(mapping), "source_hash": draft["_source_hash"],
        "decisions": {
            **effective, "excluded_rows": validation["stats"]["excluded_rows"],
            "duplicate_rows": validation["stats"]["duplicate_rows"],
            "parsing": "UTF-8 BOM only removed at file start; dates/amounts/currency strip surrounding whitespace; order IDs/channel/status preserved; integers represent the declared currency's minor units (JPY scale 1; other supported currencies scale 100); no rounding or exchange conversion.",
            "notices": validation["issues"],
        },
        "capabilities": {"refunds": refunds, "refund_dates": bool(mapping.get("refund_date") and refunds), "channel": bool(mapping.get("channel")), "status": bool(mapping.get("status"))},
    }

"""Versioned local policy store backed by an atomically replaced JSON file.

``data/knowledge.json`` is the synthetic seed, never a writable user database.
Versions are opaque identifiers. Import order decides the current version;
reusing an identifier/version pair is rejected rather than silently rewriting it.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import tempfile
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STORE_PATH = ROOT / "work" / "knowledge.json"
SEED_PATH = ROOT / "data" / "knowledge.json"
LOCK = threading.RLock()
REGIONS = {"all", "mainland", "overseas"}
DOCUMENT_FIELDS = {
    "id", "title", "category", "source", "region", "version", "updated",
    "active", "effective_from", "effective_to", "keywords", "statements",
}
RECORD_FIELDS = {"recorded_at", "retired_at", "retirement_reason", "superseded_by"}
TEXT_LIMITS = {"id":80, "title":200, "category":80, "source":1000, "version":80}


def _stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _today() -> str:
    # SupportFlow's local UI and evaluation documentation use China dates.
    return datetime.now(timezone(timedelta(hours=8))).date().isoformat()


def _date(value, field: str, errors: list[str], *, nullable=False):
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        errors.append(f"{field}：必须为 YYYY-MM-DD 日期" + ("或 null" if nullable else ""))
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        errors.append(f"{field}：日期不存在")
        return None


def _validate_document(payload, prefix: str) -> tuple[dict, list[str]]:
    errors = []
    if not isinstance(payload, dict):
        return {}, [f"{prefix}：必须为 JSON 对象"]
    for field in sorted(DOCUMENT_FIELDS - payload.keys()):
        errors.append(f"{prefix}.{field}：缺少必填字段")
    for field in sorted(payload.keys() - DOCUMENT_FIELDS):
        errors.append(f"{prefix}.{field}：不支持的字段")
    doc = copy.deepcopy(payload)
    for field, maximum in TEXT_LIMITS.items():
        if field not in payload:
            continue
        value = payload[field]
        if not isinstance(value, str) or not value.strip() or len(value) > maximum:
            errors.append(f"{prefix}.{field}：必须为 1–{maximum} 字的非空字符串")
        elif field in {"id", "version", "category"}:
            doc[field] = value.strip()
    if "id" in payload and isinstance(payload["id"], str):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", payload["id"]):
            errors.append(f"{prefix}.id：仅允许字母、数字、下划线、点和短横线，且须以字母或数字开头")
    if "region" in payload and (not isinstance(payload["region"], str) or payload["region"] not in REGIONS):
        errors.append(f"{prefix}.region：必须为 all、mainland 或 overseas")
    if "active" in payload and type(payload["active"]) is not bool:
        errors.append(f"{prefix}.active：必须显式填写 true 或 false")
    parsed_dates = {}
    for field in ("updated", "effective_from", "effective_to"):
        if field in payload:
            parsed_dates[field] = _date(payload[field], f"{prefix}.{field}", errors, nullable=field == "effective_to")
    if parsed_dates.get("effective_from") and parsed_dates.get("effective_to"):
        if parsed_dates["effective_to"] < parsed_dates["effective_from"]:
            errors.append(f"{prefix}.effective_to：不得早于 effective_from")
    for field, maximum, text_max in (("keywords",100,100), ("statements",200,4000)):
        if field not in payload:
            continue
        values = payload[field]
        if not isinstance(values, list) or not 1 <= len(values) <= maximum:
            errors.append(f"{prefix}.{field}：必须为含 1–{maximum} 项的字符串数组")
        elif any(not isinstance(item, str) or not item.strip() or len(item) > text_max for item in values):
            errors.append(f"{prefix}.{field}：每项必须为 1–{text_max} 字的非空字符串")
    return doc, errors


def _raise_validation(errors: list[str]):
    if errors:
        raise ValueError("资料校验失败：" + "；".join(errors))


def _load(path: Path) -> dict:
    filename = path if path.exists() else SEED_PATH
    try:
        state = json.loads(filename.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise ValueError("知识资料文件无法读取或 JSON 已损坏；请先修复文件，未覆盖现有资料。") from None
    if not isinstance(state, dict) or not isinstance(state.get("documents"), list):
        raise ValueError("知识资料文件缺少 documents 数组，未覆盖现有资料。")
    all_errors, seen, active_ids = [], set(), set()
    for index, document in enumerate(state["documents"]):
        if not isinstance(document, dict):
            all_errors.append(f"documents[{index}]：必须为 JSON 对象")
            continue
        raw = {key:value for key,value in document.items() if key not in RECORD_FIELDS}
        _, errors = _validate_document(raw, f"documents[{index}]")
        all_errors.extend(errors)
        if errors:
            continue
        identity = (document["id"], document["version"])
        if identity in seen:
            all_errors.append(f"documents[{index}].version：同一资料的版本编号重复")
        seen.add(identity)
        if document["active"]:
            if document["id"] in active_ids:
                all_errors.append(f"documents[{index}].active：同一资料不能有两个启用版本")
            active_ids.add(document["id"])
    _raise_validation(all_errors)
    state.setdefault("schema_version", 1)
    state.setdefault("revision", 1)
    state.setdefault("events", [])
    if type(state["revision"]) is not int or state["revision"] < 1 or not isinstance(state["events"], list):
        raise ValueError("知识资料 revision 或 events 格式错误，未覆盖现有资料。")
    return state


def _as_of(value) -> str:
    if value is None:
        return _today()
    if type(value) is date:
        return value.isoformat()
    errors = []
    _date(value, "as_of", errors)
    _raise_validation(errors)
    return value


def _view(document: dict, as_of: str) -> dict:
    result = copy.deepcopy(document)
    if not document["active"]:
        status = "inactive"
    elif document["effective_from"] > as_of or document["updated"] > as_of:
        status = "scheduled"
    elif document["effective_to"] is not None and document["effective_to"] < as_of:
        status = "expired"
    else:
        status = "active"
    result.update(eligible=status == "active", current_status=status)
    return result


def _snapshot(state: dict, as_of=None) -> dict:
    day = _as_of(as_of)
    latest = {}
    for document in state["documents"]:
        latest[document["id"]] = document
    result = {key:copy.deepcopy(value) for key,value in state.items() if key != "documents"}
    result.update(
        snapshot_date=day,
        documents=[_view(document, day) for document in latest.values()],
        history=[_view(document, day) for document in state["documents"]],
    )
    fingerprint = json.dumps({"revision":result["revision"], "snapshot_date":day, "documents":result["documents"]}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    result["snapshot_id"] = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
    return result


def _write(path: Path, state: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".knowledge-", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(state, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def get_knowledge(path=None, *, as_of=None) -> dict:
    """Get a fresh isolated snapshot; reading a missing store uses synthetic seed."""
    with LOCK:
        return _snapshot(_load(Path(path) if path is not None else STORE_PATH), as_of)


def get_history(ident: str, path=None) -> list[dict]:
    """Versions in import order, oldest first, including the current version."""
    versions = [document for document in get_knowledge(path)["history"] if document["id"] == ident]
    if not versions:
        raise LookupError("资料不存在。")
    return versions


def _import(payload, path: Path, *, existing_only=None) -> dict:
    if not isinstance(payload, dict) or set(payload) != {"documents"}:
        raise ValueError("导入内容必须是仅包含 documents 数组的 JSON 对象。")
    documents = payload["documents"]
    if not isinstance(documents, list) or not 1 <= len(documents) <= 100:
        raise ValueError("documents：每次须导入 1–100 份资料。")
    validated, errors, batch_ids = [], [], set()
    for index, document in enumerate(documents):
        clean, doc_errors = _validate_document(document, f"documents[{index}]")
        errors.extend(doc_errors)
        if doc_errors:
            continue
        if clean["id"] in batch_ids:
            errors.append(f"documents[{index}].id：同批次不能重复导入同一资料，请一次提供一个新版本")
        batch_ids.add(clean["id"])
        validated.append(clean)
    _raise_validation(errors)
    state = _load(path)
    latest = {document["id"]:document for document in state["documents"]}
    if existing_only is not None and existing_only not in latest:
        raise LookupError("资料不存在。")
    known_versions = {(document["id"], document["version"]) for document in state["documents"]}
    for index, document in enumerate(validated):
        if (document["id"], document["version"]) in known_versions:
            errors.append(f"documents[{index}].version：{document['id']} 的 {document['version']} 已存在；修改内容须填写未使用的新版本")
        previous = latest.get(document["id"])
        if previous is not None and document["updated"] < previous["updated"]:
            errors.append(f"documents[{index}].updated：新版本更新时间不得早于当前版本 {previous['updated']}")
    _raise_validation(errors)
    stamp, revision = _stamp(), state["revision"] + 1
    for document in validated:
        previous = latest.get(document["id"])
        if previous is not None:
            previous.update(active=False, retired_at=stamp, retirement_reason="superseded", superseded_by=document["version"])
        document["recorded_at"] = stamp
        state["documents"].append(document)
        state["events"].append({"event":"VERSION_IMPORTED", "document_id":document["id"], "version":document["version"], "previous_version":previous["version"] if previous else None, "revision":revision, "at":stamp})
    state["revision"] = revision
    _write(path, state)
    return _snapshot(state)


def import_documents(payload, path=None) -> dict:
    """Validate a whole batch before replacing the store; no partial imports."""
    with LOCK:
        return _import(payload, Path(path) if path is not None else STORE_PATH)


def update_document(ident: str, payload, path=None) -> dict:
    """Publish a full replacement version and retire the previous one atomically."""
    if not isinstance(payload, dict):
        raise ValueError("资料更新必须为完整的 JSON 对象。")
    if "id" in payload and payload["id"] != ident:
        raise ValueError("id：资料编号与更新目标不一致。")
    document = {**payload, "id":ident}
    with LOCK:
        return _import({"documents":[document]}, Path(path) if path is not None else STORE_PATH, existing_only=ident)


def deactivate_document(ident: str, path=None) -> dict:
    """Retire a current version, preserving its content and all earlier versions."""
    with LOCK:
        filename = Path(path) if path is not None else STORE_PATH
        state = _load(filename)
        matching = [document for document in state["documents"] if document["id"] == ident]
        if not matching:
            raise LookupError("资料不存在。")
        current = matching[-1]
        if not current["active"]:
            raise ValueError("该资料已停用；如需重新启用，请导入新版本。")
        stamp = _stamp()
        current.update(active=False, retired_at=stamp, retirement_reason="manual")
        state["revision"] += 1
        state["events"].append({"event":"DOCUMENT_DEACTIVATED", "document_id":ident, "version":current["version"], "revision":state["revision"], "at":stamp})
        _write(filename, state)
        return _snapshot(state)

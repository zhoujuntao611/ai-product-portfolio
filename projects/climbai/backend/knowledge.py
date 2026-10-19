import hashlib
import json
import math
import re
import atexit
import os
import subprocess
import sys
import threading
import unicodedata
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from pathlib import Path


RETRIEVAL_RULES = json.loads(Path(__file__).with_name("retrieval_rules.json").read_text(encoding="utf-8"))


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text).casefold()).strip()


def contains_term(text: str, term: str) -> bool:
    """Chinese phrases may be embedded; English words must not match substrings."""
    if re.fullmatch(r"[a-z0-9_ -]+", term):
        return re.search(r"(?<![a-z0-9_])" + re.escape(term) + r"(?![a-z0-9_])", text) is not None
    return term in text


GENERIC_TERMS = {normalize_text(x) for x in RETRIEVAL_RULES["generic_terms"]}
ALIAS_GROUPS = [set(map(normalize_text, group)) for group in RETRIEVAL_RULES["alias_groups"]]
TERM_GROUPS = {term: index for index, group in enumerate(ALIAS_GROUPS) for term in group}


def is_medical_query(query: str) -> bool:
    """Conservative knowledge-answer boundary, not medical classification.

    Keep the existing feedback/pause detector separate: an English substring
    such as 'pain' inside 'painting' must not fabricate a medical citation.
    """
    text = normalize_text(query)
    for phrase in RETRIEVAL_RULES["medical_negations"]:
        normalized = normalize_text(phrase)
        if re.fullmatch(r"[a-z ]+", normalized):
            text = re.sub(r"(?<![a-z0-9_])" + re.escape(normalized) + r"(?![a-z0-9_])", "", text)
        else:
            text = text.replace(normalized, "")
    text = re.sub(r"(^|[，。；、\s])不疼(?=$|[，。；、\s])", r"\1", text)
    return any(contains_term(text, normalize_text(term)) for term in RETRIEVAL_RULES["medical_terms"])


def lexical_scores(query: str, items: list[dict]) -> dict[str, float]:
    """Eligible lexical evidence only; character-hash proximity is a tie-break.

    A synonym group contributes its best match once. General words such as
    '计划' cannot by themselves turn unrelated questions into grounded answers.
    """
    text = normalize_text(query)
    if any(contains_term(text, normalize_text(term)) for term in RETRIEVAL_RULES["excluded_context_terms"]):
        return {}
    numeric_minutes = re.search(r"\d+\s*(?:分钟|minutes?\b|mins?\b)", text) is not None
    active_groups = {index for index, group in enumerate(ALIAS_GROUPS)
                     if any(term not in GENERIC_TERMS and contains_term(text, term) for term in group)}
    if numeric_minutes:
        active_groups.add(TERM_GROUPS["时间预算"])
    rows = []
    for item in items:
        concepts = {}
        generic = set()
        title = normalize_text(item["title"])
        for raw in item["keywords"]:
            term = normalize_text(raw)
            # Single Chinese characters ('脚', '伤') are too broad to be evidence.
            if len(term) < 2:
                continue
            direct = contains_term(text, term)
            group = TERM_GROUPS.get(term)
            alias = group is not None and group in active_groups
            if not direct and not alias:
                continue
            if term in GENERIC_TERMS:
                if direct:
                    generic.add(term)
                continue
            concept = ("alias", group) if group is not None else ("term", term)
            score = 3 + min(len(term), 12) / 12 if direct else 1.5
            if direct and contains_term(title, term):
                score += 2
            concepts[concept] = max(concepts.get(concept, 0), score)
        rows.append((item["id"], concepts, generic))
    contextual = any(contains_term(text, normalize_text(term)) for term in RETRIEVAL_RULES["context_terms"])
    contextual = contextual or numeric_minutes
    allow_generic = contextual or any(concepts for _, concepts, _ in rows)
    return {item_id: sum(concepts.values()) + (len(generic) * .5 if allow_generic else 0)
            for item_id, concepts, generic in rows if concepts or (allow_generic and generic)}


def hash_embedding(text: str, dimensions: int = 256) -> list[float]:
    """Deterministic character unigram/bigram features; NOT semantic embeddings."""
    clean = re.sub(r"\s+", "", text.lower())
    vector = [0.0] * dimensions
    for width in (1, 2):
        for i in range(max(0, len(clean) - width + 1)):
            token = clean[i:i + width]
            digest = hashlib.blake2b(token.encode(), digest_size=4).digest()
            vector[int.from_bytes(digest, "big") % dimensions] += 1
    norm = math.sqrt(sum(x * x for x in vector)) or 1
    return [x / norm for x in vector]


class KnowledgeBase:
    def __init__(self, chroma_path: str | None = None):
        content = json.loads(Path(__file__).with_name("knowledge.json").read_text(encoding="utf-8"))
        self.version = content["version"]
        self.review_status = content["review_status"]
        self.items = {x["id"]: x for x in content["knowledge"]}
        self.exercises = {x["id"]: x for x in content["exercises"]}
        self.collection = None
        self.worker = None
        self.worker_lock = threading.Lock()
        self.index_warning = None
        self.backend = "local_hash_demo"
        if chroma_path:
            try:
                # Native dependencies can terminate a Windows process without a
                # catchable exception. Keep them in a private worker so the
                # API remains usable and reports its genuine fallback backend.
                environment={k:v for k,v in os.environ.items() if k!="CLIMBAI_API_KEY"}
                self.worker=subprocess.Popen([sys.executable,"-m","backend.chroma_worker",chroma_path,str(Path(__file__).with_name("knowledge.json"))],cwd=str(Path(__file__).resolve().parent.parent),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding="utf-8",env=environment,creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0)
                atexit.register(self.close)
                ready=self.read_worker_line(timeout=20)
                if not ready.get("ready"):raise ValueError("index_unavailable")
                self.backend = "chroma_hash_demo"
            except (OSError, RuntimeError, ValueError,TimeoutError):
                self.index_warning="Chroma原生索引不可用；已明确降级为本地字符哈希Demo检索"
                self.close()

    def read_worker_line(self, timeout: int=10) -> dict:
        pool=ThreadPoolExecutor(max_workers=1)
        future=pool.submit(self.worker.stdout.readline)
        try:
            line=future.result(timeout=timeout)
            if not line:raise ValueError("index_worker_stopped")
            return json.loads(line)
        finally:
            pool.shutdown(wait=False,cancel_futures=True)

    def close(self):
        if self.worker:
            if self.worker.poll() is None:
                self.worker.terminate()
                try:self.worker.wait(timeout=3)
                except subprocess.TimeoutExpired:self.worker.kill()
            self.worker=None

    def meta(self) -> dict:
        return {"version":self.version,"review_status":self.review_status,"knowledge_count":len(self.items),"exercise_count":len(self.exercises),"retrieval":self.backend,"index_warning":self.index_warning,"embedding":"本地字符哈希 Demo；非模型语义向量"}

    def citation(self, item_id: str) -> dict:
        item = self.items[item_id]
        citation = {key: item[key] for key in ("id","title","url","summary","source_type")}
        for key in ("source_title","last_verified","support_note","applicability","review_status"):
            if key in item:
                citation[key] = item[key]
        return citation

    def search(self, query: str, limit: int = 3) -> list[dict]:
        if limit <= 0 or not query.strip():
            return []
        # Out-of-scope health questions retrieve only the existing product boundary,
        # never a technique whose overlapping words could imply treatment support.
        if is_medical_query(query):
            return [self.citation("K09")]
        scores = lexical_scores(query, list(self.items.values()))
        candidates = [self.items[item_id] for item_id in scores]
        if not candidates:
            return []
        vector = hash_embedding(query)
        ranks = {}
        if self.worker:
            with self.worker_lock:
                if self.worker:
                    try:
                        self.worker.stdin.write(json.dumps({"vector":vector})+"\n")
                        self.worker.stdin.flush()
                        result=self.read_worker_line()
                        if "error" in result:raise ValueError("query_failed")
                        ranks=result["ranks"]
                    except (OSError,ValueError,TimeoutError):
                        self.close();self.backend="local_hash_demo"
                        self.index_warning="Chroma查询失败；已明确降级为本地字符哈希Demo检索"
        def score(item):
            similarity = ranks.get(item["id"])
            if similarity is None:
                doc = item["title"] + item["summary"] + " ".join(item["keywords"])
                similarity = sum(a*b for a,b in zip(vector,hash_embedding(doc)))
            return scores[item["id"]], similarity
        candidates.sort(key=score,reverse=True)
        return [self.citation(x["id"]) for x in candidates[:limit]]

import hashlib
import json
import math
import re
import atexit
import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from pathlib import Path


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
        return {key: item[key] for key in ("id","title","url","summary","source_type")}

    def search(self, query: str, limit: int = 3) -> list[dict]:
        query_lower = query.lower()
        # Keyword eligibility prevents nearest-neighbor noise from masquerading as evidence.
        candidates = [x for x in self.items.values() if any(k.lower() in query_lower for k in x["keywords"])]
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
            overlap = sum(1 for k in item["keywords"] if k.lower() in query_lower)
            similarity = ranks.get(item["id"])
            if similarity is None:
                doc = item["title"] + item["summary"] + " ".join(item["keywords"])
                similarity = sum(a*b for a,b in zip(vector,hash_embedding(doc)))
            return overlap + similarity
        candidates.sort(key=score,reverse=True)
        return [self.citation(x["id"]) for x in candidates[:limit]]

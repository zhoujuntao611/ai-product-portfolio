"""Private JSON-line Chroma worker, isolated from native-library crashes.

No network/model downloads: caller supplies every embedding. stdout is reserved
for protocol; diagnostic exceptions are reduced to a fixed failure code.
"""
import hashlib
import json
import sys
from pathlib import Path


def main():
    import chromadb
    from chromadb.config import Settings
    from .knowledge import hash_embedding

    path,knowledge_path=sys.argv[1:3]
    with open(knowledge_path,encoding="utf-8") as handle:content=json.load(handle)
    items=content["knowledge"]
    fingerprint=hashlib.sha256(json.dumps(content,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:12]
    # Different native releases can use incompatible SQLite migrations. Keep
    # runtime versions in separate subdirectories rather than mutating an old index.
    runtime_path=str(Path(path)/("runtime-"+chromadb.__version__))
    client=chromadb.PersistentClient(path=runtime_path,settings=Settings(anonymized_telemetry=False))
    collection=client.get_or_create_collection("climbai_demo_"+fingerprint,embedding_function=None,metadata={"hnsw:space":"cosine","hnsw:num_threads":1})
    if collection.count()!=len(items):
        docs=[x["title"]+" "+x["summary"]+" "+" ".join(x["keywords"]) for x in items]
        collection.upsert(ids=[x["id"] for x in items],documents=docs,embeddings=[hash_embedding(x) for x in docs])
    # Test the actual native query before advertising index readiness.
    collection.query(query_embeddings=[hash_embedding("脚点")],n_results=1,include=["distances"])
    print(json.dumps({"ready":True,"count":collection.count(),"version":chromadb.__version__}),flush=True)
    for line in sys.stdin:
        try:
            request=json.loads(line)
            result=collection.query(query_embeddings=[request["vector"]],n_results=len(items),include=["distances"])
            print(json.dumps({"ranks":{item_id:1-distance for item_id,distance in zip(result["ids"][0],result["distances"][0])}}),flush=True)
        except Exception:
            print(json.dumps({"error":"query_failed"}),flush=True)


if __name__=="__main__":
    try:main()
    except Exception:
        print(json.dumps({"ready":False,"error":"index_unavailable"}),flush=True)
        raise SystemExit(1)

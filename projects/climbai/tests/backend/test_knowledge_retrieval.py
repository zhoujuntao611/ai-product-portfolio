"""Developer-authored lexical retrieval regressions; no LLM/user-effect claims."""
import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.knowledge import KnowledgeBase, is_medical_query, lexical_scores
from backend.evaluate_knowledge import evaluate_case, load_cases
from backend.main import create_app


@pytest.fixture
def kb():
    return KnowledgeBase()


@pytest.mark.parametrize("case", load_cases(), ids=lambda case: case["id"])
def test_fixed_developer_authored_retrieval_acceptance(kb, case):
    result = evaluate_case(kb, case)
    assert result["passed"], result


@pytest.mark.parametrize("query", [
    "明天上海天气如何", "NVIDIA股票怎么买", "Python脚本怎么编写", "这个脚注的格式如何设置",
    "投资时间和预算怎样安排", "数据库恢复计划怎么做", "为什么天空是蓝色的", "A painting workshop",
    "会议只有30分钟怎么安排", "如何设置网页FONT和FACE字体", "去火车站怎么排队", "这个背包怎么清洗",
])
def test_unrelated_words_do_not_become_evidence(kb, query):
    assert kb.search(query) == []


@pytest.mark.parametrize("query", ["FOOTWORK", "ｆｏｏｔｗｏｒｋ", "掉脚该怎么观察", "踩不稳要记录什么"])
def test_footwork_synonyms_and_case_normalization(kb, query):
    results = kb.search(query)
    assert results and "footwork" in kb.items[results[0]["id"]]["tags"]


def test_whole_english_words_and_single_chinese_characters_are_not_substrings():
    items = [
        {"id": "short", "title": "脚点", "keywords": ["脚", "伤", "pain", "footwork"]},
        {"id": "general", "title": "计划", "keywords": ["计划", "时间", "观察"]},
    ]
    for query in ("脚本", "伤感音乐", "painting", "footworkout", "我的人生计划"):
        assert lexical_scores(query, items) == {}


def test_exact_specific_topic_beats_broader_topic_and_synonym_repetition():
    items = [
        {"id": "broad", "title": "脚点选择", "keywords": ["脚点", "脚法", "落脚", "footwork"]},
        {"id": "specific", "title": "脚点记录", "keywords": ["脚点记录", "记录"]},
    ]
    scores = lexical_scores("如何保留脚点记录", items)
    assert scores["specific"] > scores["broad"]
    # Four equivalent keywords are one concept, not four separate votes.
    single = lexical_scores("掉脚", [dict(items[0], keywords=["脚点"])])
    repeated = lexical_scores("掉脚", [items[0]])
    assert repeated == single


def test_multiple_topics_retain_both_evidence_candidates():
    items = [
        {"id": "foot", "title": "脚点选择", "keywords": ["脚点"]},
        {"id": "journal", "title": "训练记录", "keywords": ["训练记录"]},
        {"id": "reading", "title": "读线", "keywords": ["读线", "观察"]},
    ]
    scores = lexical_scores("掉脚后怎么写训练记录", items)
    assert set(scores) == {"foot", "journal"}


@pytest.mark.parametrize("query", ["手指疼要用什么药", "康复期间如何做脚点训练", "I have an INJURY", "手指肿怎么治疗"])
def test_medical_query_retrieves_only_product_boundary(kb, query):
    assert is_medical_query(query)
    assert [x["id"] for x in kb.search(query)] == ["K09"]


@pytest.mark.parametrize("query", ["没有疼痛，想了解脚点", "无不适", "NO PAIN", "painting class", "painstaking notes"])
def test_medical_negations_and_english_word_boundaries(query):
    assert not is_medical_query(query)


def test_empty_and_nonpositive_limit_never_retrieve(kb):
    assert kb.search("  ") == []
    assert kb.search("脚点", limit=0) == []
    assert kb.search("脚点", limit=-1) == []


def test_all_citations_and_exercise_sources_resolve_to_current_library(kb):
    content = json.loads(Path(__file__).resolve().parents[2].joinpath("backend", "knowledge.json").read_text(encoding="utf-8"))
    assert len({item["id"] for item in content["knowledge"]}) == len(content["knowledge"])
    for item_id, item in kb.items.items():
        citation = kb.citation(item_id)
        assert citation["id"] == item_id and citation["summary"] == item["summary"]
        for field in ("source_title", "last_verified", "support_note", "applicability", "review_status"):
            if field in item:
                assert citation[field] == item[field]
    for exercise in kb.exercises.values():
        assert all(item_id in kb.items for item_id in exercise["citation_ids"])


def test_api_does_not_call_model_for_unknown_or_medical_queries(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIMBAI_PROVIDER", "demo")
    app = create_app(str(tmp_path / "retrieval.sqlite3"), chroma_path="")
    client = TestClient(app, headers={"X-Session-ID": str(uuid4())})
    app.state.coach.provider.name = "llm"

    def forbidden(*args):
        raise AssertionError("No model call is allowed for insufficient or medical evidence")

    monkeypatch.setattr(app.state.coach.provider, "structured", forbidden)
    for question in ("Python脚本怎么写", "A painting workshop"):
        response = client.post("/api/knowledge/ask", json={"question": question})
        assert response.status_code == 200
        assert response.json()["insufficient_evidence"] and response.json()["citations"] == []
    response = client.post("/api/knowledge/ask", json={"question": "手指受伤怎么康复"})
    assert response.status_code == 200
    assert response.json()["insufficient_evidence"]
    assert [x["id"] for x in response.json()["citations"]] == ["K09"]

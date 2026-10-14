import copy
import json
import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

os.environ["CLIMBAI_CHROMA_PATH"]=""
from backend.main import create_app
from backend.provider import ModelProvider, ProviderError, is_pain


@pytest.fixture
def setup(tmp_path,monkeypatch):
    monkeypatch.setenv("CLIMBAI_PROVIDER","demo")
    app=create_app(str(tmp_path/"test.sqlite3"),chroma_path="")
    client=TestClient(app)
    client.headers["X-Session-ID"]=str(uuid4())
    return client,app


def build_plan(client,**changes):
    profile={"nickname":"测试用户","goal":"观察脚点与规律训练","adult_confirmed":True,**changes}
    assert client.post("/api/profile",json=profile).status_code==200
    response=client.post("/api/plans/generate",json={})
    assert response.status_code==200,response.text
    state=response.json()
    assert client.post("/api/plans/confirm",json={"expected_version":state["current_plan"]["version"]}).status_code==200
    return client.get("/api/state").json()


def record_feedback(client,state,**changes):
    session_id=state["sessions"][0]["id"]
    assert client.post(f"/api/sessions/{session_id}/complete",json={"actual_minutes":30}).status_code==200
    response=client.post(f"/api/sessions/{session_id}/feedback",json={"difficulty":4,"completed":False,"main_issue":"只有30分钟，脚点滑","pain":False,**changes})
    assert response.status_code==200,response.text
    return response.json()


def test_transparent_health_and_bearer_isolation(setup):
    client,app=setup
    assert client.get("/api/health").json()["provider"]=="demo"
    assert client.get("/api/state",headers={"X-Session-ID":"invalid"}).status_code==400
    build_plan(client)
    other=client.get("/api/state",headers={"X-Session-ID":str(uuid4())}).json()
    assert other["profile"] is None and other["plans"]==[]


def test_adult_confirmation_required(setup):
    client,_=setup
    client.post("/api/profile",json={"goal":"建立训练习惯"})
    assert client.post("/api/plans/generate",json={}).status_code==409


@pytest.mark.parametrize("budget",[20,30,60,120])
def test_budget_equipment_citations_and_actual_nodes(setup,budget):
    client,app=setup
    state=build_plan(client,available_minutes=budget)
    plan=state["current_plan"]
    for session in plan["sessions"]:
        assert session["duration_minutes"]<=budget
        assert session["duration_minutes"]==sum(x["duration_minutes"] for x in session["exercises"])
        assert {"E01","E08","E09"}.issubset({x["id"] for x in session["exercises"]})
    assert all(c["id"] in app.state.kb.items for c in plan["citations"])
    assert plan["validation"]["valid"] is True
    run=state["runs"][-1]
    assert run["model_calls"]==0
    assert [x["node"] for x in run["nodes"]]==["profile_agent","knowledge_retriever","training_planner","rule_validator"]


def test_missing_equipment_never_recommends_climbing(setup):
    client,app=setup
    state=build_plan(client,equipment=[])
    assert all(not app.state.kb.exercises[x["id"]]["requires"] for s in state["sessions"] for x in s["exercises"])


def test_independent_completion_survives_without_feedback_and_duplicate_rejected(setup):
    client,_=setup
    state=build_plan(client)
    session_id=state["sessions"][0]["id"]
    assert client.post(f"/api/sessions/{session_id}/feedback",json={"difficulty":3,"pain":False}).status_code==409
    assert client.post(f"/api/sessions/{session_id}/complete",json={"actual_minutes":40}).status_code==200
    persisted=client.get("/api/state").json()
    assert len(persisted["logs"])==1 and not persisted["logs"][0]["feedback_submitted"]
    assert len(persisted["reports"])==0
    assert client.post(f"/api/sessions/{session_id}/complete",json={"actual_minutes":40}).status_code==409


def test_zero_minutes_is_independent_skip_and_preserved_in_adjustment_and_pause(setup):
    client,_=setup
    initial=build_plan(client)
    session_id=initial["sessions"][0]["id"]
    response=client.post(f"/api/sessions/{session_id}/complete",json={"actual_minutes":0})
    assert response.status_code==200
    state=response.json()
    assert state["logs"][0]["status"]=="skipped" and state["sessions"][0]["status"]=="skipped"
    assert state["logs"][0]["actual_minutes"]==0 and not state["logs"][0]["feedback_submitted"]
    assert state["reports"]==[]
    assert sum(e["type"]=="training_skipped" for e in state["events"])==1
    assert sum(e["type"]=="training_completed" for e in state["events"])==0
    state=client.post(f"/api/sessions/{session_id}/feedback",json={"difficulty":2,"completed":False,"main_issue":"时间不足，今天没到馆","pain":False}).json()
    report=state["reports"][-1]
    assert report["adjustment"]["proposed_plan"]["sessions"][0]["status"]=="skipped"
    state=client.post(f"/api/reports/{report['id']}/accept",json={"expected_version":state["current_plan"]["version"]}).json()
    assert state["sessions"][0]["status"]=="skipped"
    state=client.post("/api/profile",json={"adult_confirmed":True,"recent_pain":True,"goal":"观察脚点与训练习惯"}).json()
    assert state["paused"] and state["sessions"][0]["status"]=="skipped"
    assert state["sessions"][1]["status"]=="paused"


def test_feedback_adjustment_is_pending_and_accept_creates_version(setup):
    client,_=setup
    initial=build_plan(client)
    state=record_feedback(client,initial)
    assert state["current_plan"]["version"]==1
    assert state["sessions"][1]["duration_minutes"]==initial["sessions"][1]["duration_minutes"]
    report=state["reports"][-1]
    assert report["adjustment"]["status"]=="pending"
    assert report["adjustment"]["proposed_plan"]["sessions"][1]["duration_minutes"]<=30
    accepted=client.post(f"/api/reports/{report['id']}/accept",json={"expected_version":1})
    assert accepted.status_code==200
    accepted=accepted.json()
    assert accepted["current_plan"]["version"]==2
    assert accepted["current_plan"]["status"]=="confirmed"
    assert len(accepted["plans"])==2 and len(accepted["profile_versions"])==2
    assert accepted["reports"][-1]["adjustment"]["status"]=="accepted"
    assert accepted["profile"]["dimensions"][0]["evidence_ids"]==[report["id"]]
    assert client.post(f"/api/reports/{report['id']}/accept",json={"expected_version":2}).status_code==409


def test_keep_records_decision_without_rewriting_plan(setup):
    client,_=setup
    state=record_feedback(client,build_plan(client))
    report=state["reports"][-1]
    kept=client.post(f"/api/reports/{report['id']}/keep",json={"expected_version":1}).json()
    assert kept["current_plan"]["version"]==1
    assert kept["reports"][-1]["adjustment"]["status"]=="kept"


def test_accept_cannot_restore_a_session_completed_after_proposal(setup):
    client,_=setup
    state=record_feedback(client,build_plan(client))
    report=state["reports"][-1]
    second_id=state["sessions"][1]["id"]
    assert client.post(f"/api/sessions/{second_id}/complete",json={"actual_minutes":35}).status_code==200
    assert client.post(f"/api/reports/{report['id']}/accept",json={"expected_version":1}).status_code==409
    after=client.get("/api/state").json()
    assert after["sessions"][1]["status"]=="completed" and len(after["logs"])==2


def test_regeneration_makes_old_confirmation_and_adjustment_stale(setup):
    client,_=setup
    state=record_feedback(client,build_plan(client))
    report=state["reports"][-1]
    generated=client.post("/api/plans/generate",json={}).json()
    assert generated["current_plan"]["version"]==2
    assert client.post("/api/plans/confirm",json={"expected_version":1}).status_code==409
    assert client.post(f"/api/reports/{report['id']}/accept",json={"expected_version":2}).status_code==409


@pytest.mark.parametrize("pain,notes",[(True,""),(False,"不太疼但想继续"),(False,"手指痛")])
def test_pain_immediately_pauses_even_if_adjustment_kept(setup,pain,notes):
    client,_=setup
    state=record_feedback(client,build_plan(client),pain=pain,notes=notes)
    assert state["paused"] and state["current_plan"]["status"]=="paused"
    assert all(s["status"]!="planned" for s in state["sessions"])
    report=state["reports"][-1]
    response=client.post(f"/api/reports/{report['id']}/keep",json={"expected_version":state["current_plan"]["version"]})
    assert response.status_code==200 and response.json()["paused"]
    assert client.post(f"/api/sessions/{state['sessions'][1]['id']}/complete",json={"actual_minutes":20}).status_code==409
    generated=client.post("/api/plans/generate",json={}).json()
    assert generated["current_plan"]["status"]=="paused"


@pytest.mark.parametrize("text,expected",[("没有疼痛",False),("无不适",False),("不太疼但继续",True),("不得不疼",True),("没有疼痛，但手指肿",True)])
def test_conservative_pain_negation(text,expected):
    assert is_pain(text)==expected


def test_grounded_answer_unknown_and_medical_bounds(setup):
    client,app=setup
    known=client.post("/api/knowledge/ask",json={"question":"脚点容易滑，应该观察什么？"}).json()
    assert known["citations"] and not known["insufficient_evidence"]
    assert known["provider"]=="demo"
    assert all(c["id"] in app.state.kb.items for c in known["citations"])
    unknown=client.post("/api/knowledge/ask",json={"question":"明天上海天气如何"}).json()
    assert unknown["insufficient_evidence"] and unknown["citations"]==[]
    finance=client.post("/api/knowledge/ask",json={"question":"NVIDIA股票怎么买"}).json()
    assert finance["insufficient_evidence"] and finance["citations"]==[]
    medical=client.post("/api/knowledge/ask",json={"question":"手指疼要用什么药"}).json()
    assert medical["insufficient_evidence"] and medical["citations"][0]["id"]=="K09"


def test_profile_correction_is_versioned_and_missing_measurement_unknown(setup):
    client,_=setup
    state=build_plan(client)
    response=client.post("/api/profile/correct",json={"dimension_key":"footwork","correction":"简单线路脚点稳定，困难线路需要继续观察"})
    assert response.status_code==200
    state=response.json()
    assert state["profile"]["version"]==2 and len(state["profile_versions"])==2
    assert state["profile"]["dimensions"][0]["evidence_level"]=="用户纠正"
    assert state["profile"]["dimensions"][-1]["evidence_level"]=="未知"


def test_sqlite_restart_export_and_owner_only_deletion(setup,tmp_path):
    client,app=setup
    build_plan(client)
    owner=client.headers["X-Session-ID"]
    restarted=TestClient(create_app(app.state.store.path,chroma_path=""))
    assert restarted.get("/api/state",headers={"X-Session-ID":owner}).json()["profile"]["nickname"]=="测试用户"
    other=str(uuid4())
    restarted.post("/api/profile",headers={"X-Session-ID":other},json={"nickname":"另一个用户"})
    exported=client.get("/api/export").json()
    assert exported["data"]["plans"] and not exported["sample_data"]
    assert "API_KEY" not in json.dumps(exported)
    assert client.delete("/api/data").json()["profile"] is None
    assert restarted.get("/api/state",headers={"X-Session-ID":other}).json()["profile"]["nickname"]=="另一个用户"


def test_llm_failure_does_not_silently_fallback_or_overwrite_plan(setup,monkeypatch):
    client,app=setup
    initial=build_plan(client)
    app.state.coach.provider.name="llm"
    def broken(*args,**kwargs):raise ProviderError("模型调用失败")
    monkeypatch.setattr(app.state.coach.provider,"structured",broken)
    response=client.post("/api/plans/generate",json={})
    assert response.status_code==502
    state=client.get("/api/state").json()
    assert state["current_plan"]==initial["current_plan"]
    assert state["runs"][-1]["status"]=="failed"


def test_llm_invalid_library_ids_only_one_repair(setup,monkeypatch):
    client,app=setup
    initial=build_plan(client)
    app.state.coach.provider.name="llm"
    attempts=[]
    def invalid(*args):
        attempts.append(1)
        return {"summary":"训练示例","rationale":"按预算","sessions":[{"title":"训练","exercise_ids":["INVENTED"],"minutes":[15]}]}
    monkeypatch.setattr(app.state.coach.provider,"structured",invalid)
    assert client.post("/api/plans/generate",json={}).status_code==502
    assert len(attempts)==2
    assert client.get("/api/state").json()["current_plan"]==initial["current_plan"]


def test_llm_knowledge_rejects_invented_citation_and_records_failed_run(setup,monkeypatch):
    client,app=setup
    app.state.coach.provider.name="llm"
    monkeypatch.setattr(app.state.coach.provider,"structured",lambda *args:{"answer":"训练建议","citation_ids":["FORGED"],"insufficient_evidence":False})
    assert client.post("/api/knowledge/ask",json={"question":"脚点滑应该观察什么"}).status_code==502
    state=client.get("/api/state").json()
    assert state["answers"]==[] and state["runs"][-1]["status"]=="failed"


def test_generate_constraint_change_versions_profile_and_plan(setup):
    client,_=setup
    build_plan(client)
    response=client.post("/api/plans/generate",json={"goal":"观察读线与脚点", "available_minutes":30})
    assert response.status_code==200
    state=response.json()
    assert state["profile"]["version"]==2
    assert state["profile_versions"][-1]["available_minutes"]==30
    assert state["current_plan"]["version"]==2 and state["current_plan"]["profile_version"]==2


def test_explicit_llm_configuration_incomplete_is_visible(monkeypatch):
    monkeypatch.setenv("CLIMBAI_PROVIDER","llm")
    monkeypatch.delenv("CLIMBAI_API_KEY",raising=False)
    monkeypatch.delenv("CLIMBAI_MODEL",raising=False)
    provider=ModelProvider()
    assert provider.name=="demo" and provider.configuration_warning


@pytest.mark.parametrize("scenario",["footwork","time_short","pain"])
def test_demo_reset_stays_labeled_and_does_not_call_paid_api(setup,monkeypatch,scenario):
    client,app=setup
    app.state.coach.provider.name="llm"
    def forbidden(*args):raise AssertionError("reset must not call paid provider")
    monkeypatch.setattr(app.state.coach.provider,"structured",forbidden)
    state=client.post("/api/demo/reset",json={"scenario":scenario}).json()
    assert state["profile"]["sample"] and state["current_plan"]["sample"]
    assert state["runs"][-1]["model_calls"]==0


def test_optional_llm_feedback_extracts_hypothesis_but_rules_bound_changes(setup,monkeypatch):
    client,app=setup
    initial=build_plan(client)
    app.state.coach.provider.name="llm"
    def semantic(*args):
        return {"category":"technical","hypothesis":"困难线路的脚点选择可能需要进一步观察","reason":"用户描述容易线路稳定，困难线路会滑","suggested_action":"simplify"}
    monkeypatch.setattr(app.state.coach.provider,"structured",semantic)
    state=record_feedback(client,initial,notes="容易线路没有这个问题")
    assert state["reports"][-1]["provider"]=="llm"
    assert state["runs"][-1]["model_calls"]==1
    assert "困难线路" in state["profile"]["dimensions"][0]["hypothesis"]
    assert state["reports"][-1]["adjustment"]["proposed_plan"]["sessions"][1]["duration_minutes"]<=30
    assert state["current_plan"]["version"]==1


def test_optional_llm_feedback_failure_preserves_independent_completion(setup,monkeypatch):
    client,app=setup
    initial=build_plan(client)
    session_id=initial["sessions"][0]["id"]
    client.post(f"/api/sessions/{session_id}/complete",json={"actual_minutes":30})
    app.state.coach.provider.name="llm"
    def broken(*args):raise ProviderError("模型不可用")
    monkeypatch.setattr(app.state.coach.provider,"structured",broken)
    response=client.post(f"/api/sessions/{session_id}/feedback",json={"difficulty":4,"main_issue":"脚点滑","pain":False})
    assert response.status_code==502
    state=client.get("/api/state").json()
    assert len(state["logs"])==1 and not state["logs"][0]["feedback_submitted"]
    assert state["reports"]==[] and state["profile"]["version"]==1
    assert state["runs"][-1]["status"]=="failed" and state["runs"][-1]["model_calls"]==1


def test_pain_branch_skips_configured_llm(setup,monkeypatch):
    client,app=setup
    initial=build_plan(client)
    app.state.coach.provider.name="llm"
    def forbidden(*args):raise AssertionError("pain gate must skip model")
    monkeypatch.setattr(app.state.coach.provider,"structured",forbidden)
    state=record_feedback(client,initial,pain=True)
    assert state["paused"] and state["runs"][-1]["model_calls"]==0
    assert state["reports"][-1]["provider"]=="demo"

import copy
import os
import time
from pathlib import Path
from uuid import UUID, uuid4

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .coach import Coach, FOCUS
from .knowledge import KnowledgeBase, is_medical_query
from .models import CompleteInput, FeedbackInput, GenerateInput, ProfileInput, QuestionInput, ResetInput, VersionInput
from .provider import ModelProvider, ProviderError, is_pain
from .store import Store, empty_state, now


ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def resolve_path(value: str) -> str:
    path = Path(value)
    return str(path if path.is_absolute() else ROOT / path)


def identity(x_session_id: str = Header(...,description="Anonymous bearer token. Keep private; possession grants access to that demo workspace.")) -> str:
    try:
        return str(UUID(x_session_id))
    except ValueError:
        raise HTTPException(400,"X-Session-ID 必须是匿名 UUID") from None


class CorrectionInput(BaseModel):
    dimension_key: str = Field(max_length=40)
    correction: str = Field(min_length=2,max_length=500)


def create_app(db_path: str | None = None, chroma_path: str | None = None) -> FastAPI:
    app = FastAPI(title="ClimbAI Coach API",version="1.0.0",description="Portfolio MVP: transparent rule demo, optional LLM adapter, versioned human-confirmed plans.")
    store=Store(db_path or resolve_path(os.getenv("CLIMBAI_DB_PATH","backend/data/climbai.sqlite3")))
    index_path=chroma_path if chroma_path is not None else os.getenv("CLIMBAI_CHROMA_PATH","backend/data/chroma")
    kb=KnowledgeBase(resolve_path(index_path) if index_path else None)
    provider=ModelProvider()
    coach=Coach(kb,provider)
    app.state.store=store;app.state.coach=coach;app.state.kb=kb
    defaults="http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,http://localhost:8000,http://127.0.0.1:8000,https://zhoujuntao611.github.io"
    origins=[x.strip() for x in os.getenv("CLIMBAI_CORS_ORIGINS",defaults).split(",") if x.strip() and x.strip()!="*"]
    app.add_middleware(CORSMiddleware,allow_origins=origins,allow_credentials=False,allow_methods=["GET","POST","PUT","DELETE","OPTIONS"],allow_headers=["Content-Type","X-Session-ID"])

    def view(state: dict) -> dict:
        Store.sync_current(state)
        state["engine"]=provider.name
        state["knowledge_meta"]=kb.meta()
        state["configuration_warning"]=provider.configuration_warning
        return copy.deepcopy(state)

    def event(state: dict, kind: str, **data):
        state["events"].append({"id":str(uuid4()),"type":kind,"created_at":now(),**data})

    def current(state: dict) -> dict:
        Store.sync_current(state)
        if not state["current_plan"]:raise HTTPException(404,"尚未制定训练计划")
        return state["current_plan"]

    def check_version(state: dict, expected: int) -> dict:
        plan=current(state)
        if plan["version"]!=expected:raise HTTPException(409,{"message":"计划版本已变化，请刷新后重新确认","current_version":plan["version"]})
        return plan

    def require_profile(state: dict):
        if not state["profile"]:raise HTTPException(409,"请先建立个人档案")

    def save_plan(state: dict, plan: dict):
        found=[i for i,p in enumerate(state["plans"]) if p["id"]==plan["id"] and p["version"]==plan["version"]]
        if found:state["plans"][found[0]]=copy.deepcopy(plan)
        else:state["plans"].append(copy.deepcopy(plan))
        state["current_plan_id"]=plan["id"]
        Store.sync_current(state)

    def save_profile_version(state: dict):
        state["profile_versions"].append(copy.deepcopy(state["profile"]))

    @app.get("/api/health")
    def health():
        return {"status":"ok","version":"1.0.0","mode":provider.name,"provider":provider.name,"configuration_warning":provider.configuration_warning,"orchestrator":coach.orchestrator,"retrieval_backend":kb.backend,"index_status":"ready" if kb.backend=="chroma_hash_demo" else "fallback_ready","knowledge":kb.meta(),"privacy":"Anonymous bearer ID for isolated demo use; not a production login system"}

    @app.get("/api/state")
    def get_state(user: str=Depends(identity)):
        return view(store.read(user))

    @app.get("/api/profile")
    def get_profile(user: str=Depends(identity)):
        return store.read(user)["profile"]

    @app.put("/api/profile")
    @app.post("/api/profile")
    def put_profile(body: ProfileInput,user: str=Depends(identity)):
        with store.mutate(user) as state:
            version=state["profile"]["version"]+1 if state["profile"] else 1
            corrections=state["profile"].get("corrections",{}) if state["profile"] else {}
            state["profile"]={**body.model_dump(),"id":"profile","version":version,"created_at":now(),"corrections":corrections}
            state["paused"]=state["paused"] or body.recent_pain or is_pain(body.goal+body.correction)
            state["goal"]={"text":body.goal,"focus":body.focus,"sessions_per_week":body.sessions_per_week}
            flow={"user":state,"kind":"plan","trace":[],"feedback":{}}
            coach.profile_node(flow)
            save_profile_version(state)
            if state["paused"] and state["current_plan_id"]:
                plan=current(state);plan["status"]="paused"
                for session in plan["sessions"]:
                    if session["status"] not in ("completed","skipped"):session["status"]="paused"
                save_plan(state,plan)
            event(state,"profile_saved",profile_version=version)
        return view(state)

    @app.post("/api/profile/correct")
    def correct_profile(body: CorrectionInput,user: str=Depends(identity)):
        if body.dimension_key not in set(FOCUS)|{"strength"}:raise HTTPException(422,"未知画像维度")
        with store.mutate(user) as state:
            require_profile(state)
            state["profile"]["corrections"][body.dimension_key]=body.correction
            state["profile"]["version"]+=1
            coach.profile_node({"user":state,"kind":"plan","trace":[]})
            save_profile_version(state)
            event(state,"profile_corrected",profile_version=state["profile"]["version"])
        return view(state)

    @app.post("/api/plans/generate")
    def generate_plan(body: GenerateInput=GenerateInput(),user: str=Depends(identity)):
        failure=None
        with store.mutate(user) as state:
            require_profile(state)
            if not state["profile"].get("adult_confirmed"):raise HTTPException(409,"首版面向18岁及以上用户，请先完成成年确认")
            previous_profile=copy.deepcopy(state["profile"])
            previous_goal=copy.deepcopy(state["goal"])
            if body.goal is not None:state["profile"]["goal"]=body.goal;state["goal"]["text"]=body.goal
            if body.available_minutes is not None:state["profile"]["available_minutes"]=body.available_minutes
            if body.goal is not None or body.available_minutes is not None:
                state["profile"]["version"]+=1
            state["paused"]=state["paused"] or is_pain(state["profile"]["goal"])
            try:
                result=coach.run(state,"plan")
            except ProviderError as exc:
                failure=str(exc)
                state["profile"]=previous_profile;state["goal"]=previous_goal
            if failure is None:
                result["plan"]["version"]=max((p["version"] for p in state["plans"]),default=0)+1
                state["runs"][-1]["plan_version"]=result["plan"]["version"]
                save_plan(state,result["plan"])
                if body.goal is not None or body.available_minutes is not None:save_profile_version(state)
                event(state,"plan_generated",plan_version=result["plan"]["version"])
        if failure:raise HTTPException(502,failure)
        return view(state)

    def confirm(body: VersionInput,user: str,plan_id: str | None=None):
        with store.mutate(user) as state:
            plan=check_version(state,body.expected_version)
            if plan_id and plan["id"]!=plan_id:raise HTTPException(404,"当前用户无此计划")
            if state["paused"] or plan["status"]=="paused":raise HTTPException(409,"不适分支已暂停训练建议")
            if plan["status"]!="draft":raise HTTPException(409,"此计划已确认")
            if plan["profile_version"]!=state["profile"]["version"]:raise HTTPException(409,"档案已更新，请重新生成计划")
            if coach.validate(plan,state["profile"]):raise HTTPException(409,"当前档案与计划约束不匹配，请重新生成")
            plan["status"]="confirmed";plan["confirmed_at"]=now()
            save_plan(state,plan);event(state,"plan_confirmed",plan_version=plan["version"])
        return view(state)

    @app.post("/api/plans/confirm")
    def confirm_current(body: VersionInput,user: str=Depends(identity)):return confirm(body,user)

    @app.post("/api/plans/{plan_id}/confirm")
    def confirm_id(plan_id: str,body: VersionInput,user: str=Depends(identity)):return confirm(body,user,plan_id)

    @app.get("/api/plans/current")
    def get_current(user: str=Depends(identity)):return current(store.read(user))

    @app.post("/api/sessions/{session_id}/complete")
    def complete(session_id: str,body: CompleteInput,user: str=Depends(identity)):
        with store.mutate(user) as state:
            plan=current(state)
            if plan["status"]!="confirmed" or state["paused"]:raise HTTPException(409,"当前没有可执行的已确认计划")
            session=next((s for s in plan["sessions"] if s["id"]==session_id),None)
            if not session:raise HTTPException(404,"当前用户无此训练任务")
            if any(l["session_id"]==session_id for l in state["logs"]):raise HTTPException(409,"此训练已经记录完成，避免重复计数")
            outcome="skipped" if body.actual_minutes==0 else "completed"
            log={"id":str(uuid4()),"session_id":session_id,"plan_id":plan["id"],"plan_version":plan["version"],"planned_minutes":session["duration_minutes"],"actual_minutes":body.actual_minutes,"completed_at":now(),"created_at":now(),"status":outcome,"feedback_submitted":False,"sample":False}
            state["logs"].append(log);session["status"]=outcome
            save_plan(state,plan);event(state,"training_skipped" if outcome=="skipped" else "training_completed",session_id=session_id,plan_version=plan["version"])
        return view(state)

    def feedback(session_id: str,body: FeedbackInput,user: str=Depends(identity),coach_override: Coach | None=None):
        with store.mutate(user) as state:
            require_profile(state)
            plan=current(state)
            log=next((l for l in state["logs"] if l["session_id"]==session_id),None)
            if not log:raise HTTPException(409,"请先独立记录结束训练，再提交反馈")
            if log["feedback_submitted"]:raise HTTPException(409,"此训练已经提交反馈")
            if not any(s["id"]==session_id for s in plan["sessions"]):raise HTTPException(409,"此记录属于历史计划，当前计划不受该反馈自动调整")
            report_id=str(uuid4())
            data={**body.model_dump(),"id":report_id,"session_id":session_id,"actual_minutes":body.actual_minutes if body.actual_minutes is not None else log["actual_minutes"]}
            data["pain"]=data["pain"] or is_pain(data["main_issue"]+data["notes"])
            if data["pain"]:state["paused"]=True
            state["profile"]["version"]+=1
            result=(coach_override or coach).run(state,"feedback",data)
            proposed=result["plan"]
            base=plan["version"]
            if data["pain"]:
                # The safety pause is immediate and does not wait for user acceptance.
                immediate=copy.deepcopy(proposed);immediate["status"]="paused"
                save_plan(state,immediate);base=immediate["version"]
            save_profile_version(state)
            parts=result["report_parts"]
            next_before=next((s for s in plan["sessions"] if s["status"]=="planned"),None)
            next_after=next((s for s in proposed["sessions"] if s["status"] in ("planned","paused")),None)
            before=f"下一次 {next_before['duration_minutes']} 分钟 · {next_before['title']}" if next_before else "本周暂无未完成任务"
            after="所有攀爬建议已立即暂停" if data["pain"] else (f"下一次 {next_after['duration_minutes']} 分钟 · {next_after['title']}" if next_after else "本周任务已完成，下一周重新制定计划")
            report={"id":report_id,"session_id":session_id,"log_id":log["id"],"created_at":now(),"focus":state["profile"]["focus"],"main_issue":body.main_issue,"notes":body.notes,"observations":parts["observations"],"hypotheses":parts["hypotheses"],"summary":parts["reason"],"provider":result["provider"],"before":before,"after":after,"citations":result["evidence"],"pain":data["pain"],"run_id":result["run_id"],"adjustment":{"id":str(uuid4()),"status":"pending","reason":parts["reason"],"changes":[f"{before} → {after}"],"action":parts["action"],"base_plan_id":plan["id"],"base_plan_version":base,"profile_version":state["profile"]["version"],"proposed_plan":proposed}}
            state["reports"].append(report)
            log["feedback_submitted"]=True;log["actual_minutes"]=data["actual_minutes"]
            event(state,"feedback_submitted",session_id=session_id,plan_version=log["plan_version"])
        return view(state)

    @app.post("/api/sessions/{session_id}/feedback")
    def feedback_endpoint(session_id: str,body: FeedbackInput,user: str=Depends(identity)):
        try:
            return feedback(session_id,body,user)
        except ProviderError as exc:
            # Roll back proposed profile/report edits, then persist only the
            # sanitized failure run in a separate transaction.
            with store.mutate(user) as state:
                if getattr(exc,"run",None):state["runs"].append(exc.run)
            raise HTTPException(502,str(exc)) from None

    def decide(item_id: str, body: VersionInput,user: str,decision: str,by_report: bool=False):
        with store.mutate(user) as state:
            report=next((r for r in state["reports"] if (r["id"] if by_report else r["adjustment"]["id"])==item_id),None)
            if not report:raise HTTPException(404,"当前用户无此调整建议")
            adjustment=report["adjustment"]
            plan=check_version(state,body.expected_version)
            if adjustment["status"]!="pending":raise HTTPException(409,"调整已处理")
            if adjustment["base_plan_version"]!=plan["version"] or adjustment["base_plan_id"]!=plan["id"]:raise HTTPException(409,"建议基于旧计划，请重新查看最新计划")
            if decision=="accept":
                if adjustment["profile_version"]!=state["profile"]["version"]:raise HTTPException(409,"画像已经更新，此建议需要重新评估")
                proposed=copy.deepcopy(adjustment["proposed_plan"])
                live_status={s["id"]:s["status"] for s in plan["sessions"]}
                if any(live_status.get(s["id"]) in ("completed","skipped") and s["status"]!=live_status[s["id"]] for s in proposed["sessions"]):
                    raise HTTPException(409,"建议形成后训练状态已变化，请保留当前安排或重新制定计划")
                proposed["version"]=plan["version"]+1
                proposed["status"]="paused" if state["paused"] else "confirmed"
                if state["paused"]:
                    for session in proposed["sessions"]:
                        if session["status"] not in ("completed","skipped"):session["status"]="paused"
                if coach.validate(proposed,state["profile"]):raise HTTPException(409,"调整不符合当前规则")
                save_plan(state,proposed)
            adjustment["status"]="accepted" if decision=="accept" else "kept"
            adjustment["decided_at"]=now()
            event(state,"adjustment_accepted" if decision=="accept" else "adjustment_kept",plan_version=state["current_plan"]["version"])
        return view(state)

    @app.post("/api/reports/{report_id}/accept")
    def accept_report(report_id: str,body: VersionInput,user: str=Depends(identity)):return decide(report_id,body,user,"accept",True)

    @app.post("/api/reports/{report_id}/keep")
    def keep_report(report_id: str,body: VersionInput,user: str=Depends(identity)):return decide(report_id,body,user,"keep",True)

    @app.post("/api/adjustments/{adjustment_id}/accept")
    def accept_adjustment(adjustment_id: str,body: VersionInput,user: str=Depends(identity)):return decide(adjustment_id,body,user,"accept")

    @app.post("/api/adjustments/{adjustment_id}/keep")
    def keep_adjustment(adjustment_id: str,body: VersionInput,user: str=Depends(identity)):return decide(adjustment_id,body,user,"keep")

    @app.post("/api/knowledge/ask")
    def ask(body: QuestionInput,user: str=Depends(identity)):
        started=time.monotonic()
        citations=kb.search(body.question)
        insufficient=not citations
        if is_medical_query(body.question):
            answer="当前助手无法进行伤病诊断、用药或康复指导。若训练中出现疼痛或不适，请停止相关训练并寻求适当的专业意见。"
            citations=[kb.citation("K09")];insufficient=True;used_provider="demo"
        elif insufficient:
            answer="当前 Demo 知识库没有足够资料支持这个问题。请补充与室内抱石技术、训练记录或计划安排相关的具体问题；我不会编造依据。"
            used_provider="demo"
        elif provider.name=="llm":
            schema={"type":"object","additionalProperties":False,"required":["answer","citation_ids","insufficient_evidence"],"properties":{"answer":{"type":"string"},"citation_ids":{"type":"array","items":{"type":"string"}},"insufficient_evidence":{"type":"boolean"}}}
            try:
                result=provider.structured("回答必须严格以证据为限。资料不足就说明不足，不发明来源。",{"question":body.question,"evidence":citations},schema,"knowledge_answer")
                if not isinstance(result.get("answer"),str) or not isinstance(result.get("citation_ids"),list) or not all(isinstance(x,str) for x in result["citation_ids"]) or not isinstance(result.get("insufficient_evidence"),bool):
                    raise ProviderError("回答结构无效")
                if not set(result["citation_ids"]).issubset({x["id"] for x in citations}):raise ProviderError("模型引用超出检索证据；未保存回答")
                if not result["citation_ids"] and not result["insufficient_evidence"]:raise ProviderError("模型回答缺少依据；未保存回答")
                if is_pain(result["answer"]):raise ProviderError("回答未通过产品边界检查；未保存回答")
                answer=result["answer"];insufficient=result["insufficient_evidence"]
                citations=[x for x in citations if x["id"] in result["citation_ids"]];used_provider="llm"
            except (ProviderError,KeyError,TypeError):
                with store.mutate(user) as failed_state:
                    failed_state["runs"].append({"id":str(uuid4()),"workflow":"knowledge_qa","kind":"knowledge","provider":"llm","status":"failed","nodes":[],"model_calls":1,"created_at":now(),"duration_ms":round((time.monotonic()-started)*1000),"retrieval":kb.backend,"knowledge_version":kb.version,"prompt_version":"knowledge-1.0","error":"模型回答无效或服务暂不可用；供应商响应与密钥未记录"})
                raise HTTPException(502,"模型回答无效或服务暂不可用；请稍后重试") from None
        else:
            answer="\n\n".join(f"{x['title']}：{x['summary']} [{x['id']}]" for x in citations)+"\n\n以上为开发者整理的 Demo 资料与规则，不含专业审核或效果验证。"
            used_provider="demo"
        run={"id":str(uuid4()),"workflow":"knowledge_qa","kind":"knowledge","provider":used_provider,"status":"completed","nodes":[{"node":"knowledge_retriever","summary":"检索资料与库内引用ID"},{"node":"evidence_answer","summary":"证据不足时明确说明"}],"model_calls":1 if used_provider=="llm" else 0,"created_at":now(),"duration_ms":round((time.monotonic()-started)*1000),"retrieval":kb.backend,"knowledge_version":kb.version,"prompt_version":"knowledge-1.0"}
        result={"id":str(uuid4()),"question":body.question,"answer":answer,"citations":citations,"provider":used_provider,"insufficient_evidence":insufficient,"run_id":run["id"],"created_at":now()}
        with store.mutate(user) as state:
            state["answers"].append(result);state["runs"].append(run);event(state,"knowledge_asked")
        return result

    @app.get("/api/history")
    def history(user: str=Depends(identity)):
        state=view(store.read(user))
        return {key:state[key] for key in ("profile_versions","plans","logs","reports","answers","events")}

    @app.get("/api/runs")
    def runs(user: str=Depends(identity)):return store.read(user)["runs"]

    @app.get("/api/export")
    def export(user: str=Depends(identity)):
        return {"schema_version":"1.0","exported_at":now(),"sample_data":any(x.get("sample") for x in store.read(user)["logs"]),"data":view(store.read(user))}

    @app.delete("/api/data")
    def delete_data(user: str=Depends(identity)):
        store.delete(user)
        return view(empty_state())

    @app.post("/api/demo/reset")
    @app.post("/api/demo/load")
    def reset(body: ResetInput=ResetInput(),user: str=Depends(identity)):
        store.delete(user)
        if body.scenario=="empty":return view(empty_state())
        with store.mutate(user) as state:
            profile=ProfileInput(nickname="小林（模拟案例）",experience_months=4,grade="V1–V2",goal="每周训练两次，观察脚点选择并完成复盘",adult_confirmed=True).model_dump()
            state["profile"]={**profile,"id":"profile","version":1,"created_at":now(),"corrections":{},"sample":True}
            state["goal"]={"text":profile["goal"],"focus":profile["focus"],"sessions_per_week":profile["sessions_per_week"]}
            # Sample reset must never consume paid API calls or masquerade as real AI.
            demo_coach=Coach(kb,ModelProvider());demo_coach.provider.name="demo"
            result=demo_coach.run(state,"plan")
            plan=result["plan"];plan["status"]="confirmed";plan["sample"]=True
            save_plan(state,plan);save_profile_version(state)
            event(state,"demo_loaded",sample=True)
        if body.scenario in ("time_short","pain"):
            session=state["sessions"][0]
            complete(session["id"],CompleteInput(actual_minutes=30),user)
            state=feedback(session["id"],FeedbackInput(difficulty=4,completed=False,main_issue="手指疼痛" if body.scenario=="pain" else "临时只有30分钟，困难线路脚点滑",pain=body.scenario=="pain"),user,coach_override=demo_coach)
            with store.mutate(user) as loaded:
                for log in loaded["logs"]:log["sample"]=True
                for report in loaded["reports"]:report["sample"]=True
            state=store.read(user)
        return view(state)

    dist=ROOT / "dist"
    if dist.exists():app.mount("/",StaticFiles(directory=str(dist),html=True),name="frontend")
    return app


app=create_app()

import copy
import time
from typing import TypedDict
from uuid import uuid4

from .knowledge import KnowledgeBase
from .provider import ModelProvider, ProviderError, is_pain
from .store import now


FOCUS = {"footwork":"脚点控制","route_reading":"读线与动作选择","consistency":"训练习惯","body_position":"身体协调"}
FOCUS_EXERCISE = {"footwork":"E02","route_reading":"E03","body_position":"E04","consistency":"E05"}
PROMPT_VERSION = "coach-1.0"


class Flow(TypedDict, total=False):
    user: dict
    kind: str
    feedback: dict
    plan: dict
    evidence: list
    trace: list
    report_parts: dict
    provider: str
    model_calls: int
    repairs: int


def node_trace(name: str, summary: str, started: float, **extra) -> dict:
    return {"node":name,"status":"completed","summary":summary,"duration_ms":round((time.monotonic()-started)*1000),"tool_calls":[],**extra}


class Coach:
    def __init__(self, knowledge: KnowledgeBase, provider: ModelProvider):
        self.kb = knowledge
        self.provider = provider
        self.graph = None
        self.orchestrator = "python_workflow"
        try:
            from langgraph.graph import StateGraph, START, END
            graph = StateGraph(Flow)
            graph.add_node("feedback_optimizer",self.feedback_node)
            graph.add_node("profile_agent",self.profile_node)
            graph.add_node("knowledge_retriever",self.retrieval_node)
            graph.add_node("training_planner",self.plan_node)
            graph.add_node("rule_validator",self.validation_node)
            graph.add_conditional_edges(START,lambda s: "feedback_optimizer" if s["kind"]=="feedback" else "profile_agent")
            graph.add_edge("feedback_optimizer","profile_agent")
            graph.add_edge("profile_agent","knowledge_retriever")
            graph.add_edge("knowledge_retriever","training_planner")
            graph.add_edge("training_planner","rule_validator")
            graph.add_edge("rule_validator",END)
            self.graph = graph.compile()
            self.orchestrator = "langgraph"
        except ImportError:
            pass

    def run(self, state: dict, kind: str, feedback: dict | None = None) -> dict:
        started = time.monotonic()
        flow = {"user":state,"kind":kind,"feedback":feedback or {},"trace":[],"provider":self.provider.name,"model_calls":0,"repairs":0}
        try:
            if self.graph:
                result = self.graph.invoke(flow)
            else:
                result = flow
                for node in ([self.feedback_node] if kind=="feedback" else []) + [self.profile_node,self.retrieval_node,self.plan_node,self.validation_node]:
                    result.update(node(result))
            run = self.make_run(result,started,"completed")
            state["runs"].append(run)
            result["run_id"] = run["id"]
            return result
        except ProviderError as exc:
            flow["model_calls"]=getattr(exc,"model_calls",1 if self.provider.name=="llm" else 0)
            flow["repairs"]=getattr(exc,"repairs",0)
            run=self.make_run(flow,started,"failed")
            run["error"]="模型输出或服务失败；已保留原计划，详细响应与密钥未记录"
            state["runs"].append(run)
            exc.run=run
            raise

    def make_run(self, flow: dict, started: float, status: str) -> dict:
        return {"id":str(uuid4()),"kind":flow["kind"],"workflow":"feedback_adjustment" if flow["kind"]=="feedback" else "initial_plan","status":status,"provider":flow.get("provider",self.provider.name),"model":self.provider.model if self.provider.name=="llm" else None,"orchestrator":self.orchestrator,"retrieval":self.kb.backend,"prompt_version":PROMPT_VERSION,"knowledge_version":self.kb.version,"profile_version":flow["user"]["profile"]["version"],"plan_version":flow.get("plan",{}).get("version"),"nodes":flow.get("trace",[]),"model_calls":flow.get("model_calls",0),"repair_attempts":flow.get("repairs",0),"duration_ms":round((time.monotonic()-started)*1000),"tokens":None,"cost":None,"created_at":now(),"note":"规则与检索 Demo；没有调用模型" if flow.get("provider")=="demo" else "模型选择受库内ID与业务规则约束；tokens/cost尚未接入计费统计"}

    def profile_node(self, flow: Flow) -> dict:
        started = time.monotonic()
        state = flow["user"]
        profile = state["profile"]
        reports = state["reports"]
        current_feedback = flow.get("feedback") if flow["kind"]=="feedback" else None
        observations = [{"id":r["id"],"text":r.get("main_issue","")} for r in reports]
        if current_feedback:
            observations.append({"id":current_feedback["id"],"text":current_feedback["main_issue"]})
        dimensions = []
        terms = {"footwork":("脚","滑"),"route_reading":("读线","路线","顺序"),"body_position":("身体","重心","平衡"),"consistency":("时间","缺席","习惯")}
        for key,label in FOCUS.items():
            related = [x for x in observations if any(term in x["text"] for term in terms[key])]
            selected = profile["focus"] == key
            correction = profile.get("corrections",{}).get(key)
            previous_semantic=next((r.get("hypotheses",[]) for r in reversed(reports) if r.get("provider")=="llm" and r.get("focus")==key),[])
            semantic = flow.get("report_parts",{}).get("hypotheses",[]) if key==profile["focus"] and current_feedback else previous_semantic
            dimensions.append({"key":key,"label":label,"observation":f"有 {len(related)} 条相关反馈记录" if related else ("用户自评希望优先关注此项" if selected else "尚无相关观察记录"),"hypothesis":correction or (semantic[0] if semantic and (flow.get("provider")=="llm" or previous_semantic) else f"{label}可能值得进一步观察" if selected or related else "证据不足，暂不判断"),"evidence_ids":list(dict.fromkeys([x["id"] for x in related]+([current_feedback["id"]] if semantic and current_feedback and key==profile["focus"] else []))) or ([f"profile-v{profile['version']}"] if selected or correction else []),"evidence_level":"用户纠正" if correction else ("训练记录，仍待验证" if related or semantic else "用户自评" if selected else "未知"),"next_step":"在轻松与困难线路中对照记录，必要时请教现场教练" if related else "下次记录一个具体观察"})
        strength_correction=profile.get("corrections",{}).get("strength")
        dimensions.append({"key":"strength","label":"力量与耐力","observation":"用户补充（未验证）："+strength_correction if strength_correction else "没有客观测量","hypothesis":"未知；不能从等级或一次完成情况推定","evidence_ids":[f"profile-v{profile['version']}"] if strength_correction else [],"evidence_level":"用户补充，客观能力未知" if strength_correction else "未知","next_step":"首版不生成力量或耐力分数"})
        profile["dimensions"] = dimensions
        profile["facts"] = [f"攀岩经历 {profile['experience_months']} 个月",f"每周计划 {profile['sessions_per_week']} 次，每次最多 {profile['available_minutes']} 分钟",f"等级自报：{profile['grade']}（{profile['grade_system']} / {profile['gym']}）"]
        profile["constraints"] = [f"单次训练不超过 {profile['available_minutes']} 分钟", "器材："+"、".join(profile["equipment"]), "训练建议已暂停" if state["paused"] else "当前未报告不适"]
        profile["missing_fields"] = ["力量与耐力的客观测量","专业教练评价"]
        return {"user":state,"trace":flow["trace"]+[node_trace("profile_agent","读取档案与反馈事实，保存带证据且可纠正的画像",started,tool_calls=["read_profile","read_training_history"])]}

    def feedback_node(self, flow: Flow) -> dict:
        started = time.monotonic()
        state, feedback = flow["user"], flow["feedback"]
        old = state["current_plan"]
        text = feedback["main_issue"]+feedback.get("notes","")
        pain = feedback["pain"] or is_pain(text)
        if pain:
            reason, action = "记录中出现不适信号，先暂停攀爬建议并寻求专业意见。", "pause"
        elif feedback["actual_minutes"] < next(s["duration_minutes"] for s in old["sessions"] if s["id"]==feedback["session_id"]) * 0.75:
            reason, action = "实际时间少于原安排，下一次优先压缩内容；不把时间不足认定为能力下降。", "shorten"
        elif feedback["difficulty"] >= 4 or not feedback["completed"]:
            reason, action = "任务体验偏难，下一次减少练习内容并在舒适线路上观察；一次反馈不足以判断能力变化。", "simplify"
        else:
            reason, action = "当前反馈不足以支持加量，保持训练安排并继续观察。", "keep"
        parts = {"action":action,"reason":reason,"observations":[f"本次实际训练 {feedback['actual_minutes']} 分钟",f"主观难度 {feedback['difficulty']}/5",f"用户报告：{feedback['main_issue']}"],"hypotheses":["观察仅来自当前用户记录；原因仍需在后续训练中验证。"],"pain":pain}
        used_provider="demo";calls=0
        if not pain and self.provider.name=="llm":
            schema={"type":"object","additionalProperties":False,"required":["category","hypothesis","reason","suggested_action"],"properties":{"category":{"type":"string","enum":["time","technical","difficulty","none","uncertain"]},"hypothesis":{"type":"string"},"reason":{"type":"string"},"suggested_action":{"type":"string","enum":["keep","shorten","simplify"]}}}
            payload={"actual_minutes":feedback["actual_minutes"],"difficulty":feedback["difficulty"],"completed":feedback["completed"],"main_issue":feedback["main_issue"],"notes":feedback.get("notes",""),"prior_feedback":[{"main_issue":r.get("main_issue",""),"summary":r["summary"]} for r in state["reports"][-3:]],"rule_action":action}
            semantic=self.provider.structured("只归纳真实反馈中的卡点类别与待验证假设。不能从一次记录认定能力下降，不提高负荷，不生成新动作。suggested_action只建议保持、缩短或简化。",payload,schema,"feedback_summary")
            calls=1
            if semantic.get("category") not in ("time","technical","difficulty","none","uncertain") or semantic.get("suggested_action") not in ("keep","shorten","simplify") or not isinstance(semantic.get("hypothesis"),str) or not isinstance(semantic.get("reason"),str):
                raise ProviderError("反馈归纳结构无效；没有修改画像或计划")
            if is_pain(semantic["hypothesis"]+semantic["reason"]):
                raise ProviderError("反馈归纳未通过训练场景边界检查；原计划已保留")
            # Model meaning helps choose a conservative branch; hard time/difficulty
            # gates take precedence and no action can increase load or invent exercises.
            if action=="keep" and semantic["suggested_action"]=="simplify":
                parts["action"]="simplify"
            parts["category"]=semantic["category"]
            parts["hypotheses"]=[semantic["hypothesis"][:800]+"（模型根据本次反馈归纳，仍待验证）"]
            parts["reason"]=reason+" "+semantic["reason"][:800]
            used_provider="llm"
        return {"report_parts":parts,"provider":used_provider,"model_calls":calls,"trace":flow["trace"]+[node_trace("feedback_optimizer",parts["reason"],started,tool_calls=["read_confirmed_plan","compare_actual_time"],model_calls=calls,provider=used_provider)]}

    def retrieval_node(self, flow: Flow) -> dict:
        started = time.monotonic()
        state = flow["user"]
        query = FOCUS[state["profile"]["focus"]] + " 计划 时间 记录"
        if flow.get("report_parts",{}).get("pain") or state["paused"]:
            evidence = [self.kb.citation("K09")]
        else:
            evidence = self.kb.search(query,3)
        return {"evidence":evidence,"trace":flow["trace"]+[node_trace("knowledge_retriever","按主题检索来源与Demo规则；字符哈希向量不是模型语义embedding",started,tool_calls=["knowledge_search","exercise_lookup"],citation_ids=[x["id"] for x in evidence],retrieval=self.kb.backend)]}

    def plan_node(self, flow: Flow) -> dict:
        started = time.monotonic()
        state, profile = flow["user"], flow["user"]["profile"]
        old = state.get("current_plan")
        if state["paused"] or flow.get("report_parts",{}).get("pain"):
            if old:
                plan = copy.deepcopy(old)
                plan["version"] += 1
                plan["status"] = "paused"
                for s in plan["sessions"]:
                    if s["status"] not in ("completed","skipped"): s["status"]="paused"
            else:
                plan = self.base_plan(profile,[],flow["evidence"],"demo")
                plan["status"] = "paused"
            plan["summary"] = "暂停攀爬建议；请寻求适当的现场或专业意见。"
            return {"plan":plan,"provider":"demo","trace":flow["trace"]+[node_trace("training_planner","不适分支由规则控制，跳过模型与训练推荐",started,tool_calls=["pause_recommendations"])]}
        if flow["kind"]=="feedback":
            plan = copy.deepcopy(old)
            parts = flow["report_parts"]
            plan["version"] += 1
            plan["status"] = "draft"
            plan["summary"] = parts["reason"]
            pending = [s for s in plan["sessions"] if s["status"]=="planned"]
            if parts["action"] != "keep" and pending:
                budget = max(20,min(profile["available_minutes"],flow["feedback"]["actual_minutes"])) if parts["action"]=="shorten" else max(20,int(pending[0]["duration_minutes"]*0.75))
                new_session = self.rule_session(profile,budget,0)
                new_session["id"] = pending[0]["id"]
                new_session["day"] = pending[0]["day"]
                new_session["rationale"] = parts["reason"]
                plan["sessions"][plan["sessions"].index(pending[0])] = new_session
            plan["total_week_minutes"] = sum(s["duration_minutes"] for s in plan["sessions"])
            plan["profile_version"] = profile["version"]
            plan["provider"] = flow.get("provider","demo")
            plan["created_at"] = now()
            # Feedback adjustments are constrained deterministic decisions even in LLM mode.
            return {"plan":plan,"provider":flow.get("provider","demo"),"trace":flow["trace"]+[node_trace("training_planner","只修改下一次未完成任务，生成待用户确认的版本",started,tool_calls=["compose_adjustment"])]}
        if self.provider.name == "llm":
            plan, calls, repairs = self.llm_plan(profile,flow["evidence"])
        else:
            plan = self.base_plan(profile,[self.rule_session(profile,profile["available_minutes"],i) for i in range(profile["sessions_per_week"])],flow["evidence"],"demo")
            calls, repairs = 0,0
        return {"plan":plan,"model_calls":calls,"repairs":repairs,"trace":flow["trace"]+[node_trace("training_planner","从开发者整理的Demo练习库选择并组装计划；专业审核待完成",started,tool_calls=["compose_plan"],model_calls=calls,repair_attempts=repairs)]}

    def base_plan(self, profile: dict, sessions: list, evidence: list, provider: str) -> dict:
        citations = {x["id"]:x for x in evidence}
        for session in sessions:
            for exercise in session["exercises"]:
                for item_id in exercise["citation_ids"]:
                    citations[item_id]=self.kb.citation(item_id)
        return {"id":str(uuid4()),"version":1,"status":"draft","title":f"{FOCUS[profile['focus']]} · 本周训练","focus":profile["focus"],"goal":profile["goal"],"summary":"按照自评重点与时间预算组织训练，练完用记录检验假设。","rationale":f"你选择了{FOCUS[profile['focus']]}；每次可用{profile['available_minutes']}分钟。时长为Demo配置，训练效果待验证。","sessions":sessions,"total_week_minutes":sum(s["duration_minutes"] for s in sessions),"profile_version":profile["version"],"knowledge_version":self.kb.version,"provider":provider,"citations":list(citations.values()),"created_at":now()}

    def exercise(self, item_id: str, minutes: int) -> dict:
        item = copy.deepcopy(self.kb.exercises[item_id])
        item["duration_minutes"] = minutes
        item["rationale"] = "按当前重点与时间预算选择的Demo练习；专业审核待完成。"
        return item

    def rule_session(self, profile: dict, budget: int, index: int) -> dict:
        wall = {"climbing_wall","mat"}.issubset(set(profile["equipment"]))
        if wall:
            ids = ["E01",FOCUS_EXERCISE[profile["focus"]],"E08","E09"]
        else:
            ids = ["E10","E08","E09"]
        minutes = [self.kb.exercises[x]["min_minutes"] for x in ids]
        remaining = budget-sum(minutes)
        # Respect per-exercise limits. Unused time is permitted, never invented.
        for preferred in (1,0,2,3):
            if preferred>=len(ids): continue
            room = self.kb.exercises[ids[preferred]]["max_minutes"]-minutes[preferred]
            add = min(room,max(0,remaining))
            minutes[preferred]+=add; remaining-=add
        exercises=[self.exercise(item_id,minutes[i]) for i,item_id in enumerate(ids)]
        return {"id":str(uuid4()),"day":"周三" if index==0 else "周六" if index==1 else "周日","title":f"第 {index+1} 次 · {FOCUS[profile['focus']]}","focus":profile["focus"],"duration_minutes":sum(minutes),"status":"planned","exercises":exercises,"rationale":"从舒适线路或地面记录开始，保留休息和复盘时间。","stop_condition":"出现疼痛、不适或明显疲劳时停止攀爬，并向适当的专业人士咨询。"}

    def llm_plan(self, profile: dict, evidence: list) -> tuple[dict,int,int]:
        schema = {"type":"object","additionalProperties":False,"required":["summary","rationale","sessions"],"properties":{"summary":{"type":"string"},"rationale":{"type":"string"},"sessions":{"type":"array","items":{"type":"object","additionalProperties":False,"required":["title","exercise_ids","minutes"],"properties":{"title":{"type":"string"},"exercise_ids":{"type":"array","items":{"type":"string"}},"minutes":{"type":"array","items":{"type":"integer"}}}}}}}
        safe_profile = {key:profile[key] for key in ("experience_months","sessions_per_week","available_minutes","equipment","goal","focus")}
        payload={"profile":safe_profile,"knowledge":evidence,"exercise_library":list(self.kb.exercises.values()),"constraints":{"require_preparation_rest_review_if_climbing":True,"budget_per_session":profile["available_minutes"],"session_count":profile["sessions_per_week"]}}
        last_errors=[]
        for attempt in range(2):
            if attempt: payload["validation_errors"]=last_errors
            try:
                output=self.provider.structured("按库内练习ID选择计划，不要修改练习动作。每个session的exercise_ids与minutes一一对应；时长必须满足库内min/max以及预算。",payload,schema,"coach_plan")
            except ProviderError as exc:
                exc.model_calls=attempt+1;exc.repairs=attempt
                raise
            try:
                sessions=[]
                for i,spec in enumerate(output["sessions"]):
                    if len(spec["exercise_ids"]) != len(spec["minutes"]): raise ValueError("练习与时长未对齐")
                    session=self.rule_session(profile,profile["available_minutes"],i)
                    session["title"]=str(spec["title"])[:120]
                    session["exercises"]=[self.exercise(item_id,int(minutes)) for item_id,minutes in zip(spec["exercise_ids"],spec["minutes"])]
                    session["duration_minutes"]=sum(x["duration_minutes"] for x in session["exercises"])
                    sessions.append(session)
                plan=self.base_plan(profile,sessions,evidence,"llm")
                plan["summary"]=str(output["summary"])[:800];plan["rationale"]=str(output["rationale"])[:1200]
                last_errors=self.validate(plan,profile)
                if len(sessions)!=profile["sessions_per_week"]: last_errors.append("训练次数与用户约束不符")
                if is_pain(plan["summary"]+plan["rationale"]): last_errors.append("模型输出涉及不适/诊疗而非训练解释")
                if not last_errors:return plan,attempt+1,attempt
            except (KeyError,ValueError,TypeError):
                last_errors=["未知练习ID或结构无效"]
        failure=ProviderError("模型计划在一次修复后仍未通过校验；原计划已保留")
        failure.model_calls=2;failure.repairs=1
        raise failure

    def validate(self, plan: dict, profile: dict) -> list[str]:
        errors=[]
        if plan["status"]=="paused": return []
        valid_citations=set(self.kb.items)
        plan_citations={x["id"] for x in plan["citations"]}
        if not plan_citations.issubset(valid_citations):errors.append("引用ID不在知识库")
        for session in plan["sessions"]:
            ids=[x["id"] for x in session["exercises"]]
            if len(ids)!=len(set(ids)):errors.append("同一练习重复")
            if not set(ids).issubset(set(self.kb.exercises)):errors.append("未知练习ID");continue
            total=sum(x["duration_minutes"] for x in session["exercises"])
            if total!=session["duration_minutes"] or total>profile["available_minutes"]:errors.append("训练时长超过预算或求和错误")
            climbing=any("mat" in self.kb.exercises[x]["requires"] for x in ids)
            if climbing and not {"E01","E08","E09"}.issubset(set(ids)):errors.append("攀爬计划缺准备、休息或复盘")
            for exercise in session["exercises"]:
                item=self.kb.exercises[exercise["id"]]
                if not set(item["requires"]).issubset(set(profile["equipment"])):errors.append("器材条件不匹配")
                if not item["min_minutes"]<=exercise["duration_minutes"]<=item["max_minutes"]:errors.append("练习时长超出Demo规则")
                if not set(item["citation_ids"]).issubset(plan_citations):errors.append("缺少练习引用")
        return sorted(set(errors))

    def validation_node(self, flow: Flow) -> dict:
        started=time.monotonic()
        errors=self.validate(flow["plan"],flow["user"]["profile"])
        if errors:raise ProviderError("计划未通过业务规则检查；没有保存未验证计划")
        flow["plan"]["validation"]={"valid":True,"errors":[],"checks":["库内练习ID","时长预算与求和","器材适用","引用ID","不适暂停"],"repair_attempts":flow.get("repairs",0)}
        return {"plan":flow["plan"],"trace":flow["trace"]+[node_trace("rule_validator","规则校验通过；草案须由用户确认",started,tool_calls=["validate_duration","validate_equipment","validate_citations","check_pain_gate"])]}

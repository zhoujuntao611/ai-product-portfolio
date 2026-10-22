"""Exercise real-model planning, feedback and knowledge Q&A through the API."""
from pathlib import Path
import json
import os
import sys
import tempfile
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


def main():
    from urllib.parse import urlsplit
    if urlsplit(os.environ.get("ANTHROPIC_BASE_URL","")).hostname!="api.deepseek.com":
        raise SystemExit("Configure this script for the intended provider first.")
    os.environ.update(CLIMBAI_PROVIDER="llm",CLIMBAI_API_KEY=os.environ["ANTHROPIC_AUTH_TOKEN"],
        CLIMBAI_API_BASE="https://api.deepseek.com/v1",CLIMBAI_MODEL=os.environ.get("ANTHROPIC_MODEL","deepseek-v4-pro").lower(),
        CLIMBAI_API_MODE="chat_json",CLIMBAI_THINKING="disabled",CLIMBAI_API_TIMEOUT="45",CLIMBAI_MAX_OUTPUT_TOKENS="1800",CLIMBAI_CHROMA_PATH="")
    from fastapi.testclient import TestClient
    from backend.main import create_app
    rows=[]
    with tempfile.TemporaryDirectory(prefix="climbai-live-") as temp:
        app=create_app(str(Path(temp)/"live.sqlite3"),chroma_path="")
        client=TestClient(app)
        client.headers["X-Session-ID"]=str(uuid4())
        provider=app.state.coach.provider
        def step(name,path,payload,check):
            before=len(provider.telemetry)
            response=client.post(path,json=payload)
            output=response.json()
            passed=response.status_code==200 and check(output)
            rows.append({"step":name,"status_code":response.status_code,"passed":passed,"input":payload,"output":output,"calls":provider.telemetry[before:]})
            print(name,response.status_code,"PASS" if passed else "FAIL",flush=True)
            return output if response.status_code==200 else None
        profile=step("profile","/api/profile",{"nickname":"真实模型流程验证","adult_confirmed":True,"focus":"footwork","sessions_per_week":2,"available_minutes":45,"goal":"建立脚点观察与训练后记录习惯"},lambda x:bool(x.get("profile")))
        generated=step("llm_plan","/api/plans/generate",{},lambda x:x.get("current_plan",{}).get("provider")=="llm" and x["current_plan"].get("validation",{}).get("valid") is True and all(s["duration_minutes"]<=45 for s in x["current_plan"]["sessions"]))
        if generated:
            v=generated["current_plan"]["version"]
            confirmed=step("confirm_plan","/api/plans/confirm",{"expected_version":v},lambda x:x["current_plan"]["status"]=="confirmed")
            if confirmed:
                sid=confirmed["sessions"][0]["id"]
                step("complete","/api/sessions/"+sid+"/complete",{"actual_minutes":25},lambda x:len(x["logs"])==1)
                feedback=step("llm_feedback","/api/sessions/"+sid+"/feedback",{"difficulty":3,"completed":False,"main_issue":"临时加班导致时间不够","notes":"原计划45分钟，今天只待了25分钟；简单线路能完成，主要是时间不足。","pain":False},lambda x:bool(x.get("reports")) and x["reports"][-1]["provider"]=="llm")
                if feedback:
                    rid=feedback["reports"][-1]["id"]
                    step("accept_adjustment","/api/reports/"+rid+"/accept",{"expected_version":feedback["current_plan"]["version"]},lambda x:x["current_plan"]["version"]>v)
        step("llm_knowledge","/api/knowledge/ask",{"question":"室内抱石训练记录应该记录哪些信息，怎样用来调整下次安排？"},lambda x:x.get("provider")=="llm" and bool(x.get("citations")) and not x.get("insufficient_evidence"))
        step("out_of_scope","/api/knowledge/ask",{"question":"火星基地的反重力攀岩靴什么时候上市？"},lambda x:x.get("insufficient_evidence") is True)
        step("pain_pause","/api/profile",{"adult_confirmed":True,"goal":"保持训练记录","recent_pain":True},lambda x:x.get("paused") is True)
        report={"date":"2026-10-19","model":provider.model,"retrieval_backend":app.state.kb.backend,"passed":sum(x["passed"] for x in rows),"total":len(rows),"completed_api_calls":sum(x.get("success",False) for x in provider.telemetry),"telemetry":provider.telemetry,"steps":rows}
        (ROOT/"verification/live-workflow-20261019.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
        print(json.dumps({k:v for k,v in report.items() if k not in ("steps","telemetry")},ensure_ascii=False),flush=True)


if __name__=="__main__":main()

"""Produce an honest report from the actual unittest results, not preset totals."""
import datetime
import json
import time
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent

class RecordedResult(unittest.TextTestResult):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs); self.records=[]
    def startTest(self,test): self.started=time.perf_counter();super().startTest(test)
    def addSuccess(self,test): self.records.append({"case":test.id(),"status":"passed","elapsed_ms":round((time.perf_counter()-self.started)*1000,2)});super().addSuccess(test)
    def addFailure(self,test,err): self.records.append({"case":test.id(),"status":"failed","detail":self._exc_info_to_string(err,test)});super().addFailure(test,err)
    def addError(self,test,err): self.records.append({"case":test.id(),"status":"error","detail":self._exc_info_to_string(err,test)});super().addError(test,err)

def main():
    suite=unittest.defaultTestLoader.discover(str(ROOT/"tests"),pattern="test_*.py")
    started=time.perf_counter()
    result=unittest.TextTestRunner(verbosity=2,resultclass=RecordedResult).run(suite)
    categories={}
    names={"NumericTests":"numeric_and_domain","ClarificationTests":"clarification_and_input","SecurityTests":"sql_guard_and_resources","ModelAdapterTests":"local_model_protocol_mock","HttpBoundaryTests":"local_http_boundary"}
    for record in result.records:
        label=names.get(record["case"].split(".")[-2],"other")
        categories.setdefault(label,{"total":0,"passed":0});categories[label]["total"]+=1;categories[label]["passed"]+=int(record["status"]=="passed")
    report={"project":"MetricPilot","generated_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"scope":"Offline deterministic parser, independent 4-order business fixture, synthetic dataset invariants, SQLite attack/limit cases, local HTTP model stub and local app HTTP boundary. These are regression checks, not business task or live model samples. No live external provider or real user evaluation.","tests_run":result.testsRun,"passed":len([r for r in result.records if r["status"]=="passed"]),"failed":len(result.failures),"errors":len(result.errors),"elapsed_seconds":round(time.perf_counter()-started,3),"categories":categories,"live_provider_tested":False,"real_users_tested":False,"cases":result.records}
    encoded=json.dumps(report,ensure_ascii=False,indent=2)
    (ROOT/"docs"/"eval_report.json").write_text(encoded,encoding="utf-8")
    (ROOT/"eval_report.json").write_text(encoded,encoding="utf-8")
    return 0 if result.wasSuccessful() else 1

if __name__=="__main__": raise SystemExit(main())

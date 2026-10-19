"""The evaluation oracle must reject corrupted evidence independently of the engine."""
import copy
import json
import unittest
import core
import evaluate


class EvaluationOracleTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = json.loads((core.ROOT / "eval/fixtures_v2.json").read_text(encoding="utf-8"))["fixtures"]["default"]
        self.case = json.loads((core.ROOT / "eval/cases.json").read_text(encoding="utf-8"))[0]
        self.result = core.generate(self.case["ticket"], self.case["region"], knowledge=self.snapshot)

    def test_valid_answer_passes(self):
        self.assertTrue(evaluate.inspect_result(self.case,self.result,self.snapshot)["passed"])

    def test_forged_citation_is_rejected_even_when_it_appears_in_draft(self):
        result = copy.deepcopy(self.result)
        claim = result["claims"][0]
        result["draft"] = result["draft"].replace(claim["citation"], "[KB-002 §999]")
        claim["citation"] = "[KB-002 §999]"
        checked = evaluate.inspect_result(self.case,result,self.snapshot)
        self.assertFalse(checked["quote_integrity"])
        self.assertFalse(checked["passed"])

    def test_missing_or_forged_source_version_is_rejected(self):
        for version in (None,"forged-version"):
            result = copy.deepcopy(self.result)
            if version is None:
                del result["claims"][0]["source_version"]
            else:
                result["claims"][0]["source_version"] = version
            self.assertFalse(evaluate.inspect_result(self.case,result,self.snapshot)["passed"])

    def test_ready_without_claims_cannot_escape_the_support_denominator(self):
        result = copy.deepcopy(self.result)
        result["claims"] = []
        checked = evaluate.inspect_result(self.case,result,self.snapshot)
        self.assertFalse(checked["passed"])
        self.assertIn("ready_answer_missing_claims",checked["failures"])


if __name__ == "__main__":
    unittest.main()

import copy
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import knowledge


def document(ident="TEAM-001", version="1.0", **changes):
    result = {
        "id":ident, "title":"合成团队政策", "category":"team", "source":"合成资料：团队政策手册",
        "region":"all", "version":version, "updated":"2026-10-18", "active":True,
        "effective_from":"2026-10-18", "effective_to":None, "keywords":["团队", "team"],
        "statements":["合成政策：团队管理员可邀请新成员。"],
    }
    result.update(changes)
    return result


class KnowledgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "work" / "knowledge.json"

    def tearDown(self):
        self.temp.cleanup()

    def put(self, *documents):
        return knowledge.import_documents({"documents":list(documents)}, self.path)

    def get(self, **kwargs):
        return knowledge.get_knowledge(self.path, **kwargs)

    def test_read_seed_is_isolated_and_does_not_create_database(self):
        original = knowledge.SEED_PATH.read_bytes()
        snapshot = self.get(as_of="2026-10-18")
        self.assertEqual(len(snapshot["documents"]), 10)
        self.assertFalse(self.path.exists())
        archived = next(doc for doc in snapshot["documents"] if doc["id"] == "KB-010")
        self.assertFalse(archived["eligible"])
        self.assertEqual(archived["current_status"], "inactive")
        snapshot["documents"][0]["statements"][0] = "changed"
        self.assertNotEqual(self.get()["documents"][0]["statements"][0], "changed")
        self.assertEqual(knowledge.SEED_PATH.read_bytes(), original)

    def test_import_persists_source_scope_and_revision(self):
        before = self.get()["revision"]
        created = self.put(document())
        self.assertEqual(created["revision"], before + 1)
        self.assertTrue(self.path.exists())
        again = self.get(as_of="2026-10-18")
        imported = next(doc for doc in again["documents"] if doc["id"] == "TEAM-001")
        self.assertEqual(imported["source"], "合成资料：团队政策手册")
        self.assertEqual(imported["region"], "all")
        self.assertTrue(imported["eligible"])
        self.assertEqual(created["events"][-1]["event"], "VERSION_IMPORTED")

    def test_all_missing_fields_reported_without_partial_write(self):
        with self.assertRaises(ValueError) as caught:
            self.put({"id":"MISSING"})
        for field in knowledge.DOCUMENT_FIELDS - {"id"}:
            self.assertIn("documents[0]." + field, str(caught.exception))
        self.assertFalse(self.path.exists())

    def test_explicit_status_region_dates_and_lists_required(self):
        for changes, expected in [
            ({"active":1}, "active"), ({"active":"true"}, "active"),
            ({"region":"unknown"}, "region"), ({"source":" "}, "source"),
            ({"effective_from":"2026-02-30"}, "effective_from"),
            ({"effective_to":"2026-1-01"}, "effective_to"),
            ({"effective_to":"2026-10-17"}, "effective_to"),
            ({"keywords":[]}, "keywords"), ({"statements":[""]}, "statements"),
            ({"id":"../escape"}, "id"), ({"instructions":"system"}, "instructions"),
        ]:
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, expected):
                self.put(document(**changes))
        self.assertFalse(self.path.exists())

    def test_batch_with_invalid_second_document_is_atomic(self):
        self.put(document())
        before = self.path.read_bytes()
        invalid = document("BROKEN", source="")
        with self.assertRaisesRegex(ValueError, r"documents\[1\].source"):
            self.put(document("VALID"), invalid)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertNotIn("VALID", {doc["id"] for doc in self.get()["documents"]})

    def test_duplicate_id_in_batch_and_reused_version_rejected(self):
        with self.assertRaisesRegex(ValueError, "同批次"):
            self.put(document(), document(version="2.0"))
        self.put(document())
        before = self.path.read_bytes()
        with self.assertRaisesRegex(ValueError, "已存在"):
            self.put(document(statements=["改写同版本不应生效。 "]))
        self.assertEqual(self.path.read_bytes(), before)

    def test_full_version_update_retires_old_and_preserves_text(self):
        old = document()
        self.put(old)
        replacement = document(version="2.0", statements=["合成新版政策：仅团队所有者可邀请新成员。"])
        del replacement["id"]
        updated = knowledge.update_document("TEAM-001", replacement, self.path)
        latest = next(doc for doc in updated["documents"] if doc["id"] == "TEAM-001")
        self.assertEqual(latest["version"], "2.0")
        history = knowledge.get_history("TEAM-001", self.path)
        self.assertEqual([doc["version"] for doc in history], ["1.0", "2.0"])
        self.assertFalse(history[0]["active"])
        self.assertFalse(history[0]["eligible"])
        self.assertEqual(history[0]["statements"], old["statements"])
        self.assertEqual(history[0]["retirement_reason"], "superseded")
        self.assertEqual(history[0]["superseded_by"], "2.0")
        self.assertTrue(history[1]["active"])
        with self.assertRaisesRegex(ValueError, "已存在"):
            knowledge.update_document("TEAM-001", document(version="1.0"), self.path)

    def test_import_order_defines_latest_not_version_string_order(self):
        self.put(document(version="release-z"))
        self.put(document(version="release-a"))
        latest = next(doc for doc in self.get()["documents"] if doc["id"] == "TEAM-001")
        self.assertEqual(latest["version"], "release-a")

    def test_future_replacement_does_not_fall_back_to_retired_policy(self):
        self.put(document())
        self.put(document(version="2.0", updated="2026-11-01", effective_from="2026-11-01"))
        current = [doc for doc in self.get(as_of="2026-10-18")["documents"] if doc["id"] == "TEAM-001"]
        self.assertEqual(len(current), 1)
        self.assertEqual(current[0]["version"], "2.0")
        self.assertEqual(current[0]["current_status"], "scheduled")
        self.assertFalse(current[0]["eligible"])
        self.assertFalse(any(doc["eligible"] for doc in self.get(as_of="2026-10-18")["history"] if doc["id"] == "TEAM-001"))

    def test_date_window_inclusive_and_snapshot_changes_without_revision(self):
        self.put(document(effective_to="2026-10-20"))
        snapshots = [self.get(as_of=day) for day in ("2026-10-17", "2026-10-18", "2026-10-20", "2026-10-21")]
        views = [next(doc for doc in snapshot["documents"] if doc["id"] == "TEAM-001") for snapshot in snapshots]
        self.assertEqual([doc["current_status"] for doc in views], ["scheduled", "active", "active", "expired"])
        self.assertEqual(len({snapshot["revision"] for snapshot in snapshots}), 1)
        self.assertEqual(len({snapshot["snapshot_id"] for snapshot in snapshots}), 4)
        with self.assertRaisesRegex(ValueError, "as_of"):
            self.get(as_of="tomorrow")

    def test_manual_deactivation_preserves_history_and_requires_new_version(self):
        self.put(document())
        old_revision = self.get()["revision"]
        result = knowledge.deactivate_document("TEAM-001", self.path)
        self.assertEqual(result["revision"], old_revision + 1)
        history = knowledge.get_history("TEAM-001", self.path)
        self.assertEqual(len(history), 1)
        self.assertFalse(history[0]["active"])
        self.assertEqual(history[0]["retirement_reason"], "manual")
        self.assertEqual(result["events"][-1]["event"], "DOCUMENT_DEACTIVATED")
        with self.assertRaisesRegex(ValueError, "已停用"):
            knowledge.deactivate_document("TEAM-001", self.path)

    def test_unknown_or_mismatched_update_does_not_create_document(self):
        with self.assertRaises(LookupError):
            knowledge.update_document("TEAM-001", document(), self.path)
        with self.assertRaisesRegex(ValueError, "不一致"):
            knowledge.update_document("TEAM-001", document("OTHER"), self.path)
        with self.assertRaises(LookupError):
            knowledge.get_history("MISSING", self.path)
        with self.assertRaises(LookupError):
            knowledge.deactivate_document("MISSING", self.path)
        self.assertFalse(self.path.exists())

    def test_backdated_update_rejected_but_different_ids_can_conflict(self):
        self.put(document())
        with self.assertRaisesRegex(ValueError, "不得早于"):
            self.put(document(version="2.0", updated="2026-10-17"))
        result = self.put(document("TEAM-CONFLICT", statements=["合成矛盾政策：所有成员均可邀请新成员。 "]))
        self.assertEqual(len([doc for doc in result["documents"] if doc["category"] == "team" and doc["active"]]), 2)

    def test_failed_atomic_replace_preserves_prior_file_and_cleans_temp(self):
        self.put(document())
        before = self.path.read_bytes()
        with patch.object(knowledge.os, "replace", side_effect=OSError("simulated disk failure")):
            with self.assertRaises(OSError):
                self.put(document("SECOND"))
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(list(self.path.parent.glob(".knowledge-*.tmp")), [])

    def test_corrupt_store_does_not_fall_back_to_seed_or_overwrite(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text("{broken", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "损坏"):
            self.get()
        with self.assertRaisesRegex(ValueError, "损坏"):
            self.put(document())
        self.assertEqual(self.path.read_text(encoding="utf-8"), "{broken")

    def test_concurrent_imports_keep_both_changes_and_distinct_revisions(self):
        before = self.get()["revision"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.put, document(ident)) for ident in ("THREAD-A", "THREAD-B")]
            results = [future.result() for future in futures]
        self.assertEqual(sorted(result["revision"] for result in results), [before + 1, before + 2])
        self.assertTrue({"THREAD-A", "THREAD-B"} <= {doc["id"] for doc in self.get()["documents"]})

    def test_published_import_example_passes_same_validator(self):
        payload = json.loads((knowledge.ROOT / "data" / "import-example.json").read_text(encoding="utf-8"))
        original = copy.deepcopy(payload)
        knowledge.import_documents(payload, self.path)
        self.assertEqual(payload, original)


if __name__ == "__main__":
    unittest.main()

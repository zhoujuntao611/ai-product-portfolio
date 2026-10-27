"""Offline provenance checks using real, temporary Git indexes (standard library only)."""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("oriel_source_integrity", Path(__file__).with_name("check-oriel-source.py"))
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


def _json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _record(name, data, mode="100644"):
    return {"path": name, "mode": mode, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "git_blob": hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()}


class SourceIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="oriel-integrity-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.project = self.root / "projects/oriel"
        self.source = self.project / "source"
        self.source.mkdir(parents=True)
        self.git("init", "-q")
        self.git("config", "core.autocrlf", "false")
        self.git("config", "core.filemode", "false")
        self.base_files = {"LICENSE": b"Original attribution\n", "pico/runtime.py": b"old behavior\n", "retired.py": b"old module\n"}
        for name, data in self.base_files.items():
            self.write_source(name, data)
        self.baseline = {
            "schema": 1, "source_repository": CHECKER.UPSTREAM_REPOSITORY,
            "source_branch": CHECKER.UPSTREAM_BRANCH, "source_commit": CHECKER.UPSTREAM_COMMIT,
            "snapshot_date": "2026-10-26", "source_modified": False,
            "file_count": 3, "total_bytes": sum(map(len, self.base_files.values())),
            "files": [_record(name, data) for name, data in sorted(self.base_files.items())],
        }
        self.baseline_bytes = _json_bytes(self.baseline)
        self.anchor = hashlib.sha256(self.baseline_bytes).hexdigest()
        (self.project / CHECKER.BASELINE_NAME).write_bytes(self.baseline_bytes)
        self.write_source("pico/runtime.py", b"new behavior\n")
        self.write_source("tests/regression.py", b"regression test\n")
        (self.source / "retired.py").unlink()
        self.git("add", "--all", "projects/oriel/source")
        self.manifest = {**copy.deepcopy(self.baseline), "schema": 2, "snapshot_date": "2026-10-27",
                         "source_modified": True, "development_commit": "b" * 40,
                         "baseline_manifest": CHECKER.BASELINE_NAME, "changes_manifest": CHECKER.CHANGES_NAME}
        self.refresh_records()
        old = {item["path"]: item for item in self.baseline["files"]}
        new = {item["path"]: item for item in self.manifest["files"]}
        self.changes = {
            "schema": 1, "upstream_base_commit": CHECKER.UPSTREAM_COMMIT,
            "development_commit": self.manifest["development_commit"], "baseline_manifest_sha256": self.anchor,
            "changes": [{"path": name, "status": "added" if name not in old else "deleted" if name not in new else "modified",
                         "before": old.get(name), "after": new.get(name)}
                        for name in sorted(set(old) | set(new)) if old.get(name) != new.get(name)],
        }
        self.save_metadata()

    def git(self, *arguments):
        return subprocess.check_output(["git", *arguments], cwd=self.root, stderr=subprocess.PIPE)

    def write_source(self, name, data):
        target = self.source / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def refresh_records(self):
        files = sorted(path for path in self.source.rglob("*") if path.is_file())
        self.manifest["files"] = [_record(path.relative_to(self.source).as_posix(), path.read_bytes()) for path in files]
        self.manifest["file_count"] = len(files)
        self.manifest["total_bytes"] = sum(item["bytes"] for item in self.manifest["files"])

    def save_metadata(self):
        (self.project / "SOURCE_MANIFEST.json").write_bytes(_json_bytes(self.manifest))
        (self.project / CHECKER.CHANGES_NAME).write_bytes(_json_bytes(self.changes))

    def verify(self):
        return CHECKER.verify_source(self.root, baseline_sha256=self.anchor, baseline_file_count=3,
                                     required_files={"LICENSE", "pico/runtime.py"})

    def assertRejected(self, fragment):
        errors = self.verify()
        self.assertTrue(any(fragment in error for error in errors), errors)

    def test_registered_add_modify_delete_pass_with_real_index(self):
        self.assertEqual([], self.verify())

    def test_unregistered_source_change_is_rejected_even_after_manifest_and_index_update(self):
        self.write_source("pico/runtime.py", b"another change\n")
        self.git("add", "projects/oriel/source/pico/runtime.py")
        self.refresh_records()
        self.save_metadata()
        self.assertRejected("exact baseline/current manifest difference")

    def test_missing_change_receipt_is_rejected(self):
        self.changes["changes"].pop()
        self.save_metadata()
        self.assertRejected("exact baseline/current manifest difference")

    def test_changed_manifest_file_count_is_rejected(self):
        self.manifest["file_count"] += 1
        self.save_metadata()
        self.assertRejected("file count or total bytes mismatch")

    def test_baseline_rewrite_and_recomputed_declared_hash_cannot_replace_anchor(self):
        tampered = copy.deepcopy(self.baseline)
        tampered["snapshot_date"] = "2026-10-25"
        data = _json_bytes(tampered)
        (self.project / CHECKER.BASELINE_NAME).write_bytes(data)
        self.changes["baseline_manifest_sha256"] = hashlib.sha256(data).hexdigest()
        self.save_metadata()
        self.assertRejected("differs from the trusted anchor")

    def test_working_source_hash_change_is_rejected(self):
        self.write_source("pico/runtime.py", b"unregistered working bytes\n")
        self.assertRejected("Source bytes changed")

    def test_manifest_hash_change_is_rejected(self):
        self.manifest["files"][1]["sha256"] = "0" * 64
        self.save_metadata()
        self.assertRejected("Source bytes changed")

    def test_invalid_record_metadata_returns_errors_instead_of_crashing(self):
        self.manifest["files"][1]["mode"] = []
        self.save_metadata()
        self.assertRejected("invalid metadata")

    def test_receipt_integer_metadata_cannot_be_replaced_with_equal_float(self):
        record = self.changes["changes"][0]["before"]
        record["bytes"] = float(record["bytes"])
        self.save_metadata()
        self.assertRejected("exact baseline/current manifest difference")

    def test_index_executable_mode_change_is_rejected_on_all_platforms(self):
        self.git("update-index", "--chmod=+x", "projects/oriel/source/pico/runtime.py")
        self.assertRejected("Indexed blob or executable mode mismatch")

    def test_extra_staged_source_file_is_rejected(self):
        self.write_source("unexpected.py", b"extra\n")
        self.git("add", "projects/oriel/source/unexpected.py")
        self.assertRejected("Indexed source file set differs")

    def test_missing_staged_source_file_is_rejected(self):
        self.git("rm", "--cached", "projects/oriel/source/pico/runtime.py")
        self.assertRejected("Indexed source file set differs")

    def test_unsafe_and_noncanonical_paths_are_rejected(self):
        for unsafe in ("../escape.py", "/absolute.py", "C:/escape.py", "pico\\runtime.py", "pico/../runtime.py", "./runtime.py"):
            with self.subTest(path=unsafe):
                original = self.manifest["files"][1]["path"]
                self.manifest["files"][1]["path"] = unsafe
                self.save_metadata()
                self.assertRejected("invalid or repeated source path")
                self.manifest["files"][1]["path"] = original

    def test_development_commit_mismatch_is_rejected(self):
        self.changes["development_commit"] = "c" * 40
        self.save_metadata()
        self.assertRejected("does not bind the baseline and development commit")

    def test_upstream_identity_change_is_rejected(self):
        self.manifest["source_commit"] = "c" * 40
        self.save_metadata()
        self.assertRejected("upstream metadata mismatch")

    def test_modified_source_cannot_claim_immutable_metadata(self):
        self.manifest["source_modified"] = False
        self.save_metadata()
        self.assertRejected("source_modified=true")

    def test_original_license_must_remain_unchanged_even_if_change_is_registered(self):
        original = copy.deepcopy(self.manifest["files"][0])
        self.write_source("LICENSE", b"Replacement attribution\n")
        self.git("add", "projects/oriel/source/LICENSE")
        self.refresh_records()
        self.changes["changes"].insert(0, {"path": "LICENSE", "status": "modified", "before": original,
                                           "after": copy.deepcopy(self.manifest["files"][0])})
        self.save_metadata()
        self.assertRejected("Original license or attribution was changed or removed")

    def test_legacy_schema_one_still_requires_exact_anchored_bytes(self):
        (self.source / "tests/regression.py").unlink()
        for name, data in self.base_files.items():
            self.write_source(name, data)
        self.git("add", "--all", "projects/oriel/source")
        (self.project / "SOURCE_MANIFEST.json").write_bytes(self.baseline_bytes)
        self.assertEqual([], self.verify())
        (self.project / "SOURCE_MANIFEST.json").write_bytes(self.baseline_bytes + b"\n")
        self.assertRejected("differs from the anchored baseline")

    def test_duplicate_json_keys_fail_closed(self):
        path = self.project / "SOURCE_MANIFEST.json"
        path.write_text('{"schema": 2, "schema": 1}', encoding="utf-8")
        self.assertRejected("Repeated JSON key")


if __name__ == "__main__":
    unittest.main()

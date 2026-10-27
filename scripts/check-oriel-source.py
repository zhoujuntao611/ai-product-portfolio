"""Verify Oriel source bytes, Git index, and changes against an anchored baseline."""

from datetime import date
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BASELINE_SHA256 = "c21e3fffbe87eef73eb98bb2e6d38740b60c8990a006eb49e54df83249108dda"
BASELINE_FILE_COUNT = 1197
UPSTREAM_REPOSITORY = "https://gitee.com/htxoffical/pico-harness.git"
UPSTREAM_BRANCH = "release/maintainer-profile"
UPSTREAM_COMMIT = "afdd62099b900a3c046dd96396268b7a8403d9c4"
BASELINE_NAME = "SOURCE_BASELINE_MANIFEST.json"
CHANGES_NAME = "SOURCE_CHANGES.json"
SOURCE_PREFIX = "projects/oriel/source/"
REQUIRED_FILES = frozenset({
    "LICENSE", "NOTICES.md", "LICENSES/MIT-nanobot.txt", "LICENSES/MIT-hermes-agent.txt",
    "LICENSES/MIT-ink.txt", "pyproject.toml", "uv.lock", "pico/maintenance/runner.py",
    "tests/test_maintenance.py", "benchmarks/picobench/artifacts.py",
})
RECORD_FIELDS = {"path", "mode", "git_blob", "bytes", "sha256"}
MANIFEST_FIELDS = {
    "schema", "source_repository", "source_branch", "source_commit", "snapshot_date",
    "source_modified", "file_count", "total_bytes", "files",
}


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Repeated JSON key: {key}")
        result[key] = value
    return result


def _read_json(path, errors):
    try:
        data = path.read_bytes()
        result = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object)
        if not isinstance(result, dict):
            raise ValueError("Top-level JSON value must be an object")
        return result, data
    except (OSError, UnicodeError, ValueError) as exc:
        errors.append(f"Cannot read {path.name}: {exc}")
        return {}, b""


def _safe_name(name):
    if not isinstance(name, str) or not name or "\\" in name or ":" in name:
        return False
    if any(ord(character) < 32 for character in name):
        return False
    parts = name.split("/")
    return (
        not PurePosixPath(name).is_absolute()
        and all(part not in {"", ".", "..", ".git"} and not part.endswith((" ", ".")) for part in parts)
        and PurePosixPath(name).as_posix() == name
    )


def _records(manifest, label, errors):
    records = manifest.get("files")
    if not isinstance(records, list):
        errors.append(f"{label}: files must be an array")
        return {}
    indexed = {}
    for record in records:
        if not isinstance(record, dict) or set(record) != RECORD_FIELDS:
            errors.append(f"{label}: invalid file record")
            continue
        name = record["path"]
        if not _safe_name(name) or name in indexed:
            errors.append(f"{label}: invalid or repeated source path: {name!r}")
            continue
        if (
            not isinstance(record["mode"], str) or record["mode"] not in {"100644", "100755"}
            or not isinstance(record["git_blob"], str)
            or re.fullmatch(r"[0-9a-f]{40}", record["git_blob"]) is None
            or type(record["bytes"]) is not int or record["bytes"] < 0
            or not isinstance(record["sha256"], str)
            or re.fullmatch(r"[0-9a-f]{64}", record["sha256"]) is None
        ):
            errors.append(f"{label}: invalid metadata for {name}")
            continue
        indexed[name] = record
    if list(indexed) != sorted(indexed):
        errors.append(f"{label}: file records must be sorted by path")
    if (
        type(manifest.get("file_count")) is not int
        or manifest["file_count"] != len(records)
        or len(indexed) != len(records)
        or type(manifest.get("total_bytes")) is not int
        or manifest["total_bytes"] != sum(record["bytes"] for record in indexed.values())
    ):
        errors.append(f"{label}: file count or total bytes mismatch")
    return indexed


def _upstream_metadata(manifest, label, errors):
    expected = {
        "source_repository": UPSTREAM_REPOSITORY,
        "source_branch": UPSTREAM_BRANCH,
        "source_commit": UPSTREAM_COMMIT,
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            errors.append(f"{label}: upstream metadata mismatch: {key}")


def _verify_index(root, records, errors):
    try:
        entries = subprocess.check_output(
            ["git", "ls-files", "--stage", "-z", "--", SOURCE_PREFIX.rstrip("/")],
            cwd=root, stderr=subprocess.PIPE,
        )
        indexed = {}
        for entry in entries.rstrip(b"\0").split(b"\0"):
            if not entry:
                continue
            meta, raw_name = entry.split(b"\t", 1)
            name = raw_name.decode("utf-8")
            mode, blob, stage = meta.decode("ascii").split()
            if not name.startswith(SOURCE_PREFIX) or stage != "0":
                errors.append("Git index contains an unexpected path or unresolved merge")
                continue
            name = name[len(SOURCE_PREFIX):]
            if name in indexed:
                errors.append(f"Repeated source index entry: {name}")
            indexed[name] = (mode, blob)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        errors.append(f"Cannot inspect source Git index: {exc}")
        return
    if set(indexed) != set(records):
        errors.append("Indexed source file set differs from manifest (stage all snapshot files)")
    for name, record in records.items():
        if indexed.get(name) != (record["mode"], record["git_blob"]):
            errors.append(f"Indexed blob or executable mode mismatch: {name}")


def verify_source(root=ROOT, *, baseline_sha256=BASELINE_SHA256,
                  baseline_file_count=BASELINE_FILE_COUNT, required_files=REQUIRED_FILES):
    """Return validation errors; injectable anchors are only for isolated test fixtures."""
    root = Path(root).resolve()
    project = root / "projects/oriel"
    source = project / "source"
    errors = []
    manifest, manifest_bytes = _read_json(project / "SOURCE_MANIFEST.json", errors)
    records = _records(manifest, "Current manifest", errors)
    _upstream_metadata(manifest, "Current manifest", errors)
    schema = manifest.get("schema")
    if type(schema) is not int or schema not in {1, 2}:
        errors.append("Unsupported source manifest schema")
    if schema == 1:
        if hashlib.sha256(manifest_bytes).hexdigest() != baseline_sha256:
            errors.append("Legacy source manifest differs from the anchored baseline")
        if set(manifest) != MANIFEST_FIELDS or manifest.get("source_modified") is not False:
            errors.append("Invalid legacy snapshot metadata")
        if manifest.get("file_count") != baseline_file_count:
            errors.append("Legacy baseline file count mismatch")
    elif schema == 2:
        if set(manifest) != MANIFEST_FIELDS | {"development_commit", "baseline_manifest", "changes_manifest"}:
            errors.append("Current manifest has missing or unexpected fields")
        if manifest.get("source_modified") is not True:
            errors.append("Modified source must be identified as source_modified=true")
        if manifest.get("baseline_manifest") != BASELINE_NAME or manifest.get("changes_manifest") != CHANGES_NAME:
            errors.append("Current manifest must reference the fixed baseline and changes filenames")
        commit = manifest.get("development_commit")
        if not isinstance(commit, str) or re.fullmatch(r"[0-9a-f]{40}", commit) is None or commit == UPSTREAM_COMMIT:
            errors.append("Invalid development commit for modified source")
        baseline, baseline_bytes = _read_json(project / BASELINE_NAME, errors)
        actual_baseline_sha256 = hashlib.sha256(baseline_bytes).hexdigest()
        if actual_baseline_sha256 != baseline_sha256:
            errors.append("Baseline manifest SHA-256 differs from the trusted anchor")
        baseline_records = _records(baseline, "Baseline manifest", errors)
        _upstream_metadata(baseline, "Baseline manifest", errors)
        if (
            type(baseline.get("schema")) is not int or baseline.get("schema") != 1
            or set(baseline) != MANIFEST_FIELDS
            or baseline.get("source_modified") is not False
            or baseline.get("file_count") != baseline_file_count
        ):
            errors.append("Invalid immutable baseline metadata or file count")
        try:
            snapshot_date = date.fromisoformat(manifest["snapshot_date"])
            baseline_date = date.fromisoformat(baseline["snapshot_date"])
            if snapshot_date.isoformat() != manifest["snapshot_date"] or snapshot_date < baseline_date:
                raise ValueError("Snapshot date precedes baseline or is not canonical ISO format")
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(f"Invalid snapshot date: {exc}")
        changes, _ = _read_json(project / CHANGES_NAME, errors)
        if (
            set(changes) != {"schema", "upstream_base_commit", "development_commit", "baseline_manifest_sha256", "changes"}
            or type(changes.get("schema")) is not int or changes.get("schema") != 1
            or changes.get("upstream_base_commit") != UPSTREAM_COMMIT
            or changes.get("development_commit") != commit
            or changes.get("baseline_manifest_sha256") != baseline_sha256
        ):
            errors.append("Changes manifest metadata does not bind the baseline and development commit")
        expected_changes = []
        for name in sorted(set(baseline_records) | set(records)):
            before, after = baseline_records.get(name), records.get(name)
            if before != after:
                expected_changes.append({
                    "path": name,
                    "status": "added" if before is None else "deleted" if after is None else "modified",
                    "before": before,
                    "after": after,
                })
        # JSON identity also distinguishes true from 1 and 1.0 from 1, unlike
        # Python dictionary equality. Before/after records must be exact.
        declared_changes = json.dumps(changes.get("changes"), sort_keys=True)
        exact_changes = json.dumps(expected_changes, sort_keys=True)
        if not expected_changes or declared_changes != exact_changes:
            errors.append("Declared source changes differ from the exact baseline/current manifest difference")
        for name, original in baseline_records.items():
            if name in {"LICENSE", "NOTICES.md"} or name.startswith("LICENSES/"):
                if records.get(name) != original:
                    errors.append(f"Original license or attribution was changed or removed: {name}")

    if not set(required_files).issubset(records):
        errors.append("Required source or license files are missing from manifest")
    source_resolved = source.resolve()
    symlink_directories = {}
    for name, record in records.items():
        path = source / name
        try:
            if not path.resolve().is_relative_to(source_resolved):
                errors.append(f"Source path escapes its root: {name}")
                continue
            parents = []
            parent = path.parent
            while parent != project:
                if parent not in symlink_directories:
                    symlink_directories[parent] = parent.is_symlink()
                parents.append(parent)
                parent = parent.parent
            if path.is_symlink() or any(symlink_directories[parent] for parent in parents):
                errors.append(f"Source path must not contain symlinks: {name}")
                continue
            data = path.read_bytes()
        except OSError as exc:
            errors.append(f"Cannot read source file {name}: {exc}")
            continue
        blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if len(data) != record["bytes"] or hashlib.sha256(data).hexdigest() != record["sha256"] or blob != record["git_blob"]:
            errors.append(f"Source bytes changed: {name}")
    _verify_index(root, records, errors)
    return errors


def main():
    errors = verify_source()
    for error in errors:
        print(error, file=sys.stderr)
    manifest, _ = _read_json(ROOT / "projects/oriel/SOURCE_MANIFEST.json", [])
    print(f"Oriel source: {manifest.get('file_count', '?')} files, "
          f"{manifest.get('total_bytes', '?')} bytes; {len(errors)} failures.")
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())

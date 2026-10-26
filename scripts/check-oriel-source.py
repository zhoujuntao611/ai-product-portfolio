"""Verify the immutable, attributed Oriel/Pico source snapshot offline."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "projects/oriel"
SOURCE = PROJECT / "source"


def main():
    manifest = json.loads((PROJECT / "SOURCE_MANIFEST.json").read_text(encoding="utf-8"))
    records = manifest["files"]
    errors = []
    names = set()
    total = 0
    for record in records:
        name = record["path"]
        path = SOURCE / name
        if name in names or not path.resolve().is_relative_to(SOURCE.resolve()):
            errors.append(f"Invalid or repeated source path: {name}")
            continue
        names.add(name)
        if not path.is_file():
            errors.append(f"Missing source file: {name}")
            continue
        data = path.read_bytes()
        total += len(data)
        blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if (len(data) != record["bytes"] or hashlib.sha256(data).hexdigest() != record["sha256"]
                or blob != record["git_blob"]):
            errors.append(f"Source bytes changed: {name}")
    required = {"LICENSE", "NOTICES.md", "LICENSES/MIT-nanobot.txt", "LICENSES/MIT-hermes-agent.txt",
                "LICENSES/MIT-ink.txt", "pyproject.toml", "uv.lock", "pico/maintenance/runner.py",
                "tests/test_maintenance.py", "benchmarks/picobench/artifacts.py"}
    if not required.issubset(names):
        errors.append("Required source or license files are missing from manifest")
    if len(records) != 1197 or manifest["file_count"] != len(records) or total != manifest["total_bytes"]:
        errors.append("Snapshot file count or total bytes mismatch")
    # The index also checks executable modes that cannot be represented by Windows permissions.
    entries = subprocess.check_output(["git", "ls-files", "--stage", "-z", "projects/oriel/source"], cwd=ROOT)
    indexed = {}
    for entry in entries.rstrip(b"\0").split(b"\0"):
        if not entry:
            continue
        meta, path = entry.split(b"\t", 1)
        indexed[path.decode("utf-8").removeprefix("projects/oriel/source/")] = meta.decode().split()[:2]
    if set(indexed) != names:
        errors.append("Indexed source file set differs from manifest (stage all snapshot files)")
    for record in records:
        if indexed.get(record["path"]) != [record["mode"], record["git_blob"]]:
            errors.append(f"Indexed blob or executable mode mismatch: {record['path']}")
    for error in errors:
        print(error, file=sys.stderr)
    print(f"Oriel source: {len(records)} files, {total} bytes; {len(errors)} failures.")
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())

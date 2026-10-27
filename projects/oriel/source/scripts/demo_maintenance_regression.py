"""Run credential-free, real-Git examples of the maintenance regression gate.

The deterministic editor is a fixture, not a model. On Windows the demo adapter
executes only its own Python check argv directly; the production runner still
requires a POSIX shell. No existing repository or remote service is modified.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Support direct invocation from a checkout without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pico.maintenance.models import MaintenanceJob, MaintenanceState
from pico.maintenance.runner import GitMaintenanceRunner


class DemoRunner(GitMaintenanceRunner):
    async def _run_exec(self, argv, **kwargs):
        if os.name == "nt" and tuple(argv[:2]) == ("/bin/sh", "-lc"):
            # All checks below are a fixed Python executable plus a literal -c
            # program. This deliberately does not emulate a general shell.
            argv = shlex.split(argv[2])
            if len(argv) != 3 or argv[:2] != [sys.executable, "-c"]:
                raise ValueError("The Windows demo adapter accepts only its fixed Python checks")
        return await super()._run_exec(argv, **kwargs)


def python_check(program: str) -> str:
    return " ".join(shlex.quote(part) for part in (sys.executable, "-c", program))


def git(repository: Path, *args: str) -> str:
    executable = shutil.which("git")
    if executable is None:
        raise RuntimeError("Git is required for the offline demo")
    return subprocess.run(
        [executable, *args], cwd=repository, check=True, capture_output=True, text=True, encoding="utf-8"
    ).stdout.strip()


async def run_scenario(root: Path, name: str) -> dict:
    scenario_dir = root / name
    repository = scenario_dir / "repository"
    repository.mkdir(parents=True)
    git(repository, "init", "-b", "main")
    git(repository, "config", "user.name", "Oriel Offline Demo")
    git(repository, "config", "user.email", "offline-demo@example.invalid")
    initial_operator = "+" if name == "already_green" else "-"
    (repository / "calculator.py").write_text(
        f"def total(a, b):\n    return a {initial_operator} b\n", encoding="utf-8"
    )
    git(repository, "add", "calculator.py")
    git(repository, "commit", "-m", "test: seed offline regression example")
    base_commit = git(repository, "rev-parse", "HEAD")
    agent_calls = 0

    def agent_command(_job, _worktree):
        nonlocal agent_calls
        agent_calls += 1
        if name == "unrelated_change":
            program = "from pathlib import Path; Path('notes.txt').write_text('unrelated change\\n')"
        else:
            program = (
                "from pathlib import Path; Path('calculator.py').write_text('def total(a, b):\\n    return a + b\\n')"
            )
        return [sys.executable, "-c", program]

    # The broad acceptance check passes even in the broken base. The targeted
    # probe demonstrates why acceptance alone does not prove this bug was fixed.
    acceptance = python_check("from calculator import total; assert total(0, 0) == 0")
    probe = "from calculator import total; assert total(2, 3) == 5"
    if name == "probe_error":
        probe = "raise SystemExit(2)"
    elif name == "clean_verifier_failure":
        probe += "; import os; assert os.environ['PICO_MAINTENANCE_PHASE'] != 'verify'"
    runner = DemoRunner(
        repository=repository,
        base_ref="main",
        state_dir=scenario_dir / "state",
        acceptance_commands=[acceptance],
        regression_commands=[python_check(probe)],
        agent_command=agent_command,
        agent_timeout_seconds=30,
        command_timeout_seconds=30,
    )
    stages: list[str] = []

    async def progress(stage):
        stages.append(stage)

    outcome = await runner.run(
        MaintenanceJob(f"pm_{name}", f"om_{name}", "#1", "demo", "demo", issue_summary=name), progress
    )
    if outcome.candidate_dir is None:
        raise RuntimeError("Runner did not retain candidate evidence")
    manifest = json.loads((outcome.candidate_dir / "manifest.json").read_text(encoding="utf-8"))
    expected = {
        "correct_fix": (MaintenanceState.CANDIDATE_READY, "verified", 1),
        "unrelated_change": (MaintenanceState.VERIFICATION_FAILED, "repair_failed", 1),
        "already_green": (MaintenanceState.BLOCKED, "baseline_not_reproduced", 0),
        "probe_error": (MaintenanceState.BLOCKED, "baseline_error", 0),
        "clean_verifier_failure": (MaintenanceState.VERIFICATION_FAILED, "verification_failed", 1),
    }[name]
    actual = (outcome.state, manifest["regression_evidence"]["status"], agent_calls)
    original_unchanged = git(repository, "rev-parse", "HEAD") == base_commit and not git(
        repository, "status", "--porcelain"
    )
    worktrees_cleaned = not (scenario_dir / "state" / "runs" / f"pm_{name}").exists()
    return {
        "scenario": name,
        "state": outcome.state.value,
        "regression_status": manifest["regression_evidence"]["status"],
        "exit_codes": {
            label: [check["exit_code"] for check in manifest[key]]
            for label, key in (
                ("baseline", "baseline_regression_checks"),
                ("repair", "repair_regression_checks"),
                ("verify", "verification_regression_checks"),
            )
        },
        "agent_calls": agent_calls,
        "original_repository_unchanged": original_unchanged,
        "worktrees_cleaned": worktrees_cleaned,
        "expectation_passed": actual == expected and original_unchanged and worktrees_cleaned,
        "stages": stages,
        "candidate": str(outcome.candidate_dir.relative_to(root)),
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(".pico/evidence/maintenance-regression"))
    options = parser.parse_args()
    parent = options.output.resolve()
    parent.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix="run-", dir=parent))
    results = []
    for name in ("correct_fix", "unrelated_change", "already_green", "probe_error", "clean_verifier_failure"):
        result = await run_scenario(root, name)
        results.append(result)
        print(f"{name}: {result['state']} / {result['regression_status']} / expected={result['expectation_passed']}")
    report = {
        "schema": "oriel.maintenance.regression-demo.v1",
        "scope": "Synthetic deterministic editor; real Git worktrees, patch replay, Python checks; no model or remote service",
        "platform": sys.platform,
        "windows_check_adapter": os.name == "nt",
        "results": results,
        "all_expectations_passed": all(result["expectation_passed"] for result in results),
    }
    report_path = root / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Report: {report_path}")
    return 0 if report["all_expectations_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

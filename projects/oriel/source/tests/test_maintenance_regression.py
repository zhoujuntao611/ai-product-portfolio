"""Exercise red/green evidence with real Git worktrees and local Python checks.

The production runner retains its POSIX shell contract. These tests replace
only shell parsing, so the same Git/process/patch checks also run on Windows.
No model, messaging service, or external repository is contacted.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from pico.config.pico import MaintenanceConfig, PicoConfig
from pico.maintenance.factory import build_maintenance_coordinator
from pico.maintenance.models import MaintenanceJob, MaintenanceState
from pico.maintenance.runner import GitMaintenanceRunner


def _git(repository: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(repository), *args], text=True).strip()


@pytest.fixture
def repository(tmp_path: Path) -> Path:
    path = tmp_path / "repo"
    path.mkdir()
    _git(path, "init", "-b", "main")
    _git(path, "config", "user.email", "maintenance-test@example.invalid")
    _git(path, "config", "user.name", "Maintenance Test")
    (path / "behavior.txt").write_text("broken\n", encoding="utf-8")
    _git(path, "add", ".")
    _git(path, "commit", "-m", "test: seed broken behavior")
    return path


def _command(script: str) -> str:
    return f"{shlex.quote(sys.executable)} -c {shlex.quote(script)}"


_PASS = _command("raise SystemExit(0)")
_REGRESSION = _command(
    "from pathlib import Path; raise SystemExit(0 if Path('behavior.txt').read_text().strip() == 'fixed' else 1)"
)


class _PortableRunner(GitMaintenanceRunner):
    async def _run_exec(self, argv, **kwargs):
        if os.name == "nt" and argv[0] == "/bin/sh":
            argv = tuple(shlex.split(argv[2]))
        return await super()._run_exec(argv, **kwargs)


def _runner(repository: Path, tmp_path: Path, *, regressions=(_REGRESSION,), acceptance=(_PASS,), fix=True):
    calls: list[Path] = []

    def agent(_job, worktree):
        calls.append(worktree)
        value = "fixed\n" if fix else "still broken\n"
        script = f"from pathlib import Path; Path('behavior.txt').write_text({value!r})"
        return [sys.executable, "-c", script]

    runner = _PortableRunner(
        repository=repository,
        base_ref="main",
        state_dir=tmp_path / "state",
        acceptance_commands=acceptance,
        regression_commands=regressions,
        agent_command=agent,
        agent_timeout_seconds=10,
        command_timeout_seconds=1,
    )
    return runner, calls


async def _run(runner):
    outcome = await runner.run(MaintenanceJob("pm_regression", "om_1", "#1", "chat", "maintainer"))
    manifest = json.loads((outcome.candidate_dir / "manifest.json").read_text(encoding="utf-8"))
    return outcome, manifest


async def test_real_red_green_records_all_three_phases_and_removes_worktrees(repository, tmp_path):
    runner, calls = _runner(repository, tmp_path)
    outcome, manifest = await _run(runner)

    assert outcome.state is MaintenanceState.CANDIDATE_READY
    assert len(calls) == 1
    assert manifest["schema"] == "pico.maintenance.candidate.v2"
    assert manifest["regression_evidence"]["mode"] == "red_green"
    assert manifest["regression_evidence"]["status"] == "verified"
    assert manifest["checks_source_unchanged"] == {"repair": True, "verify": True}
    for key, code, phase in (
        ("baseline_regression_checks", 1, "baseline"),
        ("repair_regression_checks", 0, "repair"),
        ("verification_regression_checks", 0, "verify"),
    ):
        assert manifest[key][0]["exit_code"] == code
        assert manifest[key][0]["log"] == f"{phase}-regression-check-1.log"
        assert (outcome.candidate_dir / manifest[key][0]["log"]).is_file()
    report = (outcome.candidate_dir / "CANDIDATE.md").read_text(encoding="utf-8")
    assert "Baseline exit: `1`; Repair exit: `0`; Verifier exit: `0`" in report
    assert len(_git(repository, "worktree", "list", "--porcelain").split("worktree ")) == 2
    assert not (tmp_path / "state" / "runs" / "pm_regression").exists()
    assert (repository / "behavior.txt").read_text(encoding="utf-8") == "broken\n"


async def test_baseline_already_green_blocks_before_agent(repository, tmp_path):
    runner, calls = _runner(repository, tmp_path, regressions=(_PASS,))
    outcome, manifest = await _run(runner)

    assert outcome.state is MaintenanceState.BLOCKED
    assert manifest["regression_evidence"]["status"] == "baseline_not_reproduced"
    assert calls == []
    assert "agent_exit_code" not in manifest
    assert not (outcome.candidate_dir / "candidate.patch").exists()


@pytest.mark.parametrize("code", [2, 5, 127])
async def test_baseline_execution_errors_are_not_reproduction(repository, tmp_path, code):
    runner, calls = _runner(repository, tmp_path, regressions=(_command(f"raise SystemExit({code})"),))
    outcome, manifest = await _run(runner)

    assert outcome.state is MaintenanceState.BLOCKED
    assert manifest["regression_evidence"]["status"] == "baseline_error"
    assert manifest["baseline_regression_checks"][0]["exit_code"] == code
    assert calls == []


async def test_baseline_timeout_is_not_reproduction(repository, tmp_path):
    runner, calls = _runner(repository, tmp_path, regressions=(_command("import time; time.sleep(30)"),))
    outcome, manifest = await _run(runner)

    assert outcome.state is MaintenanceState.BLOCKED
    assert manifest["baseline_regression_checks"][0]["exit_code"] == -1
    assert manifest["regression_evidence"]["status"] == "baseline_error"
    assert calls == []


async def test_every_baseline_command_must_reproduce(repository, tmp_path):
    runner, calls = _runner(repository, tmp_path, regressions=(_REGRESSION, _PASS))
    outcome, manifest = await _run(runner)

    assert outcome.state is MaintenanceState.BLOCKED
    assert [item["exit_code"] for item in manifest["baseline_regression_checks"]] == [1, 0]
    assert calls == []


async def test_missing_baseline_receipts_cannot_count_as_reproduction(repository, tmp_path, monkeypatch):
    runner, calls = _runner(repository, tmp_path)

    async def missing_receipts(*_args, **_kwargs):
        return []

    monkeypatch.setattr(runner, "_run_regression_checks", missing_receipts)
    outcome, manifest = await _run(runner)
    assert outcome.state is MaintenanceState.BLOCKED
    assert manifest["regression_evidence"]["status"] == "baseline_error"
    assert calls == []


async def test_patch_that_leaves_regression_failing_is_rejected(repository, tmp_path):
    runner, _ = _runner(repository, tmp_path, fix=False)
    outcome, manifest = await _run(runner)

    assert outcome.state is MaintenanceState.VERIFICATION_FAILED
    assert manifest["repair_checks"][0]["exit_code"] == 0
    assert manifest["repair_regression_checks"][0]["exit_code"] == 1
    assert manifest["verification_regression_checks"] == []
    assert manifest["regression_evidence"]["status"] == "repair_failed"


async def test_clean_verifier_must_pass_the_same_regression(repository, tmp_path):
    regression = _command("import os; raise SystemExit(0 if os.environ['PICO_MAINTENANCE_PHASE'] == 'repair' else 1)")
    runner, _ = _runner(repository, tmp_path, regressions=(regression,))
    outcome, manifest = await _run(runner)

    assert outcome.state is MaintenanceState.VERIFICATION_FAILED
    assert manifest["repair_regression_checks"][0]["exit_code"] == 0
    assert manifest["verification_checks"][0]["exit_code"] == 0
    assert manifest["verification_regression_checks"][0]["exit_code"] == 1
    assert manifest["regression_evidence"]["status"] == "verification_failed"


async def test_regression_success_does_not_override_failing_acceptance(repository, tmp_path):
    runner, _ = _runner(repository, tmp_path, acceptance=(_command("raise SystemExit(2)"),))
    outcome, manifest = await _run(runner)

    assert outcome.state is MaintenanceState.VERIFICATION_FAILED
    assert manifest["repair_regression_checks"][0]["exit_code"] == 0
    assert manifest["repair_checks"][0]["exit_code"] == 2


async def test_baseline_artifacts_do_not_leak_into_repair_or_verifier(repository, tmp_path):
    script = (
        "import os; from pathlib import Path; "
        "baseline = os.environ['PICO_MAINTENANCE_PHASE'] == 'baseline'; "
        "Path('baseline-only.txt').write_text('baseline') if baseline else None; "
        "raise SystemExit(1 if baseline or Path('baseline-only.txt').exists() else 0)"
    )
    runner, _ = _runner(repository, tmp_path, regressions=(_command(script),))
    outcome, _ = await _run(runner)

    assert outcome.state is MaintenanceState.CANDIDATE_READY
    assert outcome.changed_files == ("behavior.txt",)


async def test_legacy_acceptance_only_reports_reproduction_not_verified(repository, tmp_path):
    runner, _ = _runner(repository, tmp_path, regressions=())
    stages = []

    async def progress(stage):
        stages.append(stage)

    outcome = await runner.run(MaintenanceJob("pm_legacy", "om_legacy", "#1", "chat", "maintainer"), progress)
    manifest = json.loads((outcome.candidate_dir / "manifest.json").read_text(encoding="utf-8"))
    assert outcome.state is MaintenanceState.CANDIDATE_READY
    assert manifest["regression_evidence"]["mode"] == "acceptance_only"
    assert manifest["regression_evidence"]["status"] == "not_configured"
    assert manifest["baseline_regression_checks"] == []
    assert "reproduction was not verified" in (outcome.candidate_dir / "CANDIDATE.md").read_text(encoding="utf-8")
    assert stages == ["base locked", "reproducing and editing", "repair checks", "clean verification"]


@pytest.mark.parametrize("commands", [[], [""], [" \n "], [_PASS, " "]])
def test_runner_rejects_empty_acceptance_commands(repository, tmp_path, commands):
    with pytest.raises(ValueError, match="acceptance commands are required"):
        _runner(repository, tmp_path, acceptance=commands)


@pytest.mark.parametrize(
    "field, value",
    [
        ("acceptanceCommands", [" "]),
        ("regressionCommands", ["\n"]),
        ("regressionCommands", ["true", ""]),
    ],
)
def test_config_rejects_empty_check_commands(field, value):
    with pytest.raises(ValidationError, match="check commands must be non-empty"):
        MaintenanceConfig.model_validate({field: value})


def test_default_disabled_configuration_round_trips_with_empty_command_arrays():
    config = PicoConfig()
    restored = PicoConfig.model_validate(config.model_dump())
    assert restored.maintenance.enabled is False
    assert restored.maintenance.acceptance_commands == []
    assert restored.maintenance.regression_commands == []


def test_enabled_factory_rejects_empty_acceptance_after_configuration_round_trip(repository, tmp_path):
    runner_config = tmp_path / "runner.json"
    runner_config.write_text("{}", encoding="utf-8")
    config = MaintenanceConfig(
        enabled=True,
        repository=str(repository),
        allowed_chats=["chat"],
        maintainers=["maintainer"],
        runner_config=str(runner_config),
        acceptance_commands=[],
    )
    config = MaintenanceConfig.model_validate(config.model_dump())
    with pytest.raises(ValueError, match="acceptanceCommands"):
        build_maintenance_coordinator(config, workspace=repository, state_dir=tmp_path / "factory-state")


async def test_camel_case_config_and_factory_preserve_regression_contract(repository, tmp_path):
    runner_config = tmp_path / "runner.json"
    runner_config.write_text("{}", encoding="utf-8")
    config = MaintenanceConfig.model_validate(
        {
            "enabled": True,
            "repository": str(repository),
            "baseRef": "main",
            "allowedChats": ["chat"],
            "maintainers": ["maintainer"],
            "acceptanceCommands": [" true "],
            "regressionCommands": [" test -f fixed.txt "],
            "runnerConfig": str(runner_config),
        }
    )
    coordinator = build_maintenance_coordinator(config, workspace=repository, state_dir=tmp_path / "factory-state")
    try:
        assert coordinator.runner.acceptance_commands == ("true",)
        assert coordinator.runner.regression_commands == ("test -f fixed.txt",)
    finally:
        await coordinator.close()


async def test_acceptance_auto_fix_cannot_validate_an_unfixed_exported_patch(repository, tmp_path):
    acceptance = _command("from pathlib import Path; Path('behavior.txt').write_text('fixed\\n')")
    runner, _ = _runner(repository, tmp_path, acceptance=(acceptance,), fix=False)
    outcome, manifest = await _run(runner)

    # The regression passed only because acceptance changed the worktree after
    # export. The retained patch still contains the unfixed implementation.
    assert manifest["baseline_regression_checks"][0]["exit_code"] == 1
    assert manifest["repair_regression_checks"][0]["exit_code"] == 0
    assert "+still broken" in (outcome.candidate_dir / "candidate.patch").read_text(encoding="utf-8")
    assert outcome.state is MaintenanceState.VERIFICATION_FAILED
    assert manifest["checks_source_unchanged"] == {"repair": False, "verify": None}
    assert manifest["regression_evidence"]["status"] == "repair_failed"
    assert "modified candidate source files" in outcome.detail


@pytest.mark.parametrize("phase", ["repair", "verify"])
@pytest.mark.parametrize("target", ["behavior.txt", "candidate.txt", "other-tracked.txt"])
async def test_checks_cannot_modify_existing_added_or_other_tracked_source(repository, tmp_path, phase, target):
    (repository / "other-tracked.txt").write_text("original\n", encoding="utf-8")
    _git(repository, "add", "other-tracked.txt")
    _git(repository, "commit", "-m", "test: add an unchanged tracked file")
    mutation = _command(
        "import os; from pathlib import Path; "
        f"Path({target!r}).write_text('changed by checks\\n') "
        f"if os.environ['PICO_MAINTENANCE_PHASE'] == {phase!r} else None"
    )
    runner, _ = _runner(repository, tmp_path, acceptance=(mutation,))
    runner.agent_command = lambda _job, _tree: [
        sys.executable,
        "-c",
        "from pathlib import Path; Path('behavior.txt').write_text('fixed\\n'); "
        "Path('candidate.txt').write_text('candidate content\\n')",
    ]
    outcome, manifest = await _run(runner)

    assert outcome.state is MaintenanceState.VERIFICATION_FAILED
    assert manifest["checks_source_unchanged"][phase] is False
    if phase == "verify":
        assert manifest["apply_exit_code"] == 0
        assert manifest["checks_source_unchanged"]["repair"] is True
        assert manifest["regression_evidence"]["status"] == "verification_failed"
    else:
        assert manifest["checks_source_unchanged"]["verify"] is None
    if target == "other-tracked.txt":
        assert target not in outcome.changed_files
    assert "modified candidate source files" in outcome.detail


async def test_candidate_additions_and_untracked_check_caches_are_supported(repository, tmp_path):
    cache = _command("from pathlib import Path; Path('untracked-check-cache.txt').write_text('cache\\n')")
    runner, _ = _runner(repository, tmp_path, acceptance=(cache,))
    runner.agent_command = lambda _job, _tree: [
        sys.executable,
        "-c",
        "from pathlib import Path; Path('behavior.txt').write_text('fixed\\n'); "
        "Path('candidate.txt').write_text('candidate content\\n')",
    ]
    outcome, manifest = await _run(runner)

    assert outcome.state is MaintenanceState.CANDIDATE_READY
    assert manifest["checks_source_unchanged"] == {"repair": True, "verify": True}
    assert "candidate.txt" in outcome.changed_files
    assert "untracked-check-cache.txt" not in outcome.changed_files
    assert "source still matches candidate patch: `true`" in (outcome.candidate_dir / "CANDIDATE.md").read_text(
        encoding="utf-8"
    )


async def test_agent_committed_fix_is_exported_relative_to_the_locked_base(repository, tmp_path):
    runner, _ = _runner(repository, tmp_path)
    runner.agent_command = lambda _job, _tree: [
        sys.executable,
        "-c",
        "from pathlib import Path; import subprocess; "
        "Path('behavior.txt').write_text('fixed\\n'); "
        "subprocess.run(['git', 'add', 'behavior.txt'], check=True); "
        "subprocess.run(['git', 'commit', '-m', 'fix: committed by repair fixture'], check=True)",
    ]
    outcome, manifest = await _run(runner)

    assert outcome.state is MaintenanceState.CANDIDATE_READY
    assert outcome.base_commit == _git(repository, "rev-parse", "main")
    assert outcome.changed_files == ("behavior.txt",)
    assert "+fixed" in (outcome.candidate_dir / "candidate.patch").read_text(encoding="utf-8")
    assert manifest["checks_source_unchanged"] == {"repair": True, "verify": True}
    assert manifest["verification_regression_checks"][0]["exit_code"] == 0


async def test_verifier_check_commit_cannot_hide_source_changes_by_moving_head(repository, tmp_path):
    (repository / "other-tracked.txt").write_text("original\n", encoding="utf-8")
    _git(repository, "add", "other-tracked.txt")
    _git(repository, "commit", "-m", "test: add unchanged tracked file")
    mutation = _command(
        "import os, subprocess\n"
        "from pathlib import Path\n"
        "if os.environ['PICO_MAINTENANCE_PHASE'] == 'verify':\n"
        "    Path('other-tracked.txt').write_text('committed by checks\\n')\n"
        "    subprocess.run(['git', 'commit', '--only', '-m', 'check mutation', '--', 'other-tracked.txt'], check=True)\n"
    )
    runner, _ = _runner(repository, tmp_path, acceptance=(mutation,))
    outcome, manifest = await _run(runner)

    # --only commits the unrelated mutation while keeping the applied candidate
    # in the index. A comparison with mutable HEAD would miss the committed edit.
    assert manifest["verification_checks"][0]["exit_code"] == 0
    assert manifest["verification_regression_checks"][0]["exit_code"] == 0
    assert outcome.state is MaintenanceState.VERIFICATION_FAILED
    assert manifest["checks_source_unchanged"] == {"repair": True, "verify": False}
    assert manifest["regression_evidence"]["status"] == "verification_failed"
    assert "other-tracked.txt" not in outcome.changed_files

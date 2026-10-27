from __future__ import annotations

import asyncio
import json
import os
import re
import shlex
import shutil
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from pico.maintenance.models import MaintenanceJob, MaintenanceOutcome, MaintenanceState

_ISSUE_PROPOSAL_REF = re.compile(r"pi_[0-9a-f]{12}")
_RUNTIME_ARTIFACT_ROOTS = {
    ".npm-cache",
    ".uv-cache",
    ".venv",
    "__pycache__",
    "agent_memory",
    "memory",
    "node_modules",
    "sessions",
    "telemetry",
    "user_memory",
}


@dataclass(frozen=True)
class CommandReceipt:
    command: str
    exit_code: int
    log: str


AgentCommand = Callable[[MaintenanceJob, Path], Sequence[str]]
ProgressSink = Callable[[str], Awaitable[None]]


class GitMaintenanceRunner:
    def __init__(
        self,
        *,
        repository: Path,
        base_ref: str,
        state_dir: Path,
        acceptance_commands: Sequence[str],
        agent_command: AgentCommand,
        agent_timeout_seconds: int,
        command_timeout_seconds: int,
        agent_environment: dict[str, str] | None = None,
        check_container_image: str = "",
        regression_commands: Sequence[str] = (),
    ) -> None:
        self.repository = repository.resolve()
        self.base_ref = base_ref
        self.state_dir = state_dir.resolve()
        self.acceptance_commands = self._validated_commands(acceptance_commands, required=True)
        self.regression_commands = self._validated_commands(regression_commands, required=False)
        self.agent_command = agent_command
        self.agent_timeout_seconds = agent_timeout_seconds
        self.command_timeout_seconds = command_timeout_seconds
        self.agent_environment = dict(agent_environment or {})
        self.check_container_image = check_container_image

    async def run(
        self,
        job: MaintenanceJob,
        progress: ProgressSink | None = None,
    ) -> MaintenanceOutcome:
        run_root = self.state_dir / "runs" / job.job_id
        repair = run_root / "repair"
        verify = run_root / "verify"
        baseline = run_root / "baseline"
        candidate = self.state_dir / "candidates" / job.job_id
        candidate.mkdir(parents=True, exist_ok=True)
        base_commit = await self._git_text("rev-parse", "--verify", f"{self.base_ref}^{{commit}}")
        issue_ref, issue_error = await self._validated_issue_ref(job)
        if issue_error:
            manifest = {
                "schema": "pico.maintenance.candidate.v2",
                "job_id": job.job_id,
                "issue": job.issue_ref,
                "issue_summary": job.issue_summary,
                "repository": str(self.repository),
                "base_commit": base_commit,
                "state": MaintenanceState.BLOCKED.value,
                "changed_files": [],
                "repair_checks": [],
                "verification_checks": [],
            }
            return self._finish(
                candidate,
                manifest,
                MaintenanceState.BLOCKED,
                base_commit,
                (),
                issue_error,
            )
        await self._emit_progress(progress, "base locked")
        job = replace(job, issue_ref=issue_ref)
        manifest: dict = {
            "schema": "pico.maintenance.candidate.v2",
            "job_id": job.job_id,
            "issue": job.issue_ref,
            "issue_summary": job.issue_summary,
            "repository": str(self.repository),
            "base_commit": base_commit,
            "state": MaintenanceState.BLOCKED.value,
            "changed_files": [],
            "repair_checks": [],
            "verification_checks": [],
        }
        manifest.update(self._regression_manifest())
        manifest["checks_source_unchanged"] = {"repair": None, "verify": None}
        patch_path = candidate / "candidate.patch"
        changed_files: tuple[str, ...] = ()
        state = MaintenanceState.BLOCKED
        detail = ""
        repair_added = verify_added = baseline_added = False
        try:
            if self.regression_commands:
                await self._prepare_worktree(baseline, base_commit)
                baseline_added = True
                await self._emit_progress(progress, "baseline reproduction")
                baseline_checks = await self._run_regression_checks(baseline, candidate, phase="baseline")
                manifest["baseline_regression_checks"] = [asdict(item) for item in baseline_checks]
                if len(baseline_checks) != len(self.regression_commands) or any(
                    item.exit_code not in (0, 1) for item in baseline_checks
                ):
                    manifest["regression_evidence"]["status"] = "baseline_error"
                    detail = "Baseline regression command had an infrastructure or execution error (expected exit 1)"
                    return self._finish(candidate, manifest, state, base_commit, changed_files, detail)
                if any(item.exit_code == 0 for item in baseline_checks):
                    manifest["regression_evidence"]["status"] = "baseline_not_reproduced"
                    detail = "Issue was not reproduced: every baseline regression command must exit with 1"
                    return self._finish(candidate, manifest, state, base_commit, changed_files, detail)
                manifest["regression_evidence"]["status"] = "baseline_reproduced"
            await self._prepare_worktree(repair, base_commit)
            repair_added = True
            await self._emit_progress(progress, "reproducing and editing")
            agent_receipt = await self._run_exec(
                tuple(self.agent_command(job, repair)),
                cwd=repair,
                timeout=self.agent_timeout_seconds,
                env=self.agent_environment,
                inherit_env=False,
            )
            (candidate / "agent.log").write_text(agent_receipt.log, encoding="utf-8")
            manifest["agent_exit_code"] = agent_receipt.exit_code
            if agent_receipt.exit_code != 0:
                detail = f"Agent exited with {agent_receipt.exit_code}"
                return self._finish(candidate, manifest, state, base_commit, changed_files, detail)

            await self._run_exec(("git", "add", "-N", "--", "."), cwd=repair, timeout=30)
            patch = await self._git_bytes("-C", str(repair), "diff", "--binary", base_commit)
            patch_path.write_bytes(patch)
            names = await self._git_text("-C", str(repair), "diff", "--name-only", base_commit)
            changed_files = tuple(line for line in names.splitlines() if line)
            if not patch or not changed_files:
                detail = "Agent produced no patch"
                return self._finish(candidate, manifest, state, base_commit, changed_files, detail)
            rejected_files = tuple(path for path in changed_files if self._is_runtime_or_scratch_path(path))
            if rejected_files:
                manifest["policy_rejected_files"] = list(rejected_files)
                state = MaintenanceState.VERIFICATION_FAILED
                detail = "Candidate contains temporary or runtime artifacts: " + ", ".join(rejected_files)
                return self._finish(candidate, manifest, state, base_commit, changed_files, detail)

            await self._emit_progress(progress, "repair checks")
            repair_checks = await self._run_checks(repair, candidate, phase="repair")
            manifest["repair_checks"] = [asdict(item) for item in repair_checks]
            repair_regression_failed = False
            if self.regression_commands:
                repair_regressions = await self._run_regression_checks(repair, candidate, phase="repair")
                manifest["repair_regression_checks"] = [asdict(item) for item in repair_regressions]
                repair_regression_failed = len(repair_regressions) != len(self.regression_commands) or any(
                    item.exit_code != 0 for item in repair_regressions
                )
            # Checks may install dependencies or generate untracked caches, but
            # the source they verified must still be exactly the exported patch.
            repair_unchanged = await self._git_bytes("-C", str(repair), "diff", "--binary", base_commit) == patch
            manifest["checks_source_unchanged"]["repair"] = repair_unchanged
            if not repair_unchanged or repair_regression_failed:
                if self.regression_commands:
                    manifest["regression_evidence"]["status"] = "repair_failed"
                state = MaintenanceState.VERIFICATION_FAILED
                detail = (
                    "Repair checks modified candidate source files"
                    if not repair_unchanged
                    else "Repair worktree regression checks failed"
                )
                return self._finish(candidate, manifest, state, base_commit, changed_files, detail)
            if len(repair_checks) != len(self.acceptance_commands) or any(
                item.exit_code != 0 for item in repair_checks
            ):
                state = MaintenanceState.VERIFICATION_FAILED
                detail = "Repair worktree checks failed"
                return self._finish(candidate, manifest, state, base_commit, changed_files, detail)

            await self._prepare_worktree(verify, base_commit)
            verify_added = True
            await self._emit_progress(progress, "clean verification")
            apply_receipt = await self._run_exec(
                ("git", "apply", "--binary", "--index", str(patch_path)),
                cwd=verify,
                timeout=60,
            )
            manifest["apply_exit_code"] = apply_receipt.exit_code
            (candidate / "verify-apply.log").write_text(apply_receipt.log, encoding="utf-8")
            if apply_receipt.exit_code != 0:
                state = MaintenanceState.VERIFICATION_FAILED
                detail = "Candidate patch did not apply to the clean base"
                return self._finish(candidate, manifest, state, base_commit, changed_files, detail)

            verification_checks = await self._run_checks(verify, candidate, phase="verify")
            manifest["verification_checks"] = [asdict(item) for item in verification_checks]
            regression_failed = False
            if self.regression_commands:
                verification_regressions = await self._run_regression_checks(verify, candidate, phase="verify")
                manifest["verification_regression_checks"] = [asdict(item) for item in verification_regressions]
                regression_failed = len(verification_regressions) != len(self.regression_commands) or any(
                    item.exit_code != 0 for item in verification_regressions
                )
                manifest["regression_evidence"]["status"] = "verification_failed" if regression_failed else "verified"
            # --index above keeps candidate additions in the comparison too.
            # Compare the whole tracked diff so edits outside changed_files are
            # also rejected; ordinary untracked test/build output is allowed.
            verify_unchanged = await self._git_bytes("-C", str(verify), "diff", "--binary", base_commit) == patch
            manifest["checks_source_unchanged"]["verify"] = verify_unchanged
            if not verify_unchanged:
                if self.regression_commands:
                    manifest["regression_evidence"]["status"] = "verification_failed"
                state = MaintenanceState.VERIFICATION_FAILED
                detail = "Clean verifier checks modified candidate source files"
            elif regression_failed:
                state = MaintenanceState.VERIFICATION_FAILED
                detail = "Clean verifier regression checks failed"
            elif len(verification_checks) != len(self.acceptance_commands) or any(
                item.exit_code != 0 for item in verification_checks
            ):
                state = MaintenanceState.VERIFICATION_FAILED
                detail = "Clean verifier checks failed"
            else:
                state = MaintenanceState.CANDIDATE_READY
                detail = "Patch applied to the clean base and every configured check passed"
            return self._finish(candidate, manifest, state, base_commit, changed_files, detail)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            detail = str(exc)
            return self._finish(candidate, manifest, MaintenanceState.BLOCKED, base_commit, changed_files, detail)
        finally:
            if verify_added:
                await self._remove_worktree(verify)
            if repair_added:
                await self._remove_worktree(repair)
            if baseline_added:
                await self._remove_worktree(baseline)
            if run_root.exists():
                shutil.rmtree(run_root, ignore_errors=True)

    async def _prepare_worktree(self, path: Path, base_commit: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            shutil.rmtree(path)
        receipt = await self._run_exec(
            ("git", "worktree", "add", "--detach", str(path), base_commit),
            cwd=self.repository,
            timeout=60,
        )
        if receipt.exit_code != 0:
            raise RuntimeError(receipt.log)

    async def _remove_worktree(self, path: Path) -> None:
        await self._run_exec(
            ("git", "worktree", "remove", "--force", str(path)),
            cwd=self.repository,
            timeout=60,
        )

    async def _run_checks(self, worktree: Path, candidate: Path, *, phase: str) -> list[CommandReceipt]:
        return await self._run_check_commands(
            worktree, candidate, phase=phase, commands=self.acceptance_commands, log_prefix=f"{phase}-check"
        )

    async def _run_regression_checks(self, worktree: Path, candidate: Path, *, phase: str) -> list[CommandReceipt]:
        return await self._run_check_commands(
            worktree, candidate, phase=phase, commands=self.regression_commands, log_prefix=f"{phase}-regression-check"
        )

    async def _run_check_commands(
        self,
        worktree: Path,
        candidate: Path,
        *,
        phase: str,
        commands: Sequence[str],
        log_prefix: str,
    ) -> list[CommandReceipt]:
        receipts: list[CommandReceipt] = []
        for index, command in enumerate(commands, start=1):
            argv: tuple[str, ...]
            inherit_env = False
            if self.check_container_image:
                argv = self._container_check_argv(worktree, command, phase)
                inherit_env = True
                command_env = {}
            else:
                argv = ("/bin/sh", "-lc", command)
                command_env = {**self.agent_environment, "PICO_MAINTENANCE_PHASE": phase}
            receipt = await self._run_exec(
                argv,
                cwd=worktree,
                timeout=self.command_timeout_seconds,
                env=command_env,
                display=command,
                inherit_env=inherit_env,
            )
            log_name = f"{log_prefix}-{index}.log"
            (candidate / log_name).write_text(receipt.log, encoding="utf-8")
            receipts.append(CommandReceipt(receipt.command, receipt.exit_code, log_name))
        return receipts

    def _container_check_argv(self, worktree: Path, command: str, phase: str) -> tuple[str, ...]:
        worktree = worktree.resolve()
        git_dir = self.repository / ".git"
        inner = (
            "mkdir -p /tmp/pico-home /tmp/uv-cache /tmp/npm-cache && "
            f"git config --global --add safe.directory {shlex.quote(str(worktree))} && "
            f"{command}"
        )
        return (
            "docker",
            "run",
            "--rm",
            "--network",
            "bridge",
            "--cpus",
            "2",
            "--memory",
            "4g",
            "--volume",
            f"{worktree}:{worktree}:rw",
            "--volume",
            f"{git_dir}:{git_dir}:ro",
            "--workdir",
            str(worktree),
            "--env",
            "HOME=/tmp/pico-home",
            "--env",
            "UV_CACHE_DIR=/tmp/uv-cache",
            "--env",
            "NPM_CONFIG_CACHE=/tmp/npm-cache",
            "--env",
            f"PICO_MAINTENANCE_PHASE={phase}",
            self.check_container_image,
            "/bin/sh",
            "-lc",
            inner,
        )

    def _finish(
        self,
        candidate: Path,
        manifest: dict,
        state: MaintenanceState,
        base_commit: str,
        changed_files: tuple[str, ...],
        detail: str,
    ) -> MaintenanceOutcome:
        for key, value in self._regression_manifest().items():
            manifest.setdefault(key, value)
        manifest.setdefault("checks_source_unchanged", {"repair": None, "verify": None})
        manifest.update(
            {
                "state": state.value,
                "changed_files": list(changed_files),
                "detail": detail,
            }
        )
        (candidate / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        check_lines = []
        repair_checks = manifest.get("repair_checks", [])
        verification_checks = manifest.get("verification_checks", [])
        for index, repair_check in enumerate(repair_checks):
            verifier_exit = verification_checks[index]["exit_code"] if index < len(verification_checks) else "not run"
            check_lines.append(
                f"- `{repair_check['command']}`; Repair exit: `{repair_check['exit_code']}`; "
                f"Verifier exit: `{verifier_exit}`"
            )
        checks = "\n".join(check_lines) or "- none"
        regression_lines = []
        for index, command in enumerate(self.regression_commands):
            exits = []
            for key, label in (
                ("baseline_regression_checks", "Baseline"),
                ("repair_regression_checks", "Repair"),
                ("verification_regression_checks", "Verifier"),
            ):
                receipts = manifest[key]
                code = receipts[index]["exit_code"] if index < len(receipts) else "not run"
                exits.append(f"{label} exit: `{code}`")
            regression_lines.append(f"- `{command}`; " + "; ".join(exits))
        regression_checks = "\n".join(regression_lines) or "- not configured; issue reproduction was not verified"
        evidence = manifest["regression_evidence"]
        consistency_lines = []
        for phase in ("repair", "verify"):
            unchanged = manifest["checks_source_unchanged"][phase]
            result = "not run" if unchanged is None else str(unchanged).lower()
            consistency_lines.append(f"- {phase}: source still matches candidate patch: `{result}`")
        consistency = "\n".join(consistency_lines)
        issue_display = (
            f"[{manifest['issue']}]({manifest['issue']})"
            if str(manifest["issue"]).startswith("https://")
            else f"`{manifest['issue']}`"
        )
        (candidate / "CANDIDATE.md").write_text(
            f"# Maintenance candidate {manifest['job_id']}\n\n"
            f"- Issue: {issue_display}\n"
            f"- Issue summary: {manifest.get('issue_summary') or 'not provided'}\n"
            f"- Base revision: `{base_commit}`\n"
            f"- State: `{state.value}`\n"
            f"- Changed files: {', '.join(changed_files) or 'none'}\n"
            f"- Patch: {'`candidate.patch`' if (candidate / 'candidate.patch').is_file() else 'not produced'}\n"
            f"- Verdict: {detail}\n\n"
            f"## Checks\n\n{checks}\n\n"
            f"## Regression evidence\n\n"
            f"- Mode: `{evidence['mode']}`\n"
            f"- Status: `{evidence['status']}`\n"
            f"- Scope: {evidence['explanation']}\n\n{regression_checks}\n"
            f"\n## Candidate source consistency\n\n{consistency}\n",
            encoding="utf-8",
        )
        return MaintenanceOutcome(
            state=state,
            base_commit=base_commit,
            candidate_dir=candidate,
            changed_files=changed_files,
            detail=detail,
        )

    def _regression_manifest(self) -> dict:
        configured = bool(self.regression_commands)
        return {
            "regression_evidence": {
                "mode": "red_green" if configured else "acceptance_only",
                "status": "pending" if configured else "not_configured",
                "explanation": (
                    "Each fixed regression command must exit 1 on the clean base, then 0 in repair and clean verifier. "
                    "This evidence covers only the configured commands; it does not prove all issue behavior."
                    if configured
                    else "Only configured acceptance checks are required. Issue reproduction was not verified."
                ),
            },
            "baseline_regression_checks": [],
            "repair_regression_checks": [],
            "verification_regression_checks": [],
        }

    @staticmethod
    def _validated_commands(commands: Sequence[str], *, required: bool) -> tuple[str, ...]:
        normalized = tuple(command.strip() for command in commands)
        if (required and not normalized) or any(not command for command in normalized):
            raise ValueError("Maintenance check commands must be non-empty; acceptance commands are required")
        return normalized

    async def _validated_issue_ref(self, job: MaintenanceJob) -> tuple[str, str]:
        issue_ref = job.issue_ref
        if _ISSUE_PROPOSAL_REF.fullmatch(issue_ref):
            if not job.issue_summary:
                return issue_ref, "Local issue proposal has no persisted summary"
            return issue_ref, ""
        if re.fullmatch(r"#?[1-9]\d*", issue_ref):
            return issue_ref if issue_ref.startswith("#") else f"#{issue_ref}", ""
        match = re.fullmatch(
            r"https://(?P<host>github|gitee)\.com/(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+)/issues/(?P<number>[A-Za-z0-9_-]+)",
            issue_ref,
        )
        if match is None:
            return issue_ref, "Invalid repository Issue reference"
        remote = await self._git_text("config", "--get", "remote.origin.url")
        remote_match = re.search(
            r"(?P<host>github|gitee)\.com[/:](?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$",
            remote,
        )
        if remote_match is None:
            return issue_ref, "Configured repository has no canonical GitHub or Gitee origin"
        requested = (match.group("host"), match.group("owner").lower(), match.group("repo").lower())
        configured = (
            remote_match.group("host"),
            remote_match.group("owner").lower(),
            remote_match.group("repo").lower(),
        )
        if requested != configured:
            return issue_ref, "Issue is outside configured repository"
        return issue_ref, ""

    async def _git_text(self, *args: str) -> str:
        receipt = await self._run_exec(("git", *args), cwd=self.repository, timeout=60)
        if receipt.exit_code != 0:
            raise RuntimeError(receipt.log)
        return receipt.log.strip()

    async def _git_bytes(self, *args: str) -> bytes:
        process = await asyncio.create_subprocess_exec(
            "git",
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.repository,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60)
        except (asyncio.TimeoutError, asyncio.CancelledError) as exc:
            process.kill()
            await process.wait()
            if isinstance(exc, asyncio.CancelledError):
                raise
            raise RuntimeError("git command timed out after 60s") from exc
        if process.returncode != 0:
            raise RuntimeError(stderr.decode(errors="replace"))
        return stdout

    async def _run_exec(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        timeout: int,
        env: dict[str, str] | None = None,
        display: str | None = None,
        inherit_env: bool = True,
    ) -> CommandReceipt:
        process = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            env={**(os.environ if inherit_env else self._safe_environment()), **(env or {})},
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            return CommandReceipt(display or " ".join(argv), -1, f"Timed out after {timeout}s\n")
        except asyncio.CancelledError:
            process.kill()
            await process.wait()
            raise
        log = stdout.decode(errors="replace") + stderr.decode(errors="replace")
        return CommandReceipt(display or " ".join(argv), process.returncode, log)

    @staticmethod
    def _safe_environment() -> dict[str, str]:
        allowed = ("PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ", "TMPDIR")
        return {key: value for key in allowed if (value := os.environ.get(key)) is not None}

    @staticmethod
    async def _emit_progress(progress: ProgressSink | None, stage: str) -> None:
        if progress is not None:
            await progress(stage)

    @staticmethod
    def _is_runtime_or_scratch_path(path: str) -> bool:
        parts = Path(path).parts
        return bool(parts) and (
            parts[0] in _RUNTIME_ARTIFACT_ROOTS
            or parts[0].startswith("repro_")
            or any(part.startswith(".scratch") for part in parts)
        )

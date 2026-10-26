from __future__ import annotations

import asyncio
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Protocol
from zoneinfo import ZoneInfo

from loguru import logger

from pico.config.pico import MaintenanceConfig
from pico.maintenance.issues import ExternalIssue, IssuePublisher
from pico.maintenance.models import MaintenanceJob, MaintenanceOutcome, MaintenanceState
from pico.maintenance.notifications import MaintenanceNotice, MaintenanceNoticeKind, MaintenanceNotifier
from pico.maintenance.store import MaintenanceStore
from pico.spine import ChatType, Source, TurnRequest

_FIX_COMMAND = re.compile(r"^/fix(?:\s+(?P<issue>\S+))?\s*$", re.IGNORECASE)
_ISSUE_COMMAND = re.compile(r"^/issue(?:\s+(?P<summary>.+?))?\s*$", re.IGNORECASE | re.DOTALL)
_FEISHU_MENTION_PREFIX = re.compile(r"^(?:@_user_\d+\s*)+")
_ISSUE_REF = re.compile(
    r"(?:#?[1-9]\d*|https://(?:github|gitee)\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/[A-Za-z0-9_-]+)"
)
_ISSUE_PROPOSAL_REF = re.compile(r"pi_[0-9a-f]{12}")


@dataclass(frozen=True)
class TurnAdmission:
    admitted: bool
    message: str = ""


def _issue_title(summary: str, limit: int = 120) -> str:
    first_line = next((line for line in summary.splitlines() if line.strip()), summary)
    title = " ".join(first_line.split()).replace("[", "").replace("]", "")
    return title if len(title) <= limit else title[: limit - 1].rstrip() + "…"


def _issue_captured_message(summary: str, message_link: str, issue_url: str = "") -> str:
    title = _issue_title(summary)
    link = issue_url or message_link
    issue = f"[{title}]({link})" if link.startswith("https://") else title
    return f"Issue captured: {issue}\nReply to the original report with /fix when it is ready for repair."


class MaintenanceJobRunner(Protocol):
    async def run(
        self,
        job: MaintenanceJob,
        progress: Callable[[str], Awaitable[None]] | None = None,
    ) -> MaintenanceOutcome: ...


class MaintenanceReplySink(Protocol):
    async def __call__(self, content: str, media: tuple[Path, ...] = ()) -> None: ...


async def _notify_or_send(
    notifier: MaintenanceNotifier | None,
    notice: MaintenanceNotice,
    send: MaintenanceReplySink,
    fallback: str,
) -> str | None:
    if notifier is not None:
        try:
            return await notifier.notify(notice)
        except Exception as exc:
            logger.warning("Maintenance card delivery failed: {}", exc)
    await send(fallback)
    return None


def _external_summary(issue: ExternalIssue) -> str:
    body = issue.body.split("<!-- pico-maintenance:", 1)[0].strip()
    if body.startswith(issue.title):
        return body
    return f"{issue.title}\n\n{body}".strip()


class MaintenanceCoordinator:
    def __init__(
        self,
        config: MaintenanceConfig,
        *,
        state_dir: Path,
        runner: MaintenanceJobRunner,
        issue_publisher: IssuePublisher | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.config = config
        self.state_dir = state_dir
        self.runner = runner
        self.issue_publisher = issue_publisher
        self._timezone = ZoneInfo(config.quota_timezone)
        self._clock = clock or (lambda: datetime.now(self._timezone))
        self._store = MaintenanceStore(state_dir / "maintenance.db")
        self._recovered_jobs = self._store.mark_unfinished_blocked()
        self._tasks: set[asyncio.Task[None]] = set()
        self._job_slots = asyncio.Semaphore(config.max_concurrent_jobs)

    def is_maintainer(self, req: TurnRequest) -> bool:
        return req.source.chat_id in self.config.allowed_chats and req.source.sender_id in self.config.maintainers

    def admit_agent_turn(self, req: TurnRequest) -> TurnAdmission:
        message_id = str(req.source.extras.get("message_id") or "")
        if not message_id:
            return TurnAdmission(False, "无法在缺少稳定消息 ID 时启动 Pico AI 问答。")
        quota_day = self._clock().astimezone(self._timezone).date().isoformat()
        try:
            decision = self._store.reserve_agent_turn(
                channel=req.source.channel,
                message_id=message_id,
                sender_id=req.source.sender_id,
                chat_id=req.source.chat_id,
                quota_day=quota_day,
                max_per_user=self.config.max_daily_agent_turns_per_user,
                max_per_chat=self.config.max_daily_agent_turns_per_chat,
            )
        except Exception:
            logger.exception("Daily Agent Turn quota check failed")
            return TurnAdmission(False, "Pico 暂时无法确认今日问答额度，请稍后再试。")
        if decision == "admitted":
            return TurnAdmission(True)
        if decision == "duplicate":
            return TurnAdmission(False)
        if decision == "user_limit":
            return TurnAdmission(
                False,
                f"今天的 {self.config.max_daily_agent_turns_per_user} 次 Pico AI 问答额度已用完，"
                "明天 00:00（北京时间）恢复。你仍然可以使用 /issue 提交问题。",
            )
        return TurnAdmission(
            False,
            f"本群今天的 {self.config.max_daily_agent_turns_per_chat} 次 Pico AI 问答额度已用完，"
            "明天 00:00（北京时间）恢复。你仍然可以使用 /issue 提交问题。",
        )

    async def handle(
        self,
        req: TurnRequest,
        send: MaintenanceReplySink,
        notifier: MaintenanceNotifier | None = None,
    ) -> bool:
        text = req.text.strip()
        if req.source.channel == "feishu":
            text = _FEISHU_MENTION_PREFIX.sub("", text).strip()
        if not self.config.enabled:
            return False
        issue_match = _ISSUE_COMMAND.fullmatch(text)
        if issue_match is not None:
            return await self._handle_issue_proposal(
                req,
                (issue_match.group("summary") or "").strip(),
                send,
                notifier,
            )
        match = _FIX_COMMAND.fullmatch(text)
        if match is None:
            return False
        if req.source.chat_id not in self.config.allowed_chats:
            await send("This chat is not authorized to start Pico maintenance jobs.")
            return True
        if not self.is_maintainer(req):
            await send("Only a configured Pico maintainer can start /fix jobs.")
            return True
        issue_ref = match.group("issue") or ""
        issue_summary = ""
        issue_key = ""
        issue_url = ""
        if not issue_ref:
            parent_message_id = str(req.source.extras.get("parent_message_id") or "")
            proposal = self._store.get_proposal_by_source_message(parent_message_id)
            if proposal is None:
                await send("Reply to a captured issue with /fix, or use /fix <Gitee Issue>.")
                return True
            issue_ref = proposal.issue_url or proposal.proposal_id
            issue_summary = proposal.summary
            issue_url = proposal.issue_url
            issue_key = f"proposal:{proposal.proposal_id}"
        elif _ISSUE_PROPOSAL_REF.fullmatch(issue_ref) is not None:
            proposal = self._store.get_proposal(issue_ref)
            if proposal is None:
                await send(f"Issue proposal {issue_ref} was not found.")
                return True
            issue_summary = proposal.summary
            issue_url = proposal.issue_url
            issue_key = f"proposal:{proposal.proposal_id}"
        elif self.issue_publisher is not None:
            try:
                external = await self.issue_publisher.resolve(issue_ref)
            except Exception as exc:
                await send(f"Cannot resolve Gitee Issue: {exc}")
                return True
            issue_ref = external.url
            issue_url = external.url
            issue_key = external.key
            issue_summary = _external_summary(external)
        elif _ISSUE_REF.fullmatch(issue_ref) is None:
            await send("Usage: /fix <issue number, proposal ID, GitHub URL, or Gitee URL>")
            return True
        else:
            issue_key = f"legacy:{issue_ref.lower()}"
        if issue_url and self.issue_publisher is not None and issue_key.startswith("proposal:"):
            try:
                external = await self.issue_publisher.resolve(issue_url)
            except Exception as exc:
                await send(f"Cannot resolve Gitee Issue: {exc}")
                return True
            issue_ref = external.url
            issue_url = external.url
            issue_key = external.key
            issue_summary = _external_summary(external)
        message_id = str(req.source.extras.get("message_id") or "")
        if not message_id:
            await send("Cannot start /fix without a stable source message ID.")
            return True
        existing_job = self._store.get_active_job(issue_key)
        if existing_job is not None:
            title = _issue_title(existing_job.issue_summary or existing_job.issue_ref)
            await send(f"Repair already exists for {title} ({existing_job.state.value}).")
            return True
        quota_day = self._clock().astimezone(self._timezone).date().isoformat()
        try:
            reservation = self._store.reserve_fix_job(
                channel=req.source.channel,
                message_id=message_id,
                sender_id=req.source.sender_id,
                chat_id=req.source.chat_id,
                quota_day=quota_day,
                max_total=self.config.max_daily_fix_jobs,
            )
        except Exception:
            logger.exception("Daily /fix quota check failed")
            await send("Pico 暂时无法确认今日 /fix 额度，请稍后再试。")
            return True
        if reservation == "total_limit":
            await send(f"今天的 {self.config.max_daily_fix_jobs} 次 Pico /fix 额度已用完，明天 00:00（北京时间）恢复。")
            return True
        job, created = self._store.create_or_get(
            source_message_id=message_id,
            issue_ref=issue_ref,
            chat_id=req.source.chat_id,
            sender_id=req.source.sender_id,
            issue_summary=issue_summary,
            issue_key=issue_key,
            issue_url=issue_url,
            message_link=str(req.source.extras.get("message_link") or ""),
        )
        if not created:
            if reservation == "admitted":
                self._store.release_quota_event(req.source.channel, message_id)
            title = _issue_title(job.issue_summary or job.issue_ref)
            await send(f"Repair already exists for {title} ({job.state.value}).")
            return True
        title = _issue_title(issue_summary or issue_ref)
        card_message_id = await _notify_or_send(
            notifier,
            MaintenanceNotice(
                key=job.job_id,
                kind=MaintenanceNoticeKind.STARTED,
                source=req.source,
                title=title,
                message_link=str(req.source.extras.get("message_link") or ""),
                issue_url=issue_url,
            ),
            send,
            f"Repair started: {title}.",
        )
        if card_message_id:
            self._store.record_card_message(job.job_id, card_message_id)
            job = replace(job, card_message_id=card_message_id)
        task = asyncio.create_task(self._execute(job, req.source, send, notifier))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return True

    async def _handle_issue_proposal(
        self,
        req: TurnRequest,
        summary: str,
        send: MaintenanceReplySink,
        notifier: MaintenanceNotifier | None,
    ) -> bool:
        if req.source.chat_id not in self.config.allowed_chats:
            await send("This chat is not authorized to submit Pico issue proposals.")
            return True
        if not self.is_maintainer(req):
            await send("Only a configured Pico maintainer can promote issue proposals.")
            return True
        if not summary:
            summary = str(req.source.extras.get("quoted_text") or "").strip()
        if req.source.channel == "feishu":
            summary = _FEISHU_MENTION_PREFIX.sub("", summary).strip()
        if not summary:
            await send("Reply to a user message with /issue, or use /issue <description>.")
            return True
        if len(summary) > 4000:
            await send("Issue proposal is too long; keep it within 4000 characters.")
            return True
        message_id = str(req.source.extras.get("message_id") or "")
        if not message_id:
            await send("Cannot submit an issue proposal without a stable source message ID.")
            return True
        proposal_source = str(req.source.extras.get("parent_message_id") or message_id)
        proposal, _created = self._store.create_or_get_proposal(
            source_message_id=proposal_source,
            summary=summary,
            chat_id=req.source.chat_id,
            sender_id=req.source.sender_id,
        )
        message_link = str(req.source.extras.get("message_link") or "")
        if self.issue_publisher is not None and not proposal.issue_url:
            body = proposal.summary
            if message_link:
                body += f"\n\nOriginal Feishu report: {message_link}"
            try:
                external = await self.issue_publisher.create_or_find(
                    proposal.proposal_id,
                    _issue_title(proposal.summary),
                    body,
                )
            except Exception as exc:
                detail = str(exc)
                self._store.record_proposal_publish_error(proposal.proposal_id, detail)
                await send(f"Gitee Issue creation failed: {detail}")
                return True
            self._store.record_external_issue(
                proposal.proposal_id,
                number=external.number,
                url=external.url,
            )
            proposal = self._store.get_proposal(proposal.proposal_id) or proposal
        await _notify_or_send(
            notifier,
            MaintenanceNotice(
                key=proposal.proposal_id,
                kind=MaintenanceNoticeKind.ISSUE_CAPTURED,
                source=req.source,
                title=_issue_title(proposal.summary),
                message_link=message_link,
                issue_url=proposal.issue_url,
            ),
            send,
            _issue_captured_message(proposal.summary, message_link, proposal.issue_url),
        )
        return True

    async def recover(self, notifier: MaintenanceNotifier | None) -> None:
        if notifier is None:
            return
        jobs, self._recovered_jobs = self._recovered_jobs, ()
        pending = []
        for job in jobs:
            if not job.card_message_id:
                continue
            source = Source(
                channel="feishu",
                chat_id=job.chat_id,
                sender_id=job.sender_id,
                chat_type=ChatType.GROUP,
                extras={"message_id": job.source_message_id},
            )
            try:
                await notifier.notify(
                    MaintenanceNotice(
                        key=job.job_id,
                        kind=MaintenanceNoticeKind.BLOCKED,
                        source=source,
                        title=_issue_title(job.issue_summary or job.issue_ref),
                        message_link=job.message_link,
                        issue_url=job.issue_url,
                        card_message_id=job.card_message_id,
                        detail="Gateway restarted before the maintenance job reached a terminal state",
                    )
                )
            except Exception as exc:
                logger.warning("Maintenance job {} recovery delivery failed: {}", job.job_id, exc)
                pending.append(job)
        self._recovered_jobs = tuple(pending)

    async def wait_idle(self) -> None:
        if self._tasks:
            await asyncio.gather(*tuple(self._tasks))

    async def close(self) -> None:
        for task in tuple(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*tuple(self._tasks), return_exceptions=True)
        self._store.close()

    async def _execute(
        self,
        job: MaintenanceJob,
        source: Source,
        send: MaintenanceReplySink,
        notifier: MaintenanceNotifier | None,
    ) -> None:
        self._store.mark_running(job.job_id)
        current_stage = "starting"
        title = _issue_title(job.issue_summary or job.issue_ref)
        started_at = time.monotonic()

        async def safe_send(content: str, media: tuple[Path, ...] = ()) -> None:
            try:
                if media:
                    await send(content, media)
                else:
                    await send(content)
            except Exception as exc:
                logger.warning("Maintenance job {} progress delivery failed: {}", job.job_id, exc)

        async def safe_notify(notice: MaintenanceNotice, fallback: str, media: tuple[Path, ...] = ()) -> None:
            if notifier is None:
                await safe_send(fallback, media)
                return
            try:
                await notifier.notify(notice)
            except Exception as exc:
                logger.warning("Maintenance job {} card delivery failed: {}", job.job_id, exc)
                await safe_send(fallback, media)

        async def progress(stage: str) -> None:
            nonlocal current_stage
            current_stage = stage
            await safe_notify(
                MaintenanceNotice(
                    key=job.job_id,
                    kind=MaintenanceNoticeKind.PROGRESS,
                    source=source,
                    title=title,
                    stage=stage,
                    elapsed_seconds=int(time.monotonic() - started_at),
                    message_link=job.message_link,
                    issue_url=job.issue_url,
                    card_message_id=job.card_message_id,
                ),
                f"{title} - Stage: {stage}.",
            )

        async def heartbeat() -> None:
            while True:
                await asyncio.sleep(self.config.progress_interval_seconds)
                await safe_notify(
                    MaintenanceNotice(
                        key=job.job_id,
                        kind=MaintenanceNoticeKind.HEARTBEAT,
                        source=source,
                        title=title,
                        stage=current_stage,
                        elapsed_seconds=int(time.monotonic() - started_at),
                        message_link=job.message_link,
                        issue_url=job.issue_url,
                        card_message_id=job.card_message_id,
                    ),
                    f"{title} is still running - Stage: {current_stage}.",
                )

        heartbeat_task = asyncio.create_task(heartbeat())
        try:
            try:
                async with self._job_slots:
                    outcome = await self.runner.run(job, progress)
            except asyncio.CancelledError:
                outcome = MaintenanceOutcome(MaintenanceState.BLOCKED, detail="Gateway stopped during maintenance job")
                self._store.record_outcome(job.job_id, outcome)
                raise
            except Exception as exc:
                outcome = MaintenanceOutcome(MaintenanceState.BLOCKED, detail=str(exc))
            self._store.record_outcome(job.job_id, outcome)
            files = ", ".join(outcome.changed_files) if outcome.changed_files else "none"
            base = outcome.base_commit or "unknown"
            attachments: tuple[Path, ...] = ()
            if outcome.candidate_dir is not None:
                names = ("CANDIDATE.md", "candidate.patch")
                if outcome.state is not MaintenanceState.CANDIDATE_READY:
                    names = ("CANDIDATE.md",)
                attachments = tuple(path for name in names if (path := outcome.candidate_dir / name).is_file())
            if outcome.state is MaintenanceState.CANDIDATE_READY:
                notice_kind = MaintenanceNoticeKind.CANDIDATE_READY
                content = (
                    f"Candidate ready: {title}\n"
                    f"Base revision: {base}\n"
                    f"Changed files: {files}\n"
                    "The review report and patch are attached."
                )
            elif outcome.state is MaintenanceState.VERIFICATION_FAILED:
                notice_kind = MaintenanceNoticeKind.VERIFICATION_FAILED
                content = (
                    f"Verification failed: {title}\n"
                    f"Base revision: {base}\n"
                    f"Changed files: {files}\n"
                    f"Reason: {outcome.detail or 'acceptance checks did not pass'}."
                )
            else:
                notice_kind = MaintenanceNoticeKind.BLOCKED
                content = f"Repair blocked: {title}\nReason: {outcome.detail or 'no detail available'}."
            await safe_notify(
                MaintenanceNotice(
                    key=job.job_id,
                    kind=notice_kind,
                    source=source,
                    title=title,
                    stage=current_stage,
                    base_commit=outcome.base_commit,
                    changed_files=outcome.changed_files,
                    detail=outcome.detail,
                    attachments=attachments,
                    message_link=job.message_link,
                    issue_url=job.issue_url,
                    card_message_id=job.card_message_id,
                ),
                content,
                attachments,
            )
        finally:
            heartbeat_task.cancel()
            await asyncio.gather(heartbeat_task, return_exceptions=True)

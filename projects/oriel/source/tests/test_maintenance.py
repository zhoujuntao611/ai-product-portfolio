from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from pico.config.pico import MaintenanceConfig
from pico.maintenance import (
    ExternalIssue,
    GiteeIssuePublisher,
    GitMaintenanceRunner,
    MaintenanceCoordinator,
    MaintenanceJob,
    MaintenanceNoticeKind,
    MaintenanceOutcome,
    MaintenanceState,
    build_maintenance_coordinator,
)
from pico.spine import ChatType, Origin, Source, TurnRequest


class _Runner:
    def __init__(self, outcome: MaintenanceOutcome | None = None, progress: tuple[str, ...] = ()) -> None:
        self.calls = []
        self.outcome = outcome
        self.progress = progress

    async def run(self, job, progress=None):
        self.calls.append(job)
        for stage in self.progress:
            await progress(stage)
        if self.outcome is None:
            raise AssertionError("runner should not start")
        return self.outcome


class _IssuePublisher:
    def __init__(self) -> None:
        self.created: list[tuple[str, str, str]] = []
        self.resolved: list[str] = []

    async def create_or_find(self, key: str, title: str, body: str) -> ExternalIssue:
        self.created.append((key, title, body))
        return ExternalIssue(
            provider="gitee",
            repository="htxoffical/pico-harness",
            number="I123ABC",
            url="https://gitee.com/htxoffical/pico-harness/issues/I123ABC",
            title=title,
            body=body,
        )

    async def resolve(self, issue_ref: str) -> ExternalIssue:
        self.resolved.append(issue_ref)
        return ExternalIssue(
            provider="gitee",
            repository="htxoffical/pico-harness",
            number="I123ABC",
            url="https://gitee.com/htxoffical/pico-harness/issues/I123ABC",
            title="BoxLite network policy fails",
            body="BoxLite network policy fails\n\nBoxLite 0.9.5 rejects the current NetworkSpec value.",
        )


async def test_gitee_publisher_creates_issue_without_putting_token_in_url() -> None:
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=[])
        return httpx.Response(
            201,
            json={
                "number": "I123ABC",
                "html_url": "https://gitee.com/htxoffical/pico-harness/issues/I123ABC",
                "title": "BoxLite network policy fails",
                "body": "details",
            },
        )

    publisher = GiteeIssuePublisher(
        repository="htxoffical/pico-harness",
        access_token="secret-token",
        transport=httpx.MockTransport(handler),
    )
    issue = await publisher.create_or_find("pi_123456789abc", "BoxLite network policy fails", "details")

    assert issue.number == "I123ABC"
    assert issue.url.endswith("/issues/I123ABC")
    assert all("secret-token" not in str(request.url) for request in requests)
    create_payload = json.loads(requests[-1].content)
    assert "secret-token" not in requests[-1].content.decode()
    assert requests[-1].headers["authorization"] == "Bearer secret-token"
    assert create_payload["repo"] == "pico-harness"
    assert "pico-maintenance:pi_123456789abc" in create_payload["body"]


async def test_gitee_publisher_serializes_concurrent_create_for_same_key() -> None:
    requests: list[httpx.Request] = []
    created: list[dict] = []
    post_entered = asyncio.Event()
    release_post = asyncio.Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=list(created))
        post_entered.set()
        await release_post.wait()
        payload = json.loads(request.content)
        issue = {
            "number": "I123ABC",
            "html_url": "https://gitee.com/htxoffical/pico-harness/issues/I123ABC",
            "title": payload["title"],
            "body": payload["body"],
        }
        created.append(issue)
        return httpx.Response(201, json=issue)

    publisher = GiteeIssuePublisher(
        repository="htxoffical/pico-harness",
        access_token="secret-token",
        transport=httpx.MockTransport(handler),
    )
    first = asyncio.create_task(publisher.create_or_find("pi_same", "Race", "details"))
    await post_entered.wait()
    second = asyncio.create_task(publisher.create_or_find("pi_same", "Race", "details"))
    await asyncio.sleep(0)

    assert [request.method for request in requests] == ["GET", "POST"]

    release_post.set()
    first_issue, second_issue = await asyncio.gather(first, second)

    assert first_issue.number == second_issue.number
    assert [request.method for request in requests].count("POST") == 1
    assert [request.method for request in requests].count("GET") == 2


async def test_gitee_publisher_keeps_different_keys_parallel() -> None:
    get_count = 0
    post_count = 0
    both_gets_entered = asyncio.Event()
    release_gets = asyncio.Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal get_count, post_count
        if request.method == "GET":
            get_count += 1
            if get_count == 2:
                both_gets_entered.set()
            await release_gets.wait()
            return httpx.Response(200, json=[])
        post_count += 1
        payload = json.loads(request.content)
        return httpx.Response(
            201,
            json={
                "number": f"I{post_count}",
                "html_url": f"https://gitee.com/htxoffical/pico-harness/issues/I{post_count}",
                "title": payload["title"],
                "body": payload["body"],
            },
        )

    publisher = GiteeIssuePublisher(
        repository="htxoffical/pico-harness",
        access_token="secret-token",
        transport=httpx.MockTransport(handler),
    )
    first = asyncio.create_task(publisher.create_or_find("pi_a", "A", "details"))
    second = asyncio.create_task(publisher.create_or_find("pi_b", "B", "details"))
    await asyncio.wait_for(both_gets_entered.wait(), timeout=1)

    release_gets.set()
    await asyncio.gather(first, second)

    assert get_count == 2
    assert post_count == 2


def _request(
    text: str,
    *,
    sender: str = "ou_member",
    message_id: str = "om_1",
    extras: dict | None = None,
) -> TurnRequest:
    source_extras = {"message_id": message_id, **(extras or {})}
    return TurnRequest(
        origin=Origin.USER,
        source=Source(
            channel="feishu",
            chat_id="oc_pico",
            sender_id=sender,
            chat_type=ChatType.GROUP,
            extras=source_extras,
        ),
        text=text,
    )


async def test_regular_group_message_stays_on_the_normal_gateway_path(tmp_path: Path) -> None:
    runner = _Runner()
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(
            enabled=True,
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
        ),
        state_dir=tmp_path,
        runner=runner,
    )
    replies: list[str] = []

    async def send(content: str) -> None:
        replies.append(content)

    handled = await coordinator.handle(_request("How does the Gateway work?"), send)

    assert handled is False
    assert replies == []
    assert runner.calls == []


async def test_maintainer_can_submit_idempotent_issue_proposal(tmp_path: Path) -> None:
    runner = _Runner(MaintenanceOutcome(state=MaintenanceState.BLOCKED, detail="test"))
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(
            enabled=True,
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
        ),
        state_dir=tmp_path,
        runner=runner,
    )
    replies: list[str] = []

    async def send(content: str) -> None:
        replies.append(content)

    request = _request(
        "@_user_1 /issue grep fails when context is 1",
        sender="ou_owner",
        message_id="om_issue",
        extras={
            "message_link": "https://applink.feishu.cn/client/thread/open?open_chat_id=oc_pico&open_thread_id=omt_issue"
        },
    )
    assert await coordinator.handle(request, send) is True
    assert replies[0] == (
        "Issue captured: [grep fails when context is 1]"
        "(https://applink.feishu.cn/client/thread/open?open_chat_id=oc_pico&open_thread_id=omt_issue)\n"
        "Reply to the original report with /fix when it is ready for repair."
    )
    assert "pi_" not in replies[0]
    assert runner.calls == []

    assert await coordinator.handle(request, send) is True
    assert replies[1] == replies[0]


async def test_issue_proposal_uses_structured_notice_when_available(tmp_path: Path) -> None:
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(enabled=True, allowed_chats=["oc_pico"], maintainers=["ou_owner"]),
        state_dir=tmp_path,
        runner=_Runner(),
    )
    text_replies = []
    notices = []

    async def send(content: str) -> None:
        text_replies.append(content)

    class Notifier:
        async def notify(self, notice) -> None:
            notices.append(notice)

    request = _request(
        "/issue grep context is incomplete",
        sender="ou_owner",
        message_id="om_issue",
        extras={"message_link": "https://applink.feishu.cn/client/thread/open?open_chat_id=oc_pico"},
    )
    assert await coordinator.handle(request, send, notifier=Notifier()) is True

    assert text_replies == []
    assert [notice.kind for notice in notices] == [MaintenanceNoticeKind.ISSUE_CAPTURED]
    assert notices[0].title == "grep context is incomplete"
    assert notices[0].message_link.startswith("https://applink.feishu.cn/")


async def test_issue_proposal_publishes_and_persists_external_issue(tmp_path: Path) -> None:
    publisher = _IssuePublisher()
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(enabled=True, allowed_chats=["oc_pico"], maintainers=["ou_owner"]),
        state_dir=tmp_path,
        runner=_Runner(),
        issue_publisher=publisher,
    )
    notices = []

    async def send(_content: str) -> None:
        raise AssertionError("structured notice should be delivered")

    class Notifier:
        async def notify(self, notice):
            notices.append(notice)
            return "om_issue_card"

    request = _request(
        "/issue",
        sender="ou_owner",
        message_id="om_issue",
        extras={
            "parent_message_id": "om_report",
            "quoted_text": "BoxLite network policy fails",
            "message_link": "https://applink.feishu.cn/client/thread/open?open_chat_id=oc_pico",
        },
    )
    assert await coordinator.handle(request, send, notifier=Notifier()) is True
    assert len(publisher.created) == 1
    assert "https://applink.feishu.cn/" in publisher.created[0][2]
    assert notices[0].issue_url == "https://gitee.com/htxoffical/pico-harness/issues/I123ABC"
    proposal = coordinator._store.get_proposal_by_source_message("om_report")
    assert proposal is not None
    assert proposal.issue_number == "I123ABC"
    assert proposal.issue_url == notices[0].issue_url

    assert await coordinator.handle(request, send, notifier=Notifier()) is True
    assert len(publisher.created) == 1


async def test_external_issue_publish_failure_is_not_reported_as_captured(tmp_path: Path) -> None:
    class BrokenPublisher(_IssuePublisher):
        async def create_or_find(self, key: str, title: str, body: str) -> ExternalIssue:
            raise RuntimeError("Gitee rejected the request")

    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(enabled=True, allowed_chats=["oc_pico"], maintainers=["ou_owner"]),
        state_dir=tmp_path,
        runner=_Runner(),
        issue_publisher=BrokenPublisher(),
    )
    replies = []

    async def send(content: str) -> None:
        replies.append(content)

    assert (
        await coordinator.handle(
            _request("/issue broken behavior", sender="ou_owner", message_id="om_issue"),
            send,
        )
        is True
    )
    assert replies == ["Gitee Issue creation failed: Gitee rejected the request"]


async def test_issue_card_failure_falls_back_to_the_existing_text_reply(tmp_path: Path) -> None:
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(enabled=True, allowed_chats=["oc_pico"], maintainers=["ou_owner"]),
        state_dir=tmp_path,
        runner=_Runner(),
    )
    replies = []

    async def send(content: str) -> None:
        replies.append(content)

    class BrokenNotifier:
        async def notify(self, notice) -> None:
            raise RuntimeError("card unavailable")

    request = _request("/issue grep context is incomplete", sender="ou_owner", message_id="om_issue")
    assert await coordinator.handle(request, send, notifier=BrokenNotifier()) is True

    assert replies == [
        "Issue captured: grep context is incomplete\n"
        "Reply to the original report with /fix when it is ready for repair."
    ]


async def test_group_member_cannot_promote_issue_proposal(tmp_path: Path) -> None:
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(
            enabled=True,
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
        ),
        state_dir=tmp_path,
        runner=_Runner(),
    )
    replies: list[str] = []

    async def send(content: str) -> None:
        replies.append(content)

    assert await coordinator.handle(_request("/issue untriaged report"), send) is True
    assert replies == ["Only a configured Pico maintainer can promote issue proposals."]


async def test_maintainer_can_promote_replied_message_without_copying_text(tmp_path: Path) -> None:
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(
            enabled=True,
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
        ),
        state_dir=tmp_path,
        runner=_Runner(),
    )
    replies: list[str] = []

    async def send(content: str) -> None:
        replies.append(content)

    request = _request(
        "@_user_1 /issue",
        sender="ou_owner",
        extras={"quoted_text": "@_user_1 grep context fails through registry", "parent_message_id": "om_report"},
    )
    assert await coordinator.handle(request, send) is True
    assert replies[0].startswith("Issue captured: grep context fails through registry")


async def test_maintainer_can_start_fix_by_replying_to_captured_issue(tmp_path: Path) -> None:
    runner = _Runner(MaintenanceOutcome(state=MaintenanceState.BLOCKED, detail="test"))
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(
            enabled=True,
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
        ),
        state_dir=tmp_path,
        runner=runner,
    )
    replies: list[str] = []

    async def send(content: str) -> None:
        replies.append(content)

    issue_request = _request(
        "/issue",
        sender="ou_owner",
        message_id="om_issue_command",
        extras={
            "quoted_text": "grep context fails through registry",
            "parent_message_id": "om_report",
        },
    )
    assert await coordinator.handle(issue_request, send) is True

    fix_request = _request(
        "/fix",
        sender="ou_owner",
        message_id="om_fix_command",
        extras={"parent_message_id": "om_report"},
    )
    assert await coordinator.handle(fix_request, send) is True
    await coordinator.wait_idle()

    assert len(runner.calls) == 1
    assert runner.calls[0].issue_summary == "grep context fails through registry"
    assert replies[1] == "Repair started: grep context fails through registry."
    assert "pm_" not in replies[1]


async def test_fix_resolves_gitee_issue_and_deduplicates_separate_commands(tmp_path: Path) -> None:
    publisher = _IssuePublisher()
    runner = _Runner(MaintenanceOutcome(state=MaintenanceState.CANDIDATE_READY, base_commit="abc123"))
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(
            enabled=True,
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
            max_daily_fix_jobs=1,
        ),
        state_dir=tmp_path,
        runner=runner,
        issue_publisher=publisher,
    )
    replies = []

    async def send(content: str, media=()) -> None:
        replies.append(content)

    issue_url = "https://gitee.com/htxoffical/pico-harness/issues/I123ABC"
    assert (
        await coordinator.handle(
            _request(f"/fix {issue_url}", sender="ou_owner", message_id="om_fix_1"),
            send,
        )
        is True
    )
    await coordinator.wait_idle()
    assert (
        await coordinator.handle(
            _request(f"/fix {issue_url}", sender="ou_owner", message_id="om_fix_2"),
            send,
        )
        is True
    )
    await coordinator.wait_idle()

    assert len(runner.calls) == 1
    assert runner.calls[0].issue_ref == issue_url
    assert "BoxLite 0.9.5 rejects" in runner.calls[0].issue_summary
    assert runner.calls[0].issue_summary.count("BoxLite network policy fails") == 1
    assert replies[-1] == "Repair already exists for BoxLite network policy fails (candidate_ready)."


async def test_non_maintainer_cannot_start_fix_job(tmp_path: Path) -> None:
    runner = _Runner()
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(
            enabled=True,
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
        ),
        state_dir=tmp_path,
        runner=runner,
    )
    replies: list[str] = []

    async def send(content: str) -> None:
        replies.append(content)

    handled = await coordinator.handle(_request("/fix #123"), send)

    assert handled is True
    assert replies == ["Only a configured Pico maintainer can start /fix jobs."]
    assert runner.calls == []


async def test_fix_jobs_have_an_independent_daily_limit(tmp_path: Path) -> None:
    runner = _Runner(MaintenanceOutcome(state=MaintenanceState.BLOCKED, detail="test"))
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(
            enabled=True,
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
            max_daily_fix_jobs=1,
        ),
        state_dir=tmp_path,
        runner=runner,
    )
    replies: list[str] = []

    async def send(content: str, media=()) -> None:
        replies.append(content)

    assert await coordinator.handle(_request("/fix #123", sender="ou_owner", message_id="om_fix_1"), send) is True
    await coordinator.wait_idle()
    assert await coordinator.handle(_request("/fix #124", sender="ou_owner", message_id="om_fix_2"), send) is True
    await coordinator.wait_idle()

    assert [job.issue_ref for job in runner.calls] == ["#123"]
    assert replies[-1] == "今天的 1 次 Pico /fix 额度已用完，明天 00:00（北京时间）恢复。"


async def test_agent_turn_quota_survives_restart_and_resets_on_the_next_day(tmp_path: Path) -> None:
    now = [datetime(2026, 9, 2, 23, 59, tzinfo=ZoneInfo("Asia/Shanghai"))]
    config = MaintenanceConfig(
        enabled=True,
        allowed_chats=["oc_pico"],
        maintainers=["ou_owner"],
        max_daily_agent_turns_per_user=1,
    )
    coordinator = MaintenanceCoordinator(
        config,
        state_dir=tmp_path,
        runner=_Runner(),
        clock=lambda: now[0],
    )

    first = coordinator.admit_agent_turn(_request("question", sender="ou_member", message_id="om_day_1"))
    exhausted = coordinator.admit_agent_turn(_request("question", sender="ou_member", message_id="om_day_2"))
    assert first.admitted is True
    assert exhausted.admitted is False
    await coordinator.close()

    restarted = MaintenanceCoordinator(
        config,
        state_dir=tmp_path,
        runner=_Runner(),
        clock=lambda: now[0],
    )
    still_exhausted = restarted.admit_agent_turn(_request("question", sender="ou_member", message_id="om_day_3"))
    assert still_exhausted.admitted is False

    now[0] = datetime(2026, 9, 3, 0, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
    reset = restarted.admit_agent_turn(_request("question", sender="ou_member", message_id="om_day_4"))
    duplicate = restarted.admit_agent_turn(_request("question", sender="ou_member", message_id="om_day_4"))
    assert reset.admitted is True
    assert duplicate.admitted is False
    assert duplicate.message == ""


async def test_agent_turn_quota_scopes_platform_identifiers_by_channel(tmp_path: Path) -> None:
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(
            enabled=True,
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
            max_daily_agent_turns_per_user=1,
            max_daily_agent_turns_per_chat=1,
        ),
        state_dir=tmp_path,
        runner=_Runner(),
    )

    def request(channel: str, message_id: str) -> TurnRequest:
        return TurnRequest(
            origin=Origin.USER,
            source=Source(
                channel=channel,
                chat_id="shared_chat_id",
                sender_id="shared_sender_id",
                chat_type=ChatType.GROUP,
                extras={"message_id": message_id},
            ),
            text="question",
        )

    assert coordinator.admit_agent_turn(request("feishu", "shared_message_id")).admitted is True
    assert coordinator.admit_agent_turn(request("qq", "shared_message_id")).admitted is True
    assert coordinator.admit_agent_turn(request("feishu", "feishu_second")).admitted is False
    assert coordinator.admit_agent_turn(request("qq", "qq_second")).admitted is False


async def test_maintainer_fix_runs_once_and_reports_candidate(tmp_path: Path) -> None:
    candidate_dir = tmp_path / "candidate"
    candidate_dir.mkdir()
    candidate_report = candidate_dir / "CANDIDATE.md"
    candidate_patch = candidate_dir / "candidate.patch"
    candidate_report.write_text("candidate report", encoding="utf-8")
    candidate_patch.write_text("candidate patch", encoding="utf-8")
    runner = _Runner(
        MaintenanceOutcome(
            state=MaintenanceState.CANDIDATE_READY,
            base_commit="abc123",
            candidate_dir=candidate_dir,
            changed_files=("pico/example.py",),
        ),
        progress=("repairing", "repair checks", "clean verification"),
    )
    config = MaintenanceConfig(
        enabled=True,
        allowed_chats=["oc_pico"],
        maintainers=["ou_owner"],
    )
    coordinator = MaintenanceCoordinator(config, state_dir=tmp_path, runner=runner)
    replies: list[tuple[str, tuple[Path, ...]]] = []

    async def send(content: str, media: tuple[Path, ...] = ()) -> None:
        replies.append((content, media))

    request = _request("/fix #123", sender="ou_owner", message_id="om_same")
    assert await coordinator.handle(request, send) is True
    await coordinator.wait_idle()
    assert len(runner.calls) == 1
    assert runner.calls[0].issue_ref == "#123"
    assert runner.calls[0].source_message_id == "om_same"
    assert replies[0][0] == "Repair started: #123."
    assert [content for content, _media in replies if "Stage:" in content] == [
        "#123 - Stage: repairing.",
        "#123 - Stage: repair checks.",
        "#123 - Stage: clean verification.",
    ]
    assert replies[-1][0] == (
        "Candidate ready: #123\n"
        "Base revision: abc123\n"
        "Changed files: pico/example.py\n"
        "The review report and patch are attached."
    )
    assert replies[-1][1] == (candidate_report, candidate_patch)
    assert "pm_" not in replies[-1][0]
    assert str(tmp_path) not in replies[-1][0]

    restarted = MaintenanceCoordinator(config, state_dir=tmp_path, runner=runner)
    duplicate_replies: list[str] = []

    async def send_duplicate(content: str) -> None:
        duplicate_replies.append(content)

    assert await restarted.handle(request, send_duplicate) is True
    await restarted.wait_idle()
    assert len(runner.calls) == 1
    assert duplicate_replies == ["Repair already exists for #123 (candidate_ready)."]


async def test_fix_uses_structured_notices_when_a_maintenance_notifier_is_available(tmp_path: Path) -> None:
    candidate_dir = tmp_path / "candidate"
    candidate_dir.mkdir()
    (candidate_dir / "CANDIDATE.md").write_text("report", encoding="utf-8")
    (candidate_dir / "candidate.patch").write_text("patch", encoding="utf-8")
    runner = _Runner(
        MaintenanceOutcome(
            state=MaintenanceState.CANDIDATE_READY,
            base_commit="abc123",
            candidate_dir=candidate_dir,
            changed_files=("pico/example.py",),
        ),
        progress=("base locked", "reproducing and editing", "clean verification"),
    )
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(enabled=True, allowed_chats=["oc_pico"], maintainers=["ou_owner"]),
        state_dir=tmp_path,
        runner=runner,
    )
    text_replies = []
    notices = []

    async def send(content: str, media=()) -> None:
        text_replies.append((content, media))

    class Notifier:
        async def notify(self, notice) -> None:
            notices.append(notice)
            return "om_status_card"

    request = _request("/fix #123", sender="ou_owner", message_id="om_fix")
    assert await coordinator.handle(request, send, notifier=Notifier()) is True
    await coordinator.wait_idle()

    assert text_replies == []
    assert [notice.kind for notice in notices] == [
        MaintenanceNoticeKind.STARTED,
        MaintenanceNoticeKind.PROGRESS,
        MaintenanceNoticeKind.PROGRESS,
        MaintenanceNoticeKind.PROGRESS,
        MaintenanceNoticeKind.CANDIDATE_READY,
    ]
    assert notices[-1].base_commit == "abc123"
    assert [path.name for path in notices[-1].attachments] == ["CANDIDATE.md", "candidate.patch"]
    assert all(notice.message_link == notices[0].message_link for notice in notices)


async def test_failed_verification_does_not_attach_unverified_patch(tmp_path: Path) -> None:
    candidate_dir = tmp_path / "candidate"
    candidate_dir.mkdir()
    (candidate_dir / "CANDIDATE.md").write_text("failed report", encoding="utf-8")
    (candidate_dir / "candidate.patch").write_text("unverified patch", encoding="utf-8")
    runner = _Runner(
        MaintenanceOutcome(
            state=MaintenanceState.VERIFICATION_FAILED,
            base_commit="abc123",
            candidate_dir=candidate_dir,
            changed_files=("pico/example.py",),
            detail="tests failed",
        )
    )
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(enabled=True, allowed_chats=["oc_pico"], maintainers=["ou_owner"]),
        state_dir=tmp_path,
        runner=runner,
    )
    replies: list[tuple[str, tuple[Path, ...]]] = []

    async def send(content: str, media: tuple[Path, ...] = ()) -> None:
        replies.append((content, media))

    assert await coordinator.handle(_request("/fix #123", sender="ou_owner"), send) is True
    await coordinator.wait_idle()

    assert replies[-1][0].startswith("Verification failed: #123")
    assert replies[-1][1] == (candidate_dir / "CANDIDATE.md",)


async def test_gateway_restart_marks_orphaned_running_job_blocked(tmp_path: Path) -> None:
    from pico.maintenance.store import MaintenanceStore

    store = MaintenanceStore(tmp_path / "maintenance.db")
    job, _created = store.create_or_get(
        source_message_id="om_orphan",
        issue_ref="#123",
        chat_id="oc_pico",
        sender_id="ou_owner",
    )
    store.mark_running(job.job_id)
    store.close()

    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(
            enabled=True,
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
        ),
        state_dir=tmp_path,
        runner=_Runner(),
    )
    replies: list[str] = []

    async def send(content: str) -> None:
        replies.append(content)

    request = _request("/fix #123", sender="ou_owner", message_id="om_orphan")
    assert await coordinator.handle(request, send) is True
    assert replies == ["Repair already exists for #123 (blocked)."]


async def test_gateway_restart_recovers_persisted_status_card(tmp_path: Path) -> None:
    from pico.maintenance.store import MaintenanceStore

    store = MaintenanceStore(tmp_path / "maintenance.db")
    job, _created = store.create_or_get(
        source_message_id="om_orphan",
        issue_ref="#123",
        issue_key="number:123",
        chat_id="oc_pico",
        sender_id="ou_owner",
        message_link="https://applink.feishu.cn/client/thread/open?open_chat_id=oc_pico",
    )
    store.record_card_message(job.job_id, "om_status_card")
    store.mark_running(job.job_id)
    store.close()

    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(enabled=True, allowed_chats=["oc_pico"], maintainers=["ou_owner"]),
        state_dir=tmp_path,
        runner=_Runner(),
    )
    notices = []

    class Notifier:
        async def notify(self, notice):
            notices.append(notice)
            return notice.card_message_id

    await coordinator.recover(Notifier())

    assert len(notices) == 1
    assert notices[0].kind is MaintenanceNoticeKind.BLOCKED
    assert notices[0].card_message_id == "om_status_card"
    assert notices[0].message_link.startswith("https://applink.feishu.cn/")


async def test_feishu_mention_prefix_still_routes_fix_command(tmp_path: Path) -> None:
    runner = _Runner(MaintenanceOutcome(state=MaintenanceState.BLOCKED, detail="test"))
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(
            enabled=True,
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
        ),
        state_dir=tmp_path,
        runner=runner,
    )
    replies: list[str] = []

    async def send(content: str) -> None:
        replies.append(content)

    request = _request("@_user_1 /fix #123", sender="ou_owner")
    assert await coordinator.handle(request, send) is True
    await coordinator.wait_idle()
    assert len(runner.calls) == 1
    assert runner.calls[0].issue_ref == "#123"


async def test_fix_rejects_untrusted_issue_reference(tmp_path: Path) -> None:
    runner = _Runner()
    coordinator = MaintenanceCoordinator(
        MaintenanceConfig(
            enabled=True,
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
        ),
        state_dir=tmp_path,
        runner=runner,
    )
    replies: list[str] = []

    async def send(content: str) -> None:
        replies.append(content)

    assert await coordinator.handle(_request("/fix ../../private", sender="ou_owner"), send) is True
    assert replies == ["Usage: /fix <issue number, proposal ID, GitHub URL, or Gitee URL>"]
    assert runner.calls == []


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _repository(path: Path) -> Path:
    path.mkdir()
    _git(path, "init", "-b", "main")
    _git(path, "config", "user.email", "pico@example.com")
    _git(path, "config", "user.name", "Pico Test")
    (path / "behavior.txt").write_text("broken\n", encoding="utf-8")
    _git(path, "add", "behavior.txt")
    _git(path, "commit", "-m", "test: seed repository")
    return path


async def test_runner_replays_patch_and_writes_candidate_packet(tmp_path: Path) -> None:
    repo = _repository(tmp_path / "repo")

    def agent_command(_job, worktree: Path) -> list[str]:
        script = "from pathlib import Path; Path('behavior.txt').write_text('fixed\\n')"
        return [sys.executable, "-c", script]

    runner = GitMaintenanceRunner(
        repository=repo,
        base_ref="main",
        state_dir=tmp_path / "state",
        acceptance_commands=['test "$(cat behavior.txt)" = fixed'],
        agent_command=agent_command,
        agent_timeout_seconds=30,
        command_timeout_seconds=30,
    )
    job = MaintenanceJob("pm_test", "om_test", "#123", "oc_pico", "ou_owner")
    stages: list[str] = []

    async def progress(stage: str) -> None:
        stages.append(stage)

    outcome = await runner.run(job, progress)

    assert outcome.state is MaintenanceState.CANDIDATE_READY
    assert outcome.base_commit == _git(repo, "rev-parse", "main")
    assert outcome.changed_files == ("behavior.txt",)
    assert outcome.candidate_dir is not None
    assert stages == ["base locked", "reproducing and editing", "repair checks", "clean verification"]
    assert (outcome.candidate_dir / "candidate.patch").read_text(encoding="utf-8")
    manifest = json.loads((outcome.candidate_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["state"] == "candidate_ready"
    assert manifest["repair_checks"][0]["exit_code"] == 0
    assert manifest["verification_checks"][0]["exit_code"] == 0
    summary = (outcome.candidate_dir / "CANDIDATE.md").read_text(encoding="utf-8")
    assert 'test "$(cat behavior.txt)" = fixed' in summary
    assert "Repair exit: `0`" in summary
    assert "Verifier exit: `0`" in summary
    assert not (tmp_path / "state" / "runs" / "pm_test" / "repair").exists()
    assert not (tmp_path / "state" / "runs" / "pm_test" / "verify").exists()


async def test_runner_keeps_patch_but_fails_closed_when_clean_verifier_fails(tmp_path: Path) -> None:
    repo = _repository(tmp_path / "repo")

    def agent_command(_job, worktree: Path) -> list[str]:
        script = "from pathlib import Path; Path('behavior.txt').write_text('fixed\\n')"
        return [sys.executable, "-c", script]

    runner = GitMaintenanceRunner(
        repository=repo,
        base_ref="main",
        state_dir=tmp_path / "state",
        acceptance_commands=['test "$PICO_MAINTENANCE_PHASE" = repair'],
        agent_command=agent_command,
        agent_timeout_seconds=30,
        command_timeout_seconds=30,
    )

    outcome = await runner.run(MaintenanceJob("pm_fail", "om_fail", "#9", "oc_pico", "ou_owner"))

    assert outcome.state is MaintenanceState.VERIFICATION_FAILED
    assert outcome.candidate_dir is not None
    assert (outcome.candidate_dir / "candidate.patch").exists()
    manifest = json.loads((outcome.candidate_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["state"] == "verification_failed"
    assert manifest["repair_checks"][0]["exit_code"] == 0
    assert manifest["verification_checks"][0]["exit_code"] != 0


async def test_runner_rejects_temporary_reproduction_files(tmp_path: Path) -> None:
    repo = _repository(tmp_path / "repo")

    def agent_command(_job, _worktree: Path) -> list[str]:
        script = (
            "from pathlib import Path; "
            "Path('behavior.txt').write_text('fixed\\n'); "
            "Path('repro_issue_race.py').write_text('temporary\\n')"
        )
        return [sys.executable, "-c", script]

    runner = GitMaintenanceRunner(
        repository=repo,
        base_ref="main",
        state_dir=tmp_path / "state",
        acceptance_commands=["true"],
        agent_command=agent_command,
        agent_timeout_seconds=30,
        command_timeout_seconds=30,
    )

    outcome = await runner.run(MaintenanceJob("pm_scratch", "om_scratch", "#1", "oc_pico", "ou_owner"))

    assert outcome.state is MaintenanceState.VERIFICATION_FAILED
    assert "temporary or runtime artifacts" in outcome.detail
    assert "repro_issue_race.py" in outcome.changed_files


async def test_runner_rejects_issue_from_another_repository(tmp_path: Path) -> None:
    repo = _repository(tmp_path / "repo")
    _git(repo, "remote", "add", "origin", "https://github.com/example/pico.git")
    called = False

    def agent_command(_job, _worktree: Path) -> list[str]:
        nonlocal called
        called = True
        return [sys.executable, "-c", "raise SystemExit(99)"]

    runner = GitMaintenanceRunner(
        repository=repo,
        base_ref="main",
        state_dir=tmp_path / "state",
        acceptance_commands=["true"],
        agent_command=agent_command,
        agent_timeout_seconds=30,
        command_timeout_seconds=30,
    )

    outcome = await runner.run(
        MaintenanceJob(
            "pm_scope",
            "om_scope",
            "https://github.com/other/project/issues/1",
            "oc_pico",
            "ou_owner",
        )
    )

    assert outcome.state is MaintenanceState.BLOCKED
    assert "outside configured repository" in outcome.detail
    assert called is False


async def test_runner_accepts_gitee_issue_from_configured_repository(tmp_path: Path) -> None:
    repo = _repository(tmp_path / "repo")
    _git(repo, "remote", "add", "origin", "https://gitee.com/htxoffical/pico-harness.git")
    runner = GitMaintenanceRunner(
        repository=repo,
        base_ref="main",
        state_dir=tmp_path / "state",
        acceptance_commands=["true"],
        agent_command=lambda _job, _worktree: [sys.executable, "-c", "raise SystemExit(1)"],
        agent_timeout_seconds=30,
        command_timeout_seconds=30,
    )

    issue = "https://gitee.com/htxoffical/pico-harness/issues/I123ABC"
    validated, error = await runner._validated_issue_ref(
        MaintenanceJob("pm_gitee", "om_gitee", issue, "oc_pico", "ou_owner")
    )

    assert validated == issue
    assert error == ""


def test_container_checks_mount_only_worktree_and_git_metadata(tmp_path: Path) -> None:
    repo = _repository(tmp_path / "repo")
    worktree = tmp_path / "repair"
    worktree.mkdir()
    runner = GitMaintenanceRunner(
        repository=repo,
        base_ref="main",
        state_dir=tmp_path / "state",
        acceptance_commands=["true"],
        agent_command=lambda _job, _worktree: ["agent"],
        agent_timeout_seconds=30,
        command_timeout_seconds=30,
        check_container_image="pico-maintenance-checks:0.1.0",
    )

    argv = runner._container_check_argv(worktree, "uv run pytest -q", "verify")

    assert argv[:3] == ("docker", "run", "--rm")
    assert "pico-maintenance-checks:0.1.0" in argv
    volumes = [argv[index + 1] for index, item in enumerate(argv) if item == "--volume"]
    assert volumes == [f"{worktree}:{worktree}:rw", f"{repo / '.git'}:{repo / '.git'}:ro"]
    assert all(str(Path.home()) not in volume for volume in volumes)


def test_factory_fails_closed_when_enabled_configuration_is_incomplete(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="allowedChats.*maintainers.*acceptanceCommands.*runnerConfig"):
        build_maintenance_coordinator(
            MaintenanceConfig(enabled=True),
            workspace=tmp_path,
            state_dir=tmp_path / "state",
        )


def test_factory_uses_private_runner_home_and_never_requires_github_credentials(tmp_path: Path) -> None:
    repo = _repository(tmp_path / "repo")
    runner_config = tmp_path / "runner.json"
    runner_config.write_text("{}", encoding="utf-8")
    state_dir = tmp_path / "state"

    coordinator = build_maintenance_coordinator(
        MaintenanceConfig(
            enabled=True,
            repository=str(repo),
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
            acceptance_commands=["true"],
            runner_config=str(runner_config),
        ),
        workspace=repo,
        state_dir=state_dir,
    )

    assert coordinator is not None
    assert state_dir.stat().st_mode & 0o777 == 0o700
    private_home = state_dir / "runner-home"
    assert private_home.stat().st_mode & 0o777 == 0o700
    assert coordinator.runner.agent_environment["HOME"] == str(private_home)
    assert coordinator.runner.agent_environment["PICO_HOME"] == str(private_home / ".pico")
    assert "GH_TOKEN" not in coordinator.runner.agent_environment
    assert "GITHUB_TOKEN" not in coordinator.runner.agent_environment
    command = coordinator.runner.agent_command(
        MaintenanceJob("pm_test", "om_test", "#1", "oc_pico", "ou_owner"),
        repo,
    )
    assert "--workspace" not in command
    assert "use relative paths" in command[-1]
    assert "do not use `--all-extras`" in command[-1]


def test_factory_builds_gitee_publisher_from_private_token_file(tmp_path: Path) -> None:
    repo = _repository(tmp_path / "repo")
    runner_config = tmp_path / "runner.json"
    runner_config.write_text("{}", encoding="utf-8")
    token_file = tmp_path / "gitee-issues.token"
    token_file.write_text("test-token\n", encoding="utf-8")
    token_file.chmod(0o600)

    coordinator = build_maintenance_coordinator(
        MaintenanceConfig(
            enabled=True,
            repository=str(repo),
            allowed_chats=["oc_pico"],
            maintainers=["ou_owner"],
            acceptance_commands=["true"],
            runner_config=str(runner_config),
            issue_tracker="gitee",
            issue_repository="htxoffical/pico-harness",
            issue_token_file=str(token_file),
            check_container_image="pico-maintenance-checks:0.1.0",
        ),
        workspace=repo,
        state_dir=tmp_path / "state",
    )

    assert coordinator is not None
    assert isinstance(coordinator.issue_publisher, GiteeIssuePublisher)
    assert coordinator.runner.check_container_image == "pico-maintenance-checks:0.1.0"


def test_factory_rejects_world_readable_gitee_token(tmp_path: Path) -> None:
    repo = _repository(tmp_path / "repo")
    runner_config = tmp_path / "runner.json"
    runner_config.write_text("{}", encoding="utf-8")
    token_file = tmp_path / "gitee-issues.token"
    token_file.write_text("test-token\n", encoding="utf-8")
    token_file.chmod(0o644)

    with pytest.raises(ValueError, match="must not be readable"):
        build_maintenance_coordinator(
            MaintenanceConfig(
                enabled=True,
                repository=str(repo),
                allowed_chats=["oc_pico"],
                maintainers=["ou_owner"],
                acceptance_commands=["true"],
                runner_config=str(runner_config),
                issue_tracker="gitee",
                issue_repository="htxoffical/pico-harness",
                issue_token_file=str(token_file),
            ),
            workspace=repo,
            state_dir=tmp_path / "state",
        )


async def test_runner_kills_agent_process_when_job_is_cancelled(tmp_path: Path, monkeypatch) -> None:
    class Process:
        returncode = None
        killed = False
        waited = False

        async def communicate(self):
            await asyncio.Event().wait()

        def kill(self):
            self.killed = True

        async def wait(self):
            self.waited = True
            self.returncode = -9

    process = Process()

    async def create_process(*_args, **_kwargs):
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    runner = GitMaintenanceRunner(
        repository=tmp_path,
        base_ref="main",
        state_dir=tmp_path / "state",
        acceptance_commands=["true"],
        agent_command=lambda _job, _worktree: ["agent"],
        agent_timeout_seconds=30,
        command_timeout_seconds=30,
    )

    task = asyncio.create_task(runner._run_exec(("agent",), cwd=tmp_path, timeout=30))
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert process.killed is True
    assert process.waited is True

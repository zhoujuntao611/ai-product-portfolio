"""Tests for the feishu adapter package — inbound content extraction
(content.py), outbound format detection/rendering (cards.py), and group
mention gating. Pure surface; no lark SDK / live connection."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from pico.channels.adapters.feishu import cards, content, maintenance_cards
from pico.channels.adapters.feishu.channel import FeishuChannel
from pico.channels.adapters.feishu.maintenance_cards import FeishuMaintenanceNotifier
from pico.channels.outlet import ChannelOutletAdapter
from pico.maintenance.notifications import MaintenanceNotice, MaintenanceNoticeKind
from pico.spine import ChatType, Notice, NoticeKind, Source, Text
from pico.spine.delivery import DeliveryHub, TerminalDeliveryError


def _channel(group_policy="open"):
    cfg = SimpleNamespace(
        app_id="a",
        app_secret="s",
        encrypt_key="",
        verification_token="",
        group_policy=group_policy,
        react_emoji="THUMBSUP",
    )
    return FeishuChannel(cfg)


def test_extract_post_direct():
    payload = {"title": "T", "content": [[{"tag": "text", "text": "hello"}]]}
    text, images = content.extract_post(payload)
    assert "T" in text and "hello" in text
    assert images == []


def test_extract_post_localized_and_image():
    payload = {
        "zh_cn": {
            "content": [
                [
                    {"tag": "text", "text": "hi"},
                    {"tag": "img", "image_key": "img_k1"},
                ]
            ]
        }
    }
    text, images = content.extract_post(payload)
    assert "hi" in text
    assert images == ["img_k1"]


def test_extract_post_wrapped_envelope_and_at():
    payload = {"post": {"zh_cn": {"content": [[{"tag": "at", "user_name": "bob"}]]}}}
    text, _ = content.extract_post(payload)
    assert "@bob" in text


def test_extract_post_empty():
    assert content.extract_post({}) == ("", [])


def test_extract_share_chat():
    assert content.extract_share_card({"chat_id": "oc_x"}, "share_chat") == "[shared chat: oc_x]"


def test_extract_system_message():
    assert content.extract_share_card({}, "system") == "[system message]"


def test_extract_interactive_pulls_markdown():
    card = {"elements": [[{"tag": "markdown", "content": "card body"}]]}
    assert "card body" in content.extract_share_card(card, "interactive")


def test_extract_element_link():
    assert content.extract_element({"tag": "a", "href": "http://u", "text": "label"}) == [
        "link: http://u",
        "label",
    ]


@pytest.mark.parametrize(
    "text, fmt",
    [
        ("hello there", "text"),
        ("**bold**", "interactive"),
        ("```code```", "interactive"),
        ("| a | b |\n| - | - |\n| 1 | 2 |", "interactive"),
        ("- item one\n- item two", "interactive"),
        ("see [docs](http://u)", "post"),
        ("x" * 250, "post"),
        ("y" * 2100, "interactive"),
    ],
)
def test_detect_format(text, fmt):
    assert cards.detect_format(text) == fmt


def test_post_payload_renders_link():
    import json

    payload = json.loads(cards.post_payload("see [docs](http://u) now"))
    tags = [el["tag"] for para in payload["zh_cn"]["content"] for el in para]
    assert "a" in tags and "text" in tags


def test_parse_table():
    table = cards.parse_table("| a | b |\n| - | - |\n| 1 | 2 |")
    assert table["tag"] == "table"
    assert len(table["columns"]) == 2
    assert table["rows"][0] == {"c0": "1", "c1": "2"}


def test_parse_table_rejects_non_table():
    assert cards.parse_table("not | a table") is None


def test_card_payloads_split_multiple_tables():
    two = "| a |\n| - |\n| 1 |\n\ntext\n\n| b |\n| - |\n| 2 |"
    payloads = cards.card_payloads(two)
    assert len(payloads) == 2


def test_maintenance_issue_card_uses_card_v2_without_changing_normal_renderer():
    normal_payload = cards.card_payloads("**ordinary answer**")
    notice = MaintenanceNotice(
        key="pi_123456789abc",
        kind=MaintenanceNoticeKind.ISSUE_CAPTURED,
        source=Source(
            channel="feishu",
            chat_id="oc_pico",
            sender_id="ou_owner",
            chat_type=ChatType.GROUP,
            extras={"message_id": "om_issue"},
        ),
        title="grep context <script> is incomplete",
        message_link="https://applink.feishu.cn/client/thread/open?open_chat_id=oc_pico",
        issue_url="https://gitee.com/htxoffical/pico-harness/issues/I123ABC",
    )

    payload = maintenance_cards.render_card(notice)

    assert payload["schema"] == "2.0"
    assert payload["header"]["template"] == "blue"
    assert payload["header"]["title"]["content"] == "Gitee Issue 已创建"
    assert payload["header"]["text_tag_list"][0]["text"]["content"] == "待修复"
    assert payload["card_link"]["url"].startswith("https://gitee.com/")
    assert "查看 Gitee Issue" in str(payload["body"])
    assert "查看原始消息" in str(payload["body"])
    assert "'tag': 'action'" not in str(payload["body"])
    assert "open_url" in str(payload["body"])
    assert payload["body"]["elements"][0]["text"]["content"] == "grep context <script> is incomplete"
    assert normal_payload == cards.card_payloads("**ordinary answer**")


async def test_maintenance_progress_updates_the_started_card_in_place():
    channel = SimpleNamespace(
        reply_card=AsyncMock(return_value="om_status_card"),
        update_card=AsyncMock(),
        reply=AsyncMock(),
    )
    notifier = FeishuMaintenanceNotifier(channel)
    source = Source(
        channel="feishu",
        chat_id="oc_pico",
        sender_id="ou_owner",
        chat_type=ChatType.GROUP,
        extras={"message_id": "om_fix"},
    )

    await notifier.notify(
        MaintenanceNotice(
            key="pm_123456789abc",
            kind=MaintenanceNoticeKind.STARTED,
            source=source,
            title="grep context is incomplete",
            message_link="https://applink.feishu.cn/client/thread/open?open_chat_id=oc_pico",
            issue_url="https://gitee.com/htxoffical/pico-harness/issues/I123ABC",
        )
    )
    await notifier.notify(
        MaintenanceNotice(
            key="pm_123456789abc",
            kind=MaintenanceNoticeKind.PROGRESS,
            source=source,
            title="grep context is incomplete",
            stage="reproducing and editing",
            message_link="https://applink.feishu.cn/client/thread/open?open_chat_id=oc_pico",
            issue_url="https://gitee.com/htxoffical/pico-harness/issues/I123ABC",
        )
    )

    channel.reply_card.assert_awaited_once()
    channel.update_card.assert_awaited_once()
    assert channel.update_card.await_args.args[0] == "om_status_card"
    assert channel.update_card.await_args.args[1]["schema"] == "2.0"
    assert channel.update_card.await_args.args[1]["card_link"]["url"].startswith("https://gitee.com/")
    assert "查看原始消息" in str(channel.update_card.await_args.args[1]["body"])
    channel.reply.assert_not_awaited()


async def test_recovered_terminal_notice_updates_persisted_card_without_replying():
    channel = SimpleNamespace(
        reply_card=AsyncMock(),
        update_card=AsyncMock(),
        reply=AsyncMock(),
    )
    notifier = FeishuMaintenanceNotifier(channel)
    source = Source(
        channel="feishu",
        chat_id="oc_pico",
        sender_id="ou_owner",
        chat_type=ChatType.GROUP,
        extras={"message_id": "om_fix"},
    )

    card_id = await notifier.notify(
        MaintenanceNotice(
            key="pm_123456789abc",
            kind=MaintenanceNoticeKind.BLOCKED,
            source=source,
            title="grep context is incomplete",
            detail="Gateway restarted before completion",
            card_message_id="om_status_card",
        )
    )

    assert card_id == "om_status_card"
    channel.reply_card.assert_not_awaited()
    channel.update_card.assert_awaited_once()


async def test_candidate_ready_updates_the_card_and_sends_verified_artifacts(tmp_path):
    report = tmp_path / "CANDIDATE.md"
    patch = tmp_path / "candidate.patch"
    report.write_text("report", encoding="utf-8")
    patch.write_text("patch", encoding="utf-8")
    channel = SimpleNamespace(
        reply_card=AsyncMock(return_value="om_status_card"),
        update_card=AsyncMock(),
        reply=AsyncMock(),
    )
    notifier = FeishuMaintenanceNotifier(channel)
    source = Source(
        channel="feishu",
        chat_id="oc_pico",
        sender_id="ou_owner",
        chat_type=ChatType.GROUP,
        extras={"message_id": "om_fix"},
    )
    await notifier.notify(
        MaintenanceNotice(
            key="pm_123456789abc",
            kind=MaintenanceNoticeKind.STARTED,
            source=source,
            title="grep context is incomplete",
        )
    )

    await notifier.notify(
        MaintenanceNotice(
            key="pm_123456789abc",
            kind=MaintenanceNoticeKind.CANDIDATE_READY,
            source=source,
            title="grep context is incomplete",
            base_commit="abc1234",
            changed_files=("pico/grep.py", "tests/test_grep.py"),
            attachments=(report, patch),
        )
    )

    payload = channel.update_card.await_args.args[1]
    assert payload["header"]["template"] == "green"
    assert payload["header"]["text_tag_list"][0]["text"]["content"] == "验证通过"
    channel.reply.assert_awaited_once_with(
        "om_fix",
        "",
        media=[str(report), str(patch)],
        in_thread=True,
    )


async def test_verification_failure_updates_red_card_without_sending_patch(tmp_path):
    failure_report = tmp_path / "CANDIDATE.md"
    failure_report.write_text("failed checks", encoding="utf-8")
    channel = SimpleNamespace(
        reply_card=AsyncMock(return_value="om_status_card"),
        update_card=AsyncMock(),
        reply=AsyncMock(),
    )
    notifier = FeishuMaintenanceNotifier(channel)
    source = Source(
        channel="feishu",
        chat_id="oc_pico",
        sender_id="ou_owner",
        chat_type=ChatType.GROUP,
        extras={"message_id": "om_fix"},
    )
    await notifier.notify(
        MaintenanceNotice(
            key="pm_123456789abc",
            kind=MaintenanceNoticeKind.STARTED,
            source=source,
            title="grep context is incomplete",
        )
    )

    await notifier.notify(
        MaintenanceNotice(
            key="pm_123456789abc",
            kind=MaintenanceNoticeKind.VERIFICATION_FAILED,
            source=source,
            title="grep context is incomplete",
            base_commit="abc1234",
            changed_files=("pico/grep.py",),
            stage="repair checks",
            detail="Clean verifier checks failed",
            attachments=(failure_report,),
        )
    )

    payload = channel.update_card.await_args.args[1]
    assert payload["header"]["template"] == "red"
    assert payload["header"]["text_tag_list"][0]["text"]["content"] == "未交付 Patch"
    assert "3/4 运行项目验收测试" in str(payload["body"])
    channel.reply.assert_awaited_once_with(
        "om_fix",
        "",
        media=[str(failure_report)],
        in_thread=True,
    )

    await notifier.notify(
        MaintenanceNotice(
            key="pm_123456789abc",
            kind=MaintenanceNoticeKind.HEARTBEAT,
            source=source,
            title="grep context is incomplete",
            stage="clean verification",
            elapsed_seconds=240,
        )
    )
    assert channel.update_card.await_count == 1


def test_blocked_maintenance_card_requests_maintainer_input():
    payload = maintenance_cards.render_card(
        MaintenanceNotice(
            key="pm_123456789abc",
            kind=MaintenanceNoticeKind.BLOCKED,
            source=Source("feishu", "oc_pico", "ou_owner", ChatType.GROUP),
            title="grep context is incomplete",
            detail="Agent produced no patch",
        )
    )

    assert payload["header"]["template"] == "orange"
    assert payload["header"]["text_tag_list"][0]["text"]["content"] == "需要处理"
    assert "Agent produced no patch" in str(payload["body"])


def test_mentioned_via_at_all():
    ch = _channel(group_policy="mention")
    msg = SimpleNamespace(content="hi @_all", mentions=None)
    assert ch._is_bot_mentioned(msg) is True


def test_mentioned_via_bot_open_id():
    ch = _channel(group_policy="mention")
    mention = SimpleNamespace(id=SimpleNamespace(user_id=None, open_id="ou_bot1"))
    msg = SimpleNamespace(content="hey", mentions=[mention])
    assert ch._is_bot_mentioned(msg) is True


def test_not_mentioned():
    ch = _channel(group_policy="mention")
    user_mention = SimpleNamespace(id=SimpleNamespace(user_id="u_1", open_id="ou_user"))
    msg = SimpleNamespace(content="hey", mentions=[user_mention])
    assert ch._is_bot_mentioned(msg) is False


def test_open_policy_addresses_all():
    ch = _channel(group_policy="open")
    msg = SimpleNamespace(content="hey", mentions=None)
    assert ch._addressed_to_bot(msg) is True


def test_transcribe_prefers_native_feishu_stt(monkeypatch):
    ch = _channel()
    ch._lark_stt_sync = lambda _path: "native text"
    groq = AsyncMock(return_value="groq text")
    monkeypatch.setattr("pico.channels.adapters.feishu.channel.transcribe_audio", groq)
    assert asyncio.run(ch._transcribe("/tmp/a.opus")) == "native text"
    groq.assert_not_called()


def test_transcribe_falls_back_to_groq(monkeypatch):
    ch = _channel()
    ch._lark_stt_sync = lambda _path: None
    groq = AsyncMock(return_value="groq text")
    monkeypatch.setattr("pico.channels.adapters.feishu.channel.transcribe_audio", groq)
    assert asyncio.run(ch._transcribe("/tmp/a.opus")) == "groq text"
    groq.assert_awaited_once()


def test_transcribe_skips_native_once_disabled(monkeypatch):
    ch = _channel()
    ch._native_stt_disabled = True
    calls = []
    ch._lark_stt_sync = lambda _path: calls.append(1) or "unused"
    monkeypatch.setattr(
        "pico.channels.adapters.feishu.channel.transcribe_audio",
        AsyncMock(return_value="groq text"),
    )
    assert asyncio.run(ch._transcribe("/tmp/a.opus")) == "groq text"
    assert calls == []


def test_on_message_disallowed_sender_skips_react_and_download():
    """Denied sender is rejected before _react (network) and _extract (media
    download), not merely dropped at the central intake."""
    ch = _channel()
    ch.config.allow_from = []
    ch._react = AsyncMock()
    ch._extract = AsyncMock()
    ch.intake.publish = AsyncMock()
    msg = SimpleNamespace(message_id="m1", chat_type="p2p", message_type="text", content="{}")
    sender = SimpleNamespace(sender_type="user", sender_id=SimpleNamespace(open_id="other"))
    data = SimpleNamespace(event=SimpleNamespace(message=msg, sender=sender))
    asyncio.run(ch._on_message(data))
    ch._react.assert_not_awaited()
    ch._extract.assert_not_awaited()
    ch.intake.publish.assert_not_awaited()


def test_send_text_reaches_sdk_with_chat_id_and_content():
    """send(chat_id, content) drives the lark message.create call with that
    content and chat_id; no media upload, no threading/reply params."""
    ch = _channel()
    ch._client = MagicMock()
    ch._client.im.v1.message.create.return_value = SimpleNamespace(success=lambda: True)
    ch._upload_image_sync = MagicMock()
    ch._upload_file_sync = MagicMock()
    asyncio.run(ch.send("oc_1", "hello world"))
    ch._upload_image_sync.assert_not_called()
    ch._upload_file_sync.assert_not_called()
    request = ch._client.im.v1.message.create.call_args.args[0]
    body = request.request_body
    assert body.receive_id == "oc_1"
    assert "hello world" in body.content


def test_reply_text_uses_message_reply_in_thread():
    ch = _channel()
    ch._client = MagicMock()
    ch._client.im.v1.message.reply.return_value = SimpleNamespace(
        success=lambda: True,
        data=SimpleNamespace(message_id="om_reply"),
    )

    asyncio.run(ch.reply("om_parent", "hello", in_thread=True))

    ch._client.im.v1.message.create.assert_not_called()
    request = ch._client.im.v1.message.reply.call_args.args[0]
    assert request.message_id == "om_parent"
    assert request.request_body.reply_in_thread is True
    assert "hello" in request.request_body.content


def test_reply_card_returns_message_id_without_using_normal_text_renderer():
    ch = _channel()
    ch._client = MagicMock()
    ch._client.im.v1.message.reply.return_value = SimpleNamespace(
        success=lambda: True,
        data=SimpleNamespace(message_id="om_card"),
    )
    ch._reply_text = AsyncMock()

    message_id = asyncio.run(
        ch.reply_card(
            "om_parent",
            {"schema": "2.0", "header": {"title": {"tag": "plain_text", "content": "Status"}}},
            in_thread=True,
            idempotency_key="pm_123456789abc",
        )
    )

    assert message_id == "om_card"
    ch._reply_text.assert_not_awaited()
    request = ch._client.im.v1.message.reply.call_args.args[0]
    assert request.request_body.msg_type == "interactive"
    assert request.request_body.reply_in_thread is True
    assert request.request_body.uuid == "pm_123456789abc"


def test_update_card_patches_only_the_managed_message():
    ch = _channel()
    ch._client = MagicMock()
    ch._client.im.v1.message.patch.return_value = SimpleNamespace(success=lambda: True)
    payload = {"schema": "2.0", "header": {"title": {"tag": "plain_text", "content": "Done"}}}

    asyncio.run(ch.update_card("om_card", payload))

    ch._client.im.v1.message.reply.assert_not_called()
    ch._client.im.v1.message.create.assert_not_called()
    request = ch._client.im.v1.message.patch.call_args.args[0]
    assert request.message_id == "om_card"
    assert '"schema": "2.0"' in request.request_body.content


def test_send_media_uploads_and_posts_file_key():
    """send(chat_id, "", media=[path]) uploads the media and posts its key;
    empty content sends no text message."""
    ch = _channel()
    ch._client = MagicMock()
    ch._client.im.v1.message.create.return_value = SimpleNamespace(success=lambda: True)
    ch._upload_file_sync = MagicMock(return_value="file_k1")
    ch._send_text = AsyncMock()
    import os

    monkey = os.path.isfile
    os.path.isfile = lambda _p: True
    try:
        asyncio.run(ch.send("ou_user", "", media=["/tmp/doc.pdf"]))
    finally:
        os.path.isfile = monkey
    ch._upload_file_sync.assert_called_once_with("/tmp/doc.pdf")
    ch._send_text.assert_not_awaited()
    request = ch._client.im.v1.message.create.call_args.args[0]
    assert "file_k1" in request.request_body.content


def test_send_reraises_transient_for_delivery_retry():
    """requests-level network errors from the lark executor propagate so the
    delivery hub can back off."""
    import pytest
    import requests

    ch = _channel()
    ch._client = object()
    ch._send_text = AsyncMock(side_effect=requests.exceptions.ConnectionError("down"))
    with pytest.raises(requests.exceptions.ConnectionError):
        asyncio.run(ch.send("oc_1", "hi"))


def test_send_wraps_permanent_error_as_terminal_delivery_failure():
    ch = _channel()
    ch._client = object()
    ch._send_text = AsyncMock(side_effect=RuntimeError("lark errcode"))
    with pytest.raises(TerminalDeliveryError, match="lark errcode"):
        asyncio.run(ch.send("oc_1", "hi"))


async def test_feishu_business_failure_is_reported_as_dropped_delivery():
    ch = _channel()
    ch._client = MagicMock()
    ch._client.im.v1.message.create.return_value = SimpleNamespace(
        success=lambda: False,
        code=230001,
        msg="invalid receive id",
        get_log_id=lambda: "log_42",
    )
    notices: list[Notice] = []

    async def capture(notice: Notice) -> None:
        notices.append(notice)

    hub = DeliveryHub(on_delivery_failure=capture)
    hub.register(ChannelOutletAdapter(ch))
    source = Source(channel="feishu", chat_id="oc_1", sender_id="ou_user", chat_type=ChatType.GROUP)
    try:
        await hub.dispatch(Text(content="hello", source=source, conversation_id="feishu:oc_1"))
        await hub.wait_idle("feishu")
    finally:
        await hub.aclose()

    assert [notice.kind for notice in notices] == [NoticeKind.DELIVERY_FAILED]
    ch._client.im.v1.message.create.assert_called_once()


def test_stop_blocks_zombie_inbound(monkeypatch):
    """lark's ws client has no stop(); after stop() the socket may keep
    delivering — the sync bridge must drop those, or a restarted instance
    double-publishes (stop contract #1/#3)."""
    ch = _channel()
    ch._loop = MagicMock()
    ch._loop.is_running.return_value = True
    calls = []
    monkeypatch.setattr(asyncio, "run_coroutine_threadsafe", lambda *a, **k: calls.append(a))
    ch._running = True
    ch._on_message_sync(MagicMock())
    assert len(calls) == 1
    ch._running = False
    ch._on_message_sync(MagicMock())
    assert len(calls) == 1


async def test_quiesced_intake_drops_scheduled_handler_that_resumes_after_stop():
    ch = _channel()
    ch.config.allow_from = ["*"]
    ch._running = True
    ch._react = AsyncMock()
    extraction_started = asyncio.Event()
    resume_extraction = asyncio.Event()

    async def extract(msg_type, message, message_id):
        extraction_started.set()
        await resume_extraction.wait()
        return "late inbound", []

    ch._extract = extract
    submit = AsyncMock()
    ch.intake.set_submit(submit)
    handler = asyncio.create_task(ch._on_message(_inbound_event()))
    await extraction_started.wait()

    ch.intake.seal()
    await ch.intake.wait_idle()
    await ch.stop()
    resume_extraction.set()
    await handler

    submit.assert_not_awaited()


def test_feishu_satisfies_channel_contract():
    from pico.channels import Channel
    from pico.channels.contract import capability_violations

    ch = _channel()
    assert isinstance(ch, Channel)
    assert capability_violations(ch) == []


def test_feishu_spec_import_is_cheap():
    """Importing feishu.spec must NOT pull in lark_oapi (deferred into
    SPEC.factory)."""
    import subprocess
    import sys

    code = (
        "import sys, pico.channels.adapters.feishu.spec as s;"
        "assert 'lark_oapi' not in sys.modules, 'spec import pulled in lark_oapi';"
        "assert callable(s.SPEC.factory) and s.SPEC.display_name == 'Feishu';"
        "assert s.SPEC.maturity == 'live-gated'"
    )
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def _capture_info_logs():
    from loguru import logger

    lines: list[str] = []
    sink_id = logger.add(lambda m: lines.append(str(m).rstrip("\n")), level="INFO", format="{message}")
    return logger, sink_id, lines


def _inbound_event(
    message_id="m1",
    sender="ou_user",
    parent_id=None,
    thread_id=None,
    *,
    chat_type="p2p",
    chat_id="oc_pico",
):
    msg = SimpleNamespace(
        message_id=message_id,
        parent_id=parent_id,
        root_id=None,
        thread_id=thread_id,
        chat_id=chat_id,
        chat_type=chat_type,
        message_type="text",
        content="{}",
    )
    snd = SimpleNamespace(sender_type="user", sender_id=SimpleNamespace(open_id=sender))
    return SimpleNamespace(event=SimpleNamespace(message=msg, sender=snd))


def test_inbound_accept_emits_receipt():
    """An accepted inbound event logs a content-free receipt; the live Feishu
    Gate (V-LF) greps this exact marker, so the wording is a contract."""
    ch = _channel()
    ch.config.allow_from = ["*"]
    ch._react = AsyncMock()
    ch._extract = AsyncMock(return_value=("hi", []))
    ch.intake.publish = AsyncMock()
    logger, sink_id, lines = _capture_info_logs()
    try:
        asyncio.run(ch._on_message(_inbound_event()))
    finally:
        logger.remove(sink_id)
    receipts = [ln for ln in lines if "Feishu inbound accepted:" in ln]
    assert receipts == ["Feishu inbound accepted: message_id=m1 chat_type=p2p msg_type=text"]
    ch.intake.publish.assert_awaited_once()


def test_issue_reply_fetches_parent_text_and_thread_link_into_metadata():
    ch = _channel()
    ch.config.allow_from = ["*"]
    ch._react = AsyncMock()
    ch._extract = AsyncMock(return_value=("@_user_1 /issue", []))
    ch._fetch_message_text = AsyncMock(return_value="reported grep failure")
    ch.intake.publish = AsyncMock()

    asyncio.run(
        ch._on_message(
            _inbound_event(
                parent_id="om_report",
                thread_id="omt_report",
                chat_type="group",
            )
        )
    )

    ch._fetch_message_text.assert_awaited_once_with("om_report")
    metadata = ch.intake.publish.await_args.kwargs["metadata"]
    assert metadata["parent_message_id"] == "om_report"
    assert metadata["quoted_text"] == "reported grep failure"
    assert metadata["message_link"] == (
        "https://applink.feishu.cn/client/thread/open?open_chat_id=oc_pico&open_thread_id=omt_report"
    )


def test_fetch_message_text_reads_parent_via_feishu_api():
    ch = _channel()
    ch._client = MagicMock()
    item = SimpleNamespace(
        msg_type="text",
        body=SimpleNamespace(content='{"text":"reported failure"}'),
    )
    ch._client.im.v1.message.get.return_value = SimpleNamespace(
        success=lambda: True,
        data=SimpleNamespace(items=[item]),
    )

    result = ch._fetch_message_text_sync("om_parent")

    assert result == "reported failure"
    request = ch._client.im.v1.message.get.call_args.args[0]
    assert request.message_id == "om_parent"


def test_duplicate_event_emits_suppression_receipt():
    ch = _channel()
    ch.config.allow_from = ["*"]
    ch._react = AsyncMock()
    ch._extract = AsyncMock(return_value=("hi", []))
    ch.intake.publish = AsyncMock()
    logger, sink_id, lines = _capture_info_logs()
    try:
        asyncio.run(ch._on_message(_inbound_event()))
        asyncio.run(ch._on_message(_inbound_event()))
    finally:
        logger.remove(sink_id)
    assert any("Feishu duplicate event suppressed: message_id=m1" in ln for ln in lines)
    ch.intake.publish.assert_awaited_once()


def test_allowlist_reject_emits_receipt():
    ch = _channel()
    ch.config.allow_from = []
    ch.intake.publish = AsyncMock()
    logger, sink_id, lines = _capture_info_logs()
    try:
        asyncio.run(ch._on_message(_inbound_event(sender="ou_intruder")))
    finally:
        logger.remove(sink_id)
    assert any("Feishu inbound rejected by allowlist: sender=ou_intruder" in ln for ln in lines)
    ch.intake.publish.assert_not_awaited()


def test_send_success_emits_receipt_with_message_id():
    ch = _channel()
    ch._client = MagicMock()
    ch._client.im.v1.message.create.return_value = SimpleNamespace(
        success=lambda: True,
        data=SimpleNamespace(message_id="om_42"),
    )
    logger, sink_id, lines = _capture_info_logs()
    try:
        asyncio.run(ch.send("oc_1", "hello"))
    finally:
        logger.remove(sink_id)
    assert any("Feishu message sent: msg_type=text message_id=om_42" in ln for ln in lines)

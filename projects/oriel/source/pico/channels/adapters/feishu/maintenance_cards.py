from __future__ import annotations

import asyncio
from typing import Any

from pico.maintenance.notifications import MaintenanceNotice, MaintenanceNoticeKind
from pico.spine import ChatType

_STAGES = (
    ("base locked", "锁定基准版本"),
    ("reproducing and editing", "复现问题并修改代码"),
    ("repair checks", "运行项目验收测试"),
    ("clean verification", "干净环境独立验证"),
)


def _stage_position(stage: str) -> str:
    for index, (value, label) in enumerate(_STAGES):
        if value == stage:
            return f"{index + 1}/4 {label}"
    return "准备阶段"


def _header(title: str, subtitle: str, template: str, tag: str, tag_color: str) -> dict:
    return {
        "title": {"tag": "plain_text", "content": title},
        "subtitle": {"tag": "plain_text", "content": subtitle},
        "template": template,
        "icon": {"tag": "standard_icon", "token": "ai-common_colorful"},
        "text_tag_list": [
            {
                "tag": "text_tag",
                "text": {"tag": "plain_text", "content": tag},
                "color": tag_color,
            }
        ],
    }


def _highlight(title: str, content: str, color: str) -> dict:
    return {
        "tag": "column_set",
        "flex_mode": "none",
        "margin": "0px 0px 12px 0px",
        "columns": [
            {
                "tag": "column",
                "width": "weighted",
                "weight": 1,
                "background_style": f"{color}-50",
                "padding": "12px",
                "vertical_spacing": "4px",
                "elements": [
                    {
                        "tag": "markdown",
                        "content": f"**<font color='{color}'>{title}</font>**",
                    },
                    {"tag": "div", "text": {"tag": "plain_text", "content": content, "lines": 4}},
                ],
            }
        ],
    }


def _base_card(header: dict, summary: str, elements: list[dict]) -> dict:
    return {
        "schema": "2.0",
        "config": {
            "update_multi": True,
            "width_mode": "default",
            "summary": {"content": header["title"]["content"]},
        },
        "header": header,
        "body": {
            "direction": "vertical",
            "padding": "12px 12px 20px 12px",
            "vertical_spacing": "12px",
            "elements": [
                {"tag": "div", "text": {"tag": "plain_text", "content": summary, "lines": 4}},
                *elements,
            ],
        },
    }


def _running_elements(stage: str) -> list[dict]:
    active = next((index for index, item in enumerate(_STAGES) if item[0] == stage), -1)
    if active < 0:
        title = "准备隔离维护环境"
        detail = "正在创建独立任务，后续进展会更新在本卡片中。"
    else:
        title = f"当前 {active + 1}/4：{_STAGES[active][1]}"
        detail = "任务在隔离 Worktree 中运行，群聊中的其他消息不会进入该 Session。"
    steps = []
    for index, (_, label) in enumerate(_STAGES):
        if index < active:
            tag = "<text_tag color='green'>完成</text_tag>"
        elif index == active:
            tag = "<text_tag color='blue'>进行中</text_tag>"
        else:
            tag = "<text_tag color='neutral'>等待</text_tag>"
        steps.append(f"{tag} {index + 1}/4 {label}")
    return [
        _highlight(title, detail, "blue"),
        {"tag": "markdown", "content": "\n".join(steps)},
    ]


def _fields(items: tuple[tuple[str, str], ...]) -> dict:
    return {
        "tag": "div",
        "fields": [
            {
                "is_short": True,
                "text": {"tag": "lark_md", "content": f"**{label}**\n{value}"},
            }
            for label, value in items
        ],
    }


def _link_actions(notice: MaintenanceNotice) -> dict | None:
    buttons = []
    if notice.issue_url.startswith("https://gitee.com/"):
        buttons.append(
            {
                "tag": "button",
                "text": {"tag": "plain_text", "content": "查看 Gitee Issue"},
                "type": "primary",
                "behaviors": [{"type": "open_url", "default_url": notice.issue_url}],
            }
        )
    if notice.message_link.startswith("https://applink.feishu.cn/"):
        buttons.append(
            {
                "tag": "button",
                "text": {"tag": "plain_text", "content": "查看原始消息"},
                "type": "default",
                "behaviors": [{"type": "open_url", "default_url": notice.message_link}],
            }
        )
    if not buttons:
        return None
    return {
        "tag": "column_set",
        "flex_mode": "none",
        "horizontal_spacing": "8px",
        "columns": [
            {
                "tag": "column",
                "width": "auto",
                "vertical_align": "center",
                "elements": [button],
            }
            for button in buttons
        ],
    }


def render_card(notice: MaintenanceNotice) -> dict:
    if notice.kind is MaintenanceNoticeKind.ISSUE_CAPTURED:
        external = notice.issue_url.startswith("https://gitee.com/")
        issue_number = notice.issue_url.rsplit("/", 1)[-1] if external else ""
        card = _base_card(
            _header(
                "Gitee Issue 已创建" if external else "已收录为维护候选",
                f"{issue_number} · 来自 Pico 开源社区" if external else "来自 Pico 开源社区",
                "blue",
                "待修复" if external else "待确认",
                "blue",
            ),
            notice.title,
            [
                _highlight("下一步", "维护者确认值得修复后，在原消息下回复 /fix。", "blue"),
                {
                    "tag": "markdown",
                    "content": "<font color='grey'>当前不会修改代码或创建 PR。</font>",
                    "text_size": "notation",
                },
            ],
        )
    elif notice.kind in {
        MaintenanceNoticeKind.STARTED,
        MaintenanceNoticeKind.PROGRESS,
        MaintenanceNoticeKind.HEARTBEAT,
    }:
        elapsed = f"已运行 {notice.elapsed_seconds // 60} 分钟 · " if notice.elapsed_seconds >= 60 else ""
        card = _base_card(
            _header("正在生成 PR Candidate", f"{elapsed}状态自动更新", "blue", "处理中", "blue"),
            notice.title,
            _running_elements(notice.stage),
        )
    elif notice.kind is MaintenanceNoticeKind.CANDIDATE_READY:
        changed = "\n".join(f"- {path}" for path in notice.changed_files[:5]) or "无"
        if len(notice.changed_files) > 5:
            changed += f"\n- 另有 {len(notice.changed_files) - 5} 个文件"
        card = _base_card(
            _header("PR Candidate 已就绪", "复现、修改、测试和独立验证已完成", "green", "验证通过", "green"),
            notice.title,
            [
                _highlight(
                    "独立验证通过",
                    "Patch 已在全新 Worktree 中重新应用，所有配置的验收命令退出码均为 0。",
                    "green",
                ),
                _fields(
                    (
                        ("Base revision", notice.base_commit or "unknown"),
                        ("修改范围", f"{len(notice.changed_files)} 个文件"),
                        ("修改环境测试", "全部通过"),
                        ("干净环境验证", "全部通过"),
                    )
                ),
                {"tag": "div", "text": {"tag": "plain_text", "content": f"修改文件\n{changed}", "lines": 7}},
                {
                    "tag": "markdown",
                    "content": "<font color='grey'>维护者检查附件后，决定是否提交 PR。</font>",
                    "text_size": "notation",
                },
            ],
        )
    elif notice.kind is MaintenanceNoticeKind.VERIFICATION_FAILED:
        card = _base_card(
            _header("独立验证未通过", "候选修改未达到交付标准", "red", "未交付 Patch", "red"),
            notice.title,
            [
                _highlight("失败原因", notice.detail or "验收命令未全部通过。", "red"),
                _fields(
                    (
                        ("停止阶段", _stage_position(notice.stage)),
                        ("修改范围", f"{len(notice.changed_files)} 个文件"),
                        ("Base revision", notice.base_commit or "unknown"),
                    )
                ),
                {
                    "tag": "markdown",
                    "content": "<font color='grey'>未通过验证，因此不附带 candidate.patch。</font>",
                    "text_size": "notation",
                },
            ],
        )
    elif notice.kind is MaintenanceNoticeKind.BLOCKED:
        card = _base_card(
            _header("维护任务暂时受阻", "需要维护者补充信息或处理环境问题", "orange", "需要处理", "orange"),
            notice.title,
            [
                _highlight("阻塞原因", notice.detail or "没有可用的阻塞详情。", "orange"),
                {
                    "tag": "markdown",
                    "content": "<font color='grey'>补充复现条件或修复环境后，可以重新触发 /fix。</font>",
                    "text_size": "notation",
                },
            ],
        )
    else:
        raise ValueError(f"unsupported maintenance notice: {notice.kind}")
    if actions := _link_actions(notice):
        card["body"]["elements"].append(actions)
    link = notice.issue_url or notice.message_link
    if link.startswith("https://"):
        card["card_link"] = {"url": link}
    return card


class FeishuMaintenanceNotifier:
    def __init__(self, channel: Any) -> None:
        self._channel = channel
        self._card_ids: dict[str, str] = {}
        self._terminal_keys: set[str] = set()
        self._lock = asyncio.Lock()

    async def notify(self, notice: MaintenanceNotice) -> str | None:
        async with self._lock:
            return await self._notify_locked(notice)

    async def _notify_locked(self, notice: MaintenanceNotice) -> str | None:
        if notice.key in self._terminal_keys and notice.kind in {
            MaintenanceNoticeKind.PROGRESS,
            MaintenanceNoticeKind.HEARTBEAT,
        }:
            return self._card_ids.get(notice.key) or notice.card_message_id or None
        source_message_id = str(notice.source.extras.get("message_id") or "")
        if not source_message_id:
            raise ValueError("maintenance notice requires a source message ID")
        card = render_card(notice)
        in_thread = notice.source.chat_type is ChatType.GROUP
        if notice.kind in {MaintenanceNoticeKind.ISSUE_CAPTURED, MaintenanceNoticeKind.STARTED}:
            suffix = "issue" if notice.kind is MaintenanceNoticeKind.ISSUE_CAPTURED else "status"
            card_id = await self._channel.reply_card(
                source_message_id,
                card,
                in_thread=in_thread,
                idempotency_key=f"{notice.key}-{suffix}",
            )
            if notice.kind is MaintenanceNoticeKind.STARTED:
                self._card_ids[notice.key] = card_id
            return card_id
        card_id = self._card_ids.get(notice.key) or notice.card_message_id
        if card_id is None:
            card_id = await self._channel.reply_card(
                source_message_id,
                card,
                in_thread=in_thread,
                idempotency_key=f"{notice.key}-status",
            )
            self._card_ids[notice.key] = card_id
            await self._channel.update_card(card_id, card)
        else:
            await self._channel.update_card(card_id, card)
        if notice.kind in {
            MaintenanceNoticeKind.CANDIDATE_READY,
            MaintenanceNoticeKind.VERIFICATION_FAILED,
            MaintenanceNoticeKind.BLOCKED,
        }:
            self._terminal_keys.add(notice.key)
        if notice.attachments:
            await self._channel.reply(
                source_message_id,
                "",
                media=[str(path) for path in notice.attachments],
                in_thread=in_thread,
            )
        return card_id
